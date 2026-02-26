// ─── db.js — SQLite schema & helpers ───
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'calendar.db');

let _db;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');   // safe for concurrent reader (server) + writer (worker)
    _db.pragma('busy_timeout = 5000');
    initialise(_db);
  }
  return _db;
}

// ───────── Schema ─────────
function initialise(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT    NOT NULL,          -- YYYY-MM-DD
      time          TEXT,                      -- HH:MM (nullable for all-day)
      title         TEXT    NOT NULL,
      color         TEXT    DEFAULT '#8be9fd',
      source        TEXT    DEFAULT 'manual',  -- e.g. 'google', 'outlook', 'ical', 'manual'
      source_id     TEXT,                      -- external ID for dedup
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source ON events(source, source_id);

    CREATE TABLE IF NOT EXISTS weather_current (
      id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
      temp          REAL,
      icon          TEXT,
      description   TEXT,
      wind_speed    REAL,
      wind_dir      TEXT,
      humidity      INTEGER,
      sunrise       TEXT,
      sunset        TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weather_forecast (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT    NOT NULL,          -- YYYY-MM-DD
      day_label     TEXT,                      -- e.g. 'TODAY', 'FRI'
      icon          TEXT,
      hi            REAL,
      lo            REAL,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_date ON weather_forecast(date);

    CREATE TABLE IF NOT EXISTS settings (
      key           TEXT PRIMARY KEY,
      value         TEXT
    );
  `);

  // Seed default settings (INSERT OR IGNORE so user changes are preserved)
  const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  seedSetting.run('weather_lat', '-37.8136');          // Melbourne, Australia
  seedSetting.run('weather_lon', '144.9631');
  seedSetting.run('weather_tz',  'Australia/Melbourne');
  seedSetting.run('weather_location_name', 'Melbourne, Australia');
  seedSetting.run('weather_temp_unit', 'celsius');       // celsius | fahrenheit
  seedSetting.run('weather_wind_unit', 'kmh');           // ms | kmh | mph
}

// ───────── Event helpers ─────────
function upsertEvent({ date, time, title, color, source, source_id }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO events (date, time, title, color, source, source_id, updated_at)
    VALUES (@date, @time, @title, @color, @source, @source_id, datetime('now'))
    ON CONFLICT(source, source_id) DO UPDATE SET
      date       = excluded.date,
      time       = excluded.time,
      title      = excluded.title,
      color      = excluded.color,
      updated_at = datetime('now')
  `);
  stmt.run({ date, time: time || null, title, color: color || '#8be9fd', source: source || 'manual', source_id: source_id || `${source}-${date}-${title}` });
}

function getEventsByMonth(year, month) {
  const db = getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return db.prepare('SELECT * FROM events WHERE date LIKE ? ORDER BY date, time').all(`${prefix}%`);
}

function getEventsByDate(date) {
  const db = getDb();
  return db.prepare('SELECT * FROM events WHERE date = ? ORDER BY time').all(date);
}

// ───────── Weather helpers ─────────
function upsertCurrentWeather({ temp, icon, description, wind_speed, wind_dir, humidity, sunrise, sunset }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO weather_current (id, temp, icon, description, wind_speed, wind_dir, humidity, sunrise, sunset, updated_at)
    VALUES (1, @temp, @icon, @description, @wind_speed, @wind_dir, @humidity, @sunrise, @sunset, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      temp        = excluded.temp,
      icon        = excluded.icon,
      description = excluded.description,
      wind_speed  = excluded.wind_speed,
      wind_dir    = excluded.wind_dir,
      humidity    = excluded.humidity,
      sunrise     = excluded.sunrise,
      sunset      = excluded.sunset,
      updated_at  = datetime('now')
  `).run({ temp, icon, description, wind_speed, wind_dir, humidity, sunrise, sunset });
}

function getCurrentWeather() {
  const db = getDb();
  return db.prepare('SELECT * FROM weather_current WHERE id = 1').get() || null;
}

function upsertForecastDay({ date, day_label, icon, hi, lo }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO weather_forecast (date, day_label, icon, hi, lo, updated_at)
    VALUES (@date, @day_label, @icon, @hi, @lo, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET
      day_label  = excluded.day_label,
      icon       = excluded.icon,
      hi         = excluded.hi,
      lo         = excluded.lo,
      updated_at = datetime('now')
  `).run({ date, day_label, icon, hi, lo });
}

function getForecast() {
  const db = getDb();
  return db.prepare('SELECT * FROM weather_forecast ORDER BY date LIMIT 5').all();
}

// ───────── Settings helpers ─────────
function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ───────── Cleanup ─────────
function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
  upsertEvent,
  getEventsByMonth,
  getEventsByDate,
  upsertCurrentWeather,
  getCurrentWeather,
  upsertForecastDay,
  getForecast,
  getSetting,
  setSetting,
  close,
};
