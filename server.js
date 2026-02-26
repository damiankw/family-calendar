const express = require('express');
const path = require('path');
const db = require('./db');
const { syncCalendarSource } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ───────── Setup check middleware ─────────
app.use((req, res, next) => {
  const setupNeeded = !db.isSetupComplete();
  req.setupNeeded = setupNeeded;
  next();
});

// Redirect to setup if needed (except for setup routes and static assets)
app.use((req, res, next) => {
  if (req.setupNeeded && !req.path.startsWith('/api/setup') && !req.path.startsWith('/setup')) {
    const apiRequest = req.path.startsWith('/api/');
    if (apiRequest) return res.status(503).json({ error: 'Setup required' });
    return res.redirect('/setup');
  }
  next();
});

// ───────── Setup API routes ─────────
app.post('/api/setup/init', (req, res) => {
  const { username, password, location, lat, lon, tz, calendar_name, calendar_type, calendar_url, calendar_color } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Create admin user
    db.createUser(username, password);

    // Set weather location (only if provided)
    if (location) db.setSetting('weather_location_name', location);
    if (lat != null) db.setSetting('weather_lat', String(lat));
    if (lon != null) db.setSetting('weather_lon', String(lon));
    if (tz) db.setSetting('weather_tz', tz);

    // Create calendar if provided
    if (calendar_name && calendar_type) {
      const config = {};
      if (calendar_type === 'ics' && calendar_url) {
        config.url = calendar_url;
        config.refresh_minutes = 30;
      }
      db.createCalendarSource({
        name: calendar_name,
        type: calendar_type,
        color: calendar_color || '#8be9fd',
        enabled: true,
        config,
      });
    }

    const isFormPost = req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data');
    if (isFormPost) return res.redirect('/admin');
    res.json({ ok: true });
  } catch (e) {
    console.error('Setup error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

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
    lat:           db.getSetting('weather_lat')           || null,
    lon:           db.getSetting('weather_lon')           || null,
    tz:            db.getSetting('weather_tz')            || null,
    location_name: db.getSetting('weather_location_name') || null,
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

// ───────── Reminders API ─────────

// GET /api/reminders — list all reminders
app.get('/api/reminders', (_req, res) => {
  res.json(db.getAllReminders());
});

// GET /api/reminders/enabled — only enabled reminders (for dashboard)
app.get('/api/reminders/enabled', (_req, res) => {
  res.json(db.getEnabledReminders());
});

// POST /api/reminders — create a reminder
app.post('/api/reminders', (req, res) => {
  try {
    const id = db.createReminder(req.body);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/reminders/:id — update a reminder
app.put('/api/reminders/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.getReminder(id)) return res.status(404).json({ error: 'Reminder not found' });
  db.updateReminder(id, req.body);
  res.json(db.getReminder(id));
});

// PATCH /api/reminders/:id/toggle — toggle enabled
app.patch('/api/reminders/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = db.getReminder(id);
  if (!r) return res.status(404).json({ error: 'Reminder not found' });
  db.updateReminder(id, { enabled: r.enabled ? 0 : 1 });
  res.json(db.getReminder(id));
});

// DELETE /api/reminders/:id — delete a reminder
app.delete('/api/reminders/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.getReminder(id)) return res.status(404).json({ error: 'Reminder not found' });
  db.deleteReminder(id);
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

// ───────── Backup / Restore ─────────
// GET /api/backup — export all data as JSON
app.get('/api/backup', (_req, res) => {
  const payload = db.exportAllData();
  res.setHeader('Content-Disposition', 'attachment; filename="familydash-backup.json"');
  res.json(payload);
});

// POST /api/restore — import data from JSON
app.post('/api/restore', (req, res) => {
  try {
    db.importAllData(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error('Restore error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ───────── Admin panel ─────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ───────── Setup page ─────────
app.get('/setup', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// ───────── Static files ─────────
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`FamilyDash running at http://localhost:${PORT}`);

  // ───────── Embedded worker loop ─────────
  // Runs the same fetch cycle that worker.js did, but inside the server
  // process so only one command is needed to start everything.
  const { runAll, INTERVAL_MS } = require('./worker');
  runAll();
  setInterval(runAll, INTERVAL_MS);
  console.log(`[worker] Background sync every ${INTERVAL_MS / 1000}s`);
});
