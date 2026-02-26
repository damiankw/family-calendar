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

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      type          TEXT    NOT NULL,          -- 'google', 'microsoft', 'ics'
      color         TEXT    DEFAULT '#8be9fd',
      enabled       INTEGER DEFAULT 1,         -- 0 = disabled, 1 = enabled
      config        TEXT    DEFAULT '{}',      -- JSON: ics_url, refresh_minutes, etc.
      last_synced   TEXT,                      -- datetime of last successful sync
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key           TEXT PRIMARY KEY,
      value         TEXT
    );

    CREATE TABLE IF NOT EXISTS birthdays (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      month         INTEGER NOT NULL,          -- 1-12
      day           INTEGER NOT NULL,          -- 1-31
      year          INTEGER,                   -- birth year (nullable, for age calc)
      created_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_birthdays_date_name ON birthdays(month, day, name);

    CREATE TABLE IF NOT EXISTS reminders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT    NOT NULL,
      icon          TEXT    DEFAULT 'fa-bell',  -- FA icon class shown on the calendar
      color         TEXT    DEFAULT '#ff79c6',
      recurrence    TEXT    NOT NULL,            -- 'weekly', 'fortnightly', 'monthly'
      day_of_week   INTEGER,                     -- 0=Sun … 6=Sat  (weekly / fortnightly)
      day_of_month  INTEGER,                     -- 1-31            (monthly)
      start_date    TEXT,                         -- YYYY-MM-DD anchor for fortnightly calc
      enabled       INTEGER DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now'))
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

  // ── Migrations for existing databases ──
  try { db.exec('ALTER TABLE calendar_sources ADD COLUMN last_synced TEXT'); } catch (_) { /* column already exists */ }
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
  return db.prepare(`
    SELECT e.* FROM events e
    LEFT JOIN calendar_sources cs ON cs.id = CAST(REPLACE(e.source, 'cal-', '') AS INTEGER)
    WHERE e.date LIKE ?
      AND (cs.id IS NULL OR cs.enabled = 1)
    ORDER BY e.date, e.time
  `).all(`${prefix}%`);
}

function getEventsByDate(date) {
  const db = getDb();
  return db.prepare(`
    SELECT e.* FROM events e
    LEFT JOIN calendar_sources cs ON cs.id = CAST(REPLACE(e.source, 'cal-', '') AS INTEGER)
    WHERE e.date = ?
      AND (cs.id IS NULL OR cs.enabled = 1)
    ORDER BY e.time
  `).all(date);
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

// ───────── Calendar source helpers ─────────
function getAllCalendarSources() {
  const db = getDb();
  return db.prepare('SELECT * FROM calendar_sources ORDER BY created_at').all();
}

function getEnabledCalendarSources() {
  const db = getDb();
  return db.prepare('SELECT * FROM calendar_sources WHERE enabled = 1 ORDER BY created_at').all();
}

function getCalendarSource(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(id) || null;
}

function createCalendarSource({ name, type, color, enabled, config }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO calendar_sources (name, type, color, enabled, config)
    VALUES (@name, @type, @color, @enabled, @config)
  `).run({
    name,
    type,
    color: color || '#8be9fd',
    enabled: enabled != null ? (enabled ? 1 : 0) : 1,
    config: typeof config === 'string' ? config : JSON.stringify(config || {}),
  });
  return result.lastInsertRowid;
}

function updateCalendarSource(id, { name, type, color, enabled, config }) {
  const db = getDb();
  const fields = [];
  const params = { id };

  if (name != null)    { fields.push('name = @name');       params.name = name; }
  if (type != null)    { fields.push('type = @type');       params.type = type; }
  if (color != null)   { fields.push('color = @color');     params.color = color; }
  if (enabled != null) { fields.push('enabled = @enabled'); params.enabled = enabled ? 1 : 0; }
  if (config != null)  { fields.push('config = @config');   params.config = typeof config === 'string' ? config : JSON.stringify(config); }

  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE calendar_sources SET ${fields.join(', ')} WHERE id = @id`).run(params);

  // Propagate color change to existing events from this source
  if (color != null) {
    db.prepare('UPDATE events SET color = ? WHERE source = ?').run(color, `cal-${id}`);
  }
}

function markCalendarSynced(id) {
  const db = getDb();
  db.prepare("UPDATE calendar_sources SET last_synced = datetime('now') WHERE id = ?").run(id);
}

function deleteCalendarSource(id) {
  const db = getDb();
  // Get the source info to build the matching source string
  const src = db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(id);
  if (src) {
    // Remove all events that came from this calendar source
    db.prepare('DELETE FROM events WHERE source = ?').run(`cal-${id}`);
  }
  db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(id);
}

function deleteEventsBySource(source) {
  const db = getDb();
  db.prepare('DELETE FROM events WHERE source = ?').run(source);
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

// ───────── Birthday helpers ─────────
function getAllBirthdays() {
  const db = getDb();
  return db.prepare('SELECT * FROM birthdays ORDER BY month, day, name').all();
}

function getBirthday(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM birthdays WHERE id = ?').get(id) || null;
}

function getBirthdaysByMonth(month) {
  const db = getDb();
  return db.prepare('SELECT * FROM birthdays WHERE month = ? ORDER BY day, name').all(month);
}

function createBirthday({ name, month, day, year }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO birthdays (name, month, day, year) VALUES (@name, @month, @day, @year)
  `).run({ name, month, day, year: year || null });
  return result.lastInsertRowid;
}

function updateBirthday(id, { name, month, day, year }) {
  const db = getDb();
  const fields = [];
  const params = { id };
  if (name != null)  { fields.push('name = @name');   params.name = name; }
  if (month != null) { fields.push('month = @month'); params.month = month; }
  if (day != null)   { fields.push('day = @day');     params.day = day; }
  if (year !== undefined) { fields.push('year = @year'); params.year = year || null; }
  if (!fields.length) return;
  db.prepare(`UPDATE birthdays SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

function deleteBirthday(id) {
  const db = getDb();
  db.prepare('DELETE FROM birthdays WHERE id = ?').run(id);
}

// ───────── Reminder helpers ─────────
function getAllReminders() {
  const db = getDb();
  return db.prepare('SELECT * FROM reminders ORDER BY title').all();
}

function getReminder(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) || null;
}

function getEnabledReminders() {
  const db = getDb();
  return db.prepare('SELECT * FROM reminders WHERE enabled = 1 ORDER BY title').all();
}

function createReminder({ title, icon, color, recurrence, day_of_week, day_of_month, start_date }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO reminders (title, icon, color, recurrence, day_of_week, day_of_month, start_date)
    VALUES (@title, @icon, @color, @recurrence, @day_of_week, @day_of_month, @start_date)
  `).run({ title, icon: icon || 'fa-bell', color: color || '#ff79c6', recurrence, day_of_week: day_of_week ?? null, day_of_month: day_of_month ?? null, start_date: start_date || null });
  return result.lastInsertRowid;
}

function updateReminder(id, fields) {
  const db = getDb();
  const allowed = ['title', 'icon', 'color', 'recurrence', 'day_of_week', 'day_of_month', 'start_date', 'enabled'];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key] ?? null;
    }
  }
  if (!sets.length) return;
  db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

function deleteReminder(id) {
  const db = getDb();
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
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
  deleteEventsBySource,
  upsertCurrentWeather,
  getCurrentWeather,
  upsertForecastDay,
  getForecast,
  getAllCalendarSources,
  getEnabledCalendarSources,
  getCalendarSource,
  createCalendarSource,
  updateCalendarSource,
  markCalendarSynced,
  deleteCalendarSource,
  getSetting,
  setSetting,
  getAllBirthdays,
  getBirthday,
  getBirthdaysByMonth,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  getAllReminders,
  getReminder,
  getEnabledReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  close,
};
