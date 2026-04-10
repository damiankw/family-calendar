// ─── worker.js — Background data fetcher ───
// Runs on a 5-minute loop. Each provider fetches from an external source
// and writes into SQLite. The web server reads from the same DB independently.

const db = require('./db');
const { syncAllCalendars } = require('./sync');

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════
//  PROVIDERS — each one fetches data and writes it to SQLite.
// ═══════════════════════════════════════════════════════════════

// ───────── Calendar provider ─────────
async function fetchCalendarEvents() {
  console.log('[worker] Fetching calendar events …');
  const result = await syncAllCalendars();
  console.log(`[worker]   → ${result.events} events synced from ${result.sources} source(s)`);
}

// ───────── Weather provider (Open-Meteo — free, no API key) ─────────

// WMO weather codes → Weather Icons CSS class mapping
// See https://erikflowers.github.io/weather-icons/
const WMO_ICONS = {
  0:  'wi-day-sunny',          // Clear sky
  1:  'wi-day-sunny-overcast', // Mainly clear
  2:  'wi-day-cloudy',         // Partly cloudy
  3:  'wi-cloudy',             // Overcast
  45: 'wi-fog',                // Fog
  48: 'wi-fog',                // Depositing rime fog
  51: 'wi-sprinkle',           // Light drizzle
  53: 'wi-sprinkle',           // Moderate drizzle
  55: 'wi-showers',            // Dense drizzle
  56: 'wi-rain-mix',           // Light freezing drizzle
  57: 'wi-rain-mix',           // Dense freezing drizzle
  61: 'wi-rain',               // Slight rain
  63: 'wi-rain',               // Moderate rain
  65: 'wi-rain-wind',          // Heavy rain
  66: 'wi-rain-mix',           // Light freezing rain
  67: 'wi-rain-mix',           // Heavy freezing rain
  71: 'wi-snow',               // Slight snowfall
  73: 'wi-snow',               // Moderate snowfall
  75: 'wi-snow-wind',          // Heavy snowfall
  77: 'wi-sleet',              // Snow grains
  80: 'wi-day-showers',        // Slight rain showers
  81: 'wi-showers',            // Moderate rain showers
  82: 'wi-storm-showers',      // Violent rain showers
  85: 'wi-day-snow',           // Slight snow showers
  86: 'wi-snow-wind',          // Heavy snow showers
  95: 'wi-thunderstorm',       // Thunderstorm
  96: 'wi-day-snow-thunderstorm', // Thunderstorm with slight hail
  99: 'wi-thunderstorm',       // Thunderstorm with heavy hail
};

function wmoIcon(code) {
  return WMO_ICONS[code] ?? 'wi-na';
}

// Convert degrees to compass direction
function degToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Format unix timestamp to "h:mm AM/PM" in timezone
function formatTime(isoString) {
  const d = new Date(isoString);
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${mins} ${ampm}`;
}

function dateInTimeZone(timeZone) {
  if (!timeZone) return new Date().toISOString().slice(0, 10);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchWeather() {
  console.log('[worker] Fetching weather …');

  // Read location from settings
  const lat = db.getSetting('weather_lat');
  const lon = db.getSetting('weather_lon');
  const tz  = db.getSetting('weather_tz');

  // Skip weather fetch if location not configured
  if (!lat || !lon || !tz) {
    console.log('[worker] ⚠ Weather location not configured - skipping weather fetch');
    return;
  }

  // Always fetch in metric (celsius / km/h) – conversion happens client-side
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset`
    + `&timezone=${encodeURIComponent(tz)}`
    + `&temperature_unit=celsius`
    + `&wind_speed_unit=kmh`
    + `&forecast_days=5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const data = await res.json();

  // ── Current conditions ──
  const cur = data.current;
  const daily = data.daily;

  db.upsertCurrentWeather({
    temp:        Math.round(cur.temperature_2m),
    icon:        wmoIcon(cur.weather_code),
    description: '', // Open-Meteo doesn't return a text description
    wind_speed:  Math.round(cur.wind_speed_10m),
    wind_dir:    degToCompass(cur.wind_direction_10m),
    humidity:    cur.relative_humidity_2m,
    sunrise:     formatTime(daily.sunrise[0]),
    sunset:      formatTime(daily.sunset[0]),
  });

  // ── 5-day forecast ──
  const dayLabels = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const today = dateInTimeZone(tz);
  const firstForecastDate = daily.time[0];
  const lastForecastDate = daily.time[daily.time.length - 1];

  db.pruneForecastRange(firstForecastDate, lastForecastDate);

  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    const d    = new Date(date + 'T00:00:00');
    const label = date === today ? 'TODAY' : dayLabels[d.getDay()];

    db.upsertForecastDay({
      date,
      day_label: label,
      icon:      wmoIcon(daily.weather_code[i]),
      hi:        Math.round(daily.temperature_2m_max[i]),
      lo:        Math.round(daily.temperature_2m_min[i]),
    });
  }

  console.log(`[worker]   → current weather + ${daily.time.length}-day forecast written`);
}

// ───────── Aurora provider (NOAA SWPC — free, no API key) ─────────

// Minimum geomagnetic latitude where aurora becomes visible for a given Kp
// Source: NOAA Space Weather Scales / empirical aurora oval models
const KP_TO_MIN_LAT = {
  0: 67, 1: 65, 2: 63, 3: 61, 4: 58,
  5: 55, 6: 50, 7: 45, 8: 40, 9: 35,
};

function kpVisibleAtLat(kp, absLat) {
  // Walk through the table to find visibility.
  // Interpolate between integer Kp values for smoother results.
  const kpFloor = Math.floor(kp);
  const kpCeil  = Math.min(kpFloor + 1, 9);
  const latFloor = KP_TO_MIN_LAT[kpFloor] || 67;
  const latCeil  = KP_TO_MIN_LAT[kpCeil]  || 67;
  const frac = kp - kpFloor;
  const minLat = latFloor + (latCeil - latFloor) * frac;
  return absLat >= minLat;
}

async function fetchAurora() {
  console.log('[worker] Fetching aurora forecast …');

  const lat = db.getSetting('weather_lat');
  if (!lat) {
    console.log('[worker] ⚠ Location not configured — skipping aurora fetch');
    return;
  }

  const url = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NOAA SWPC returned ${res.status}`);
  const raw = await res.json();

  // raw is [ [header], [time_tag, kp, observed|estimated|predicted, noaa_scale], … ]
  // Group by date and find max Kp per day
  const dailyMax = {};
  for (let i = 1; i < raw.length; i++) {
    const [timeTag, kpStr] = raw[i];
    const date = timeTag.slice(0, 10); // "YYYY-MM-DD"
    const kp   = parseFloat(kpStr);
    if (isNaN(kp)) continue;
    dailyMax[date] = Math.max(dailyMax[date] || 0, kp);
  }

  // Write each day's max Kp to the database
  let count = 0;
  for (const [date, maxKp] of Object.entries(dailyMax)) {
    db.upsertAuroraForecast(date, maxKp);
    count++;
  }

  // Clean up old rows
  db.clearOldAurora();

  console.log(`[worker]   → ${count} aurora forecast days written`);
}

// ───────── Add future providers here ─────────
// async function fetchBinNights()  { … }
// async function fetchSchoolAlerts() { … }
// async function fetchBirthdays()  { … }

// ═══════════════════════════════════════════════════════════════
//  RUNNER
// ═══════════════════════════════════════════════════════════════

async function runAll() {
  const start = Date.now();
  console.log(`\n[worker] ── Cycle starting at ${new Date().toLocaleTimeString()} ──`);

  try { await fetchCalendarEvents(); } catch (e) { console.error('[worker] Calendar error:', e.message); }
  try { await fetchWeather();         } catch (e) { console.error('[worker] Weather error:', e.message); }
  try { await fetchAurora();          } catch (e) { console.error('[worker] Aurora error:', e.message); }
  // try { await fetchBinNights();    } catch (e) { … }

  console.log(`[worker] ── Cycle complete in ${Date.now() - start}ms ──`);
}

// Export for use inside server.js (embedded mode)
module.exports = { runAll, INTERVAL_MS };

// ── Standalone mode: if run directly with `node worker.js` ──
if (require.main === module) {
  runAll();
  const timer = setInterval(runAll, INTERVAL_MS);

  function shutdown() {
    console.log('\n[worker] Shutting down …');
    clearInterval(timer);
    db.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[worker] Started — polling every ${INTERVAL_MS / 1000}s`);
}
