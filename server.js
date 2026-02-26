const express = require('express');
const path = require('path');
const db = require('./db');
const { syncCalendarSource } = require('./sync');

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

// ── Calendar sources CRUD ──

// GET /api/calendars — list all calendar sources
app.get('/api/calendars', (_req, res) => {
  const sources = db.getAllCalendarSources().map(s => ({
    ...s,
    config: JSON.parse(s.config || '{}'),
    enabled: !!s.enabled,
  }));
  res.json(sources);
});

// POST /api/calendars — create a new calendar source
app.post('/api/calendars', (req, res) => {
  const { name, type, color, enabled, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const id = db.createCalendarSource({ name, type, color, enabled, config });
  const created = db.getCalendarSource(id);
  res.status(201).json({ ...created, config: JSON.parse(created.config || '{}'), enabled: !!created.enabled });
});

// PUT /api/calendars/:id — update a calendar source
app.put('/api/calendars/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getCalendarSource(id);
  if (!existing) return res.status(404).json({ error: 'Calendar not found' });

  db.updateCalendarSource(id, req.body);
  const updated = db.getCalendarSource(id);
  res.json({ ...updated, config: JSON.parse(updated.config || '{}'), enabled: !!updated.enabled });
});

// PATCH /api/calendars/:id/toggle — quick enable/disable toggle
app.patch('/api/calendars/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getCalendarSource(id);
  if (!existing) return res.status(404).json({ error: 'Calendar not found' });

  const newEnabled = !existing.enabled;
  db.updateCalendarSource(id, { enabled: newEnabled });
  res.json({ id, enabled: newEnabled });
});

// DELETE /api/calendars/:id — delete a calendar source + its events
app.delete('/api/calendars/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getCalendarSource(id);
  if (!existing) return res.status(404).json({ error: 'Calendar not found' });

  db.deleteCalendarSource(id);
  res.json({ ok: true, id });
});

// POST /api/calendars/:id/sync — on-demand sync for a single calendar
app.post('/api/calendars/:id/sync', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getCalendarSource(id);
  if (!existing) return res.status(404).json({ error: 'Calendar not found' });

  try {
    const count = await syncCalendarSource(id);
    res.json({ ok: true, id, events: count });
  } catch (e) {
    console.error(`Sync error (cal ${id}):`, e.message);
    res.status(500).json({ error: e.message });
  }
});

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

// ── Birthdays CRUD ──

// GET /api/birthdays — list all birthdays
app.get('/api/birthdays', (_req, res) => {
  res.json(db.getAllBirthdays());
});

// GET /api/birthdays/month/:month — birthdays for a specific month (1-12)
app.get('/api/birthdays/month/:month', (req, res) => {
  const month = parseInt(req.params.month, 10);
  if (isNaN(month) || month < 1 || month > 12) return res.status(400).json({ error: 'Invalid month' });
  res.json(db.getBirthdaysByMonth(month));
});

// POST /api/birthdays — create a birthday
app.post('/api/birthdays', (req, res) => {
  const { name, month, day, year } = req.body;
  if (!name || !month || !day) return res.status(400).json({ error: 'name, month, and day are required' });
  try {
    const id = db.createBirthday({ name, month, day, year });
    res.status(201).json(db.getBirthday(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Birthday already exists for this person on this date' });
    throw e;
  }
});

// PUT /api/birthdays/:id — update a birthday
app.put('/api/birthdays/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.getBirthday(id)) return res.status(404).json({ error: 'Birthday not found' });
  db.updateBirthday(id, req.body);
  res.json(db.getBirthday(id));
});

// DELETE /api/birthdays/:id — delete a birthday
app.delete('/api/birthdays/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.getBirthday(id)) return res.status(404).json({ error: 'Birthday not found' });
  db.deleteBirthday(id);
  res.json({ ok: true, id });
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

  // ───────── Embedded worker loop ─────────
  // Runs the same fetch cycle that worker.js did, but inside the server
  // process so only one command is needed to start everything.
  const { runAll, INTERVAL_MS } = require('./worker');
  runAll();
  setInterval(runAll, INTERVAL_MS);
  console.log(`[worker] Background sync every ${INTERVAL_MS / 1000}s`);
});
