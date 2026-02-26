// ─── worker.js — Background data fetcher ───
// Runs on a 5-minute loop. Each provider fetches from an external source
// and writes into SQLite. The web server reads from the same DB independently.

const db = require('./db');

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════
//  PROVIDERS — each one fetches data and writes it to SQLite.
//  Replace the stub implementations with real API calls.
// ═══════════════════════════════════════════════════════════════

// ───────── Calendar provider ─────────
// TODO: Wire up to Google Calendar, Outlook, iCal URL, etc.
async function fetchCalendarEvents() {
  console.log('[worker] Fetching calendar events …');

  // ── STUB: hardcoded family events ──
  // When you wire this up, delete everything below and replace with
  // real API calls that return the same shape: { date, time, title, color, source, source_id }
  const stubEvents = [
    { date: '2026-02-02', time: '09:00', title: 'Swimming — kids',     color: '#8be9fd', source: 'stub', source_id: 'stub-1'  },
    { date: '2026-02-05', time: '15:30', title: 'Parent-teacher',      color: '#ff5555', source: 'stub', source_id: 'stub-2'  },
    { date: '2026-02-05', time: '16:30', title: 'Piano — Emma',        color: '#bd93f9', source: 'stub', source_id: 'stub-3'  },
    { date: '2026-02-10', time: '10:00', title: 'Dentist — Mum',       color: '#50fa7b', source: 'stub', source_id: 'stub-4'  },
    { date: '2026-02-14', time: '18:00', title: "Valentine's dinner",   color: '#ff79c6', source: 'stub', source_id: 'stub-5'  },
    { date: '2026-02-14', time: '17:00', title: 'School disco',        color: '#ffb86c', source: 'stub', source_id: 'stub-6'  },
    { date: '2026-02-17', time: '11:00', title: 'Vet — Biscuit',       color: '#f1fa8c', source: 'stub', source_id: 'stub-7'  },
    { date: '2026-02-20', time: '14:00', title: 'Soccer finals',       color: '#50fa7b', source: 'stub', source_id: 'stub-8'  },
    { date: '2026-02-20', time: '09:00', title: 'Haircuts',            color: '#8be9fd', source: 'stub', source_id: 'stub-9'  },
    { date: '2026-02-24', time: '10:00', title: 'Groceries',           color: '#ffb86c', source: 'stub', source_id: 'stub-10' },
    { date: '2026-02-26', time: '08:30', title: 'School drop-off',     color: '#ff5555', source: 'stub', source_id: 'stub-11' },
    { date: '2026-02-26', time: '10:00', title: 'Dentist — Mum',       color: '#50fa7b', source: 'stub', source_id: 'stub-12' },
    { date: '2026-02-26', time: '18:00', title: 'Soccer — Liam',       color: '#8be9fd', source: 'stub', source_id: 'stub-13' },
    { date: '2026-02-27', time: '09:00', title: 'Grocery shop',        color: '#ffb86c', source: 'stub', source_id: 'stub-14' },
    { date: '2026-02-27', time: '14:00', title: 'Play date — Emma',    color: '#bd93f9', source: 'stub', source_id: 'stub-15' },
    { date: '2026-02-28', time: '12:00', title: 'Family BBQ',          color: '#ff79c6', source: 'stub', source_id: 'stub-16' },
    { date: '2026-03-02', time: '09:00', title: 'Swimming — kids',     color: '#8be9fd', source: 'stub', source_id: 'stub-17' },
    { date: '2026-03-05', time: '19:30', title: 'Book club — Dad',     color: '#f1fa8c', source: 'stub', source_id: 'stub-18' },
    { date: '2026-03-07', time: '14:00', title: 'Birthday — Nana',     color: '#ff79c6', source: 'stub', source_id: 'stub-19' },
    { date: '2026-03-07', time: '10:00', title: 'Cake pickup',         color: '#ffb86c', source: 'stub', source_id: 'stub-20' },
    { date: '2026-03-12', time: '09:00', title: 'School photos',       color: '#bd93f9', source: 'stub', source_id: 'stub-21' },
    { date: '2026-03-14', time: '14:00', title: 'Soccer semis',        color: '#50fa7b', source: 'stub', source_id: 'stub-22' },
  ];

  for (const ev of stubEvents) {
    db.upsertEvent(ev);
  }

  console.log(`[worker]   → ${stubEvents.length} events written`);
}

// ───────── Weather provider (Open-Meteo — free, no API key) ─────────

// WMO weather codes → emoji mapping
const WMO_ICONS = {
  0:  '☀️',   // Clear sky
  1:  '🌤️',  // Mainly clear
  2:  '⛅',   // Partly cloudy
  3:  '☁️',   // Overcast
  45: '🌫️',  // Fog
  48: '🌫️',  // Depositing rime fog
  51: '🌦️',  // Light drizzle
  53: '🌦️',  // Moderate drizzle
  55: '🌧️',  // Dense drizzle
  56: '🌧️',  // Light freezing drizzle
  57: '🌧️',  // Dense freezing drizzle
  61: '🌧️',  // Slight rain
  63: '🌧️',  // Moderate rain
  65: '🌧️',  // Heavy rain
  66: '🌧️',  // Light freezing rain
  67: '🌧️',  // Heavy freezing rain
  71: '🌨️',  // Slight snowfall
  73: '🌨️',  // Moderate snowfall
  75: '❄️',   // Heavy snowfall
  77: '🌨️',  // Snow grains
  80: '🌦️',  // Slight rain showers
  81: '🌧️',  // Moderate rain showers
  82: '🌧️',  // Violent rain showers
  85: '🌨️',  // Slight snow showers
  86: '🌨️',  // Heavy snow showers
  95: '⛈️',  // Thunderstorm
  96: '⛈️',  // Thunderstorm with slight hail
  99: '⛈️',  // Thunderstorm with heavy hail
};

function wmoIcon(code) {
  return WMO_ICONS[code] ?? '❓';
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

async function fetchWeather() {
  console.log('[worker] Fetching weather …');

  // Read location from settings (default: Melbourne, Australia)
  const lat = db.getSetting('weather_lat') || '-37.8136';
  const lon = db.getSetting('weather_lon') || '144.9631';
  const tz  = db.getSetting('weather_tz')  || 'Australia/Melbourne';

  // ── Current weather + daily forecast in one call ──
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset`
    + `&timezone=${encodeURIComponent(tz)}`
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
  const today = new Date().toISOString().slice(0, 10);

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
  // try { await fetchBinNights();    } catch (e) { … }

  console.log(`[worker] ── Cycle complete in ${Date.now() - start}ms ──`);
}

// Run immediately on startup, then every 5 minutes
runAll();
const timer = setInterval(runAll, INTERVAL_MS);

// Graceful shutdown
function shutdown() {
  console.log('\n[worker] Shutting down …');
  clearInterval(timer);
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[worker] Started — polling every ${INTERVAL_MS / 1000}s`);
