const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ───────── API routes (read-only from SQLite) ─────────

// Events for a given month: GET /api/events?year=2026&month=2
// Also accepts a second month to cover calendar overflow into next month
app.get('/api/events', (req, res) => {
  const year  = parseInt(req.query.year,  10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);

  let events = db.getEventsByMonth(year, month);

  // Optionally include next month (for calendar overflow rows)
  if (req.query.includeNext === '1') {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    events = events.concat(db.getEventsByMonth(nextYear, nextMonth));
  }

  res.json(events);
});

// Events for a specific date: GET /api/events/2026-02-26
app.get('/api/events/:date', (req, res) => {
  res.json(db.getEventsByDate(req.params.date));
});

// Current weather: GET /api/weather/current
app.get('/api/weather/current', (_req, res) => {
  const weather = db.getCurrentWeather();
  res.json(weather || {});
});

// Forecast: GET /api/weather/forecast
app.get('/api/weather/forecast', (_req, res) => {
  res.json(db.getForecast());
});

// ───────── Settings API ─────────

// GET /api/settings/weather — return all weather-related settings
app.get('/api/settings/weather', (_req, res) => {
  res.json({
    lat:           db.getSetting('weather_lat')           || '-37.8136',
    lon:           db.getSetting('weather_lon')           || '144.9631',
    tz:            db.getSetting('weather_tz')            || 'Australia/Melbourne',
    location_name: db.getSetting('weather_location_name') || 'Melbourne, Australia',
    temp_unit:     db.getSetting('weather_temp_unit')     || 'celsius',
    wind_unit:     db.getSetting('weather_wind_unit')     || 'kmh',
  });
});

// PUT /api/settings/weather — save weather settings
app.put('/api/settings/weather', (req, res) => {
  const { lat, lon, tz, location_name, temp_unit, wind_unit } = req.body;
  if (lat != null)           db.setSetting('weather_lat',           String(lat));
  if (lon != null)           db.setSetting('weather_lon',           String(lon));
  if (tz)                    db.setSetting('weather_tz',            tz);
  if (location_name)         db.setSetting('weather_location_name', location_name);
  if (temp_unit)             db.setSetting('weather_temp_unit',     temp_unit);
  if (wind_unit)             db.setSetting('weather_wind_unit',     wind_unit);
  res.json({ ok: true });
});

// GET /api/geocode?q=... — proxy to Open-Meteo geocoding (avoids CORS)
app.get('/api/geocode', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json({ results: [] });
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('Geocode error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ───────── Admin panel ─────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ───────── Static files ─────────
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Calendar wallboard running at http://localhost:${PORT}`);
});
