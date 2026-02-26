const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ───────── Admin panel ─────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ───────── Static files ─────────
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Calendar wallboard running at http://localhost:${PORT}`);
});
