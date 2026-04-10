// ─── db.js — SQLite schema & helpers ───
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'familydash.db');

let _db;

function getDb() {
  if (!_db) {
    if (DB_PATH !== ':memory:') {
      const dbDir = path.dirname(DB_PATH);
      fs.mkdirSync(dbDir, { recursive: true });
    }
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
      enabled       INTEGER DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS aurora_forecast (
      date          TEXT    PRIMARY KEY,         -- YYYY-MM-DD
      max_kp        REAL    NOT NULL DEFAULT 0,  -- highest Kp in that day's 3-hour windows
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      created_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Seed default settings (INSERT OR IGNORE so user changes are preserved)
  const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  // Weather location must be set by user during setup - no defaults
  seedSetting.run('weather_temp_unit', 'celsius');       // celsius | fahrenheit
  seedSetting.run('weather_wind_unit', 'kmh');           // ms | kmh | mph

  // ── Migrations for existing databases ──
  try { db.exec('ALTER TABLE calendar_sources ADD COLUMN last_synced TEXT'); } catch (_) { /* column already exists */ }
  try { db.exec('ALTER TABLE birthdays ADD COLUMN enabled INTEGER DEFAULT 1'); } catch (_) { /* column already exists */ }

  // ── Aurora forecast table (idempotent) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS aurora_forecast (
      date          TEXT    PRIMARY KEY,
      max_kp        REAL    NOT NULL DEFAULT 0,
      updated_at    TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── School holidays tables (idempotent) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS school_holiday_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      color         TEXT    DEFAULT '#50fa7b',
      enabled       INTEGER DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS school_holiday_dates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id     INTEGER NOT NULL,
      name          TEXT    NOT NULL,
      start_date    TEXT    NOT NULL,
      end_date      TEXT    NOT NULL,
      created_at    TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES school_holiday_sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_school_holiday_dates_source ON school_holiday_dates(source_id);
    CREATE INDEX IF NOT EXISTS idx_school_holiday_dates_range ON school_holiday_dates(start_date, end_date);
  `);

  // ── Seed Melbourne State Schools holidays if table is empty ──
  const sourceCount = db.prepare('SELECT COUNT(*) AS n FROM school_holiday_sources').get();
  if (sourceCount.n === 0) {
    const srcId = db.prepare(`
      INSERT INTO school_holiday_sources (name, color, enabled)
      VALUES ('Melbourne – State Schools', '#50fa7b', 1)
    `).run().lastInsertRowid;

    const insertPeriod = db.prepare(`
      INSERT INTO school_holiday_dates (source_id, name, start_date, end_date)
      VALUES (@source_id, @name, @start_date, @end_date)
    `);

    const melbournePeriods = [
      // 2025
      { name: 'Summer Holidays',          start_date: '2025-01-01', end_date: '2025-01-27' },
      { name: 'Autumn / Easter Holidays', start_date: '2025-04-05', end_date: '2025-04-22' },
      { name: 'Winter Holidays',          start_date: '2025-06-28', end_date: '2025-07-13' },
      { name: 'Spring Holidays',          start_date: '2025-09-20', end_date: '2025-10-05' },
      { name: 'Summer Holidays',          start_date: '2025-12-20', end_date: '2026-01-27' },
      // 2026
      { name: 'Autumn Holidays',          start_date: '2026-04-04', end_date: '2026-04-19' },
      { name: 'Winter Holidays',          start_date: '2026-06-27', end_date: '2026-07-12' },
      { name: 'Spring Holidays',          start_date: '2026-09-19', end_date: '2026-10-04' },
      { name: 'Summer Holidays',          start_date: '2026-12-19', end_date: '2027-01-26' },
    ];

    for (const p of melbournePeriods) {
      insertPeriod.run({ source_id: srcId, ...p });
    }
  }
}

// ───────── Password utilities ─────────
function hashPassword(password) {
  return crypto.pbkdf2Sync(password, 'calendar-salt', 100000, 64, 'sha256').toString('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

// ───────── Setup helpers ─────────
function isSetupComplete() {
  try {
    const db = getDb();
    const user = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    return user && user.count > 0;
  } catch (_) {
    return false;
  }
}

// ───────── User helpers ─────────
function createUser(username, password) {
  const db = getDb();
  const hash = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash) VALUES (@username, @hash)
  `).run({ username, hash });
  return result.lastInsertRowid;
}

function getUser(username) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

function verifyUser(username, password) {
  const user = getUser(username);
  if (!user) return false;
  return verifyPassword(password, user.password_hash);
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

function pruneForecastRange(startDate, endDate) {
  const db = getDb();
  db.prepare('DELETE FROM weather_forecast WHERE date < ? OR date > ?').run(startDate, endDate);
}

function getForecast(fromDate) {
  const db = getDb();
  if (fromDate) {
    return db.prepare('SELECT * FROM weather_forecast WHERE date >= ? ORDER BY date LIMIT 5').all(fromDate);
  }
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

function getEnabledBirthdays() {
  const db = getDb();
  return db.prepare('SELECT * FROM birthdays WHERE enabled = 1 ORDER BY month, day, name').all();
}

function createBirthday({ name, month, day, year }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO birthdays (name, month, day, year) VALUES (@name, @month, @day, @year)
  `).run({ name, month, day, year: year || null });
  return result.lastInsertRowid;
}

function updateBirthday(id, { name, month, day, year, enabled }) {
  const db = getDb();
  const fields = [];
  const params = { id };
  if (name != null)     { fields.push('name = @name');       params.name = name; }
  if (month != null)    { fields.push('month = @month');     params.month = month; }
  if (day != null)      { fields.push('day = @day');         params.day = day; }
  if (year !== undefined) { fields.push('year = @year');     params.year = year || null; }
  if (enabled !== undefined) { fields.push('enabled = @enabled'); params.enabled = enabled ? 1 : 0; }
  if (!fields.length) return;
  db.prepare(`UPDATE birthdays SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

function deleteBirthday(id) {
  const db = getDb();
  db.prepare('DELETE FROM birthdays WHERE id = ?').run(id);
}

// ───────── Aurora helpers ─────────
function upsertAuroraForecast(date, maxKp) {
  const db = getDb();
  db.prepare(`
    INSERT INTO aurora_forecast (date, max_kp, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET max_kp = excluded.max_kp, updated_at = excluded.updated_at
  `).run(date, maxKp);
}

function getAuroraForecast() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT date, max_kp FROM aurora_forecast WHERE date >= ? ORDER BY date').all(today);
}

function clearOldAurora() {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2);
  db.prepare('DELETE FROM aurora_forecast WHERE date < ?').run(cutoff.toISOString().slice(0, 10));
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

// ───────── School Holiday helpers ─────────
function getAllSchoolHolidaySources() {
  const db = getDb();
  return db.prepare('SELECT * FROM school_holiday_sources ORDER BY created_at').all();
}

function getSchoolHolidaySource(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM school_holiday_sources WHERE id = ?').get(id) || null;
}

function createSchoolHolidaySource({ name, color, enabled }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO school_holiday_sources (name, color, enabled)
    VALUES (@name, @color, @enabled)
  `).run({ name, color: color || '#50fa7b', enabled: enabled != null ? (enabled ? 1 : 0) : 1 });
  return result.lastInsertRowid;
}

function updateSchoolHolidaySource(id, { name, color, enabled }) {
  const db = getDb();
  const fields = [];
  const params = { id };
  if (name != null)    { fields.push('name = @name');       params.name = name; }
  if (color != null)   { fields.push('color = @color');     params.color = color; }
  if (enabled != null) { fields.push('enabled = @enabled'); params.enabled = enabled ? 1 : 0; }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE school_holiday_sources SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

function deleteSchoolHolidaySource(id) {
  const db = getDb();
  db.prepare('DELETE FROM school_holiday_dates WHERE source_id = ?').run(id);
  db.prepare('DELETE FROM school_holiday_sources WHERE id = ?').run(id);
}

function getSchoolHolidayDates(sourceId) {
  const db = getDb();
  return db.prepare('SELECT * FROM school_holiday_dates WHERE source_id = ? ORDER BY start_date').all(sourceId);
}

function replaceSchoolHolidayDates(sourceId, dates) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM school_holiday_dates WHERE source_id = ?').run(sourceId);
    const insert = db.prepare(`
      INSERT INTO school_holiday_dates (source_id, name, start_date, end_date)
      VALUES (@source_id, @name, @start_date, @end_date)
    `);
    for (const d of dates) {
      insert.run({ source_id: sourceId, name: d.name, start_date: d.start_date, end_date: d.end_date });
    }
  });
  tx();
}

function getActiveSchoolHolidays() {
  // Returns all holiday date ranges for enabled sources, with source colour
  const db = getDb();
  return db.prepare(`
    SELECT d.id, d.source_id, d.name, d.start_date, d.end_date, s.color
    FROM school_holiday_dates d
    JOIN school_holiday_sources s ON s.id = d.source_id
    WHERE s.enabled = 1
    ORDER BY d.start_date
  `).all();
}

// ───────── Cleanup ─────────
function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ───────── Backup / Restore helpers ─────────
function exportAllData() {
  const db = getDb();
  const calendarSources = db.prepare('SELECT * FROM calendar_sources ORDER BY created_at').all()
    .map(s => ({
      ...s,
      config: (() => {
        try { return JSON.parse(s.config || '{}'); } catch (_) { return {}; }
      })(),
      enabled: !!s.enabled,
    }));

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables: {
      events: db.prepare('SELECT * FROM events ORDER BY date, time').all(),
      weather_current: db.prepare('SELECT * FROM weather_current WHERE id = 1').get() || null,
      weather_forecast: db.prepare('SELECT * FROM weather_forecast ORDER BY date').all(),
      calendar_sources: calendarSources,
      settings: db.prepare('SELECT * FROM settings ORDER BY key').all(),
      birthdays: db.prepare('SELECT * FROM birthdays ORDER BY month, day, name').all(),
      reminders: db.prepare('SELECT * FROM reminders ORDER BY title').all(),
    },
  };
}

function importAllData(payload) {
  const db = getDb();
  const tables = payload?.tables || payload || {};

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM weather_current').run();
    db.prepare('DELETE FROM weather_forecast').run();
    db.prepare('DELETE FROM calendar_sources').run();
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM birthdays').run();
    db.prepare('DELETE FROM reminders').run();

    const events = tables.events || [];
    const weatherCurrent = tables.weather_current || null;
    const weatherForecast = tables.weather_forecast || [];
    const calendarSources = tables.calendar_sources || [];
    const settings = tables.settings || [];
    const birthdays = tables.birthdays || [];
    const reminders = tables.reminders || [];

    if (weatherCurrent) {
      db.prepare(`
        INSERT OR REPLACE INTO weather_current (id, temp, icon, description, wind_speed, wind_dir, humidity, sunrise, sunset, updated_at)
        VALUES (@id, @temp, @icon, @description, @wind_speed, @wind_dir, @humidity, @sunrise, @sunset, @updated_at)
      `).run({
        id: 1,
        temp: weatherCurrent.temp ?? null,
        icon: weatherCurrent.icon ?? null,
        description: weatherCurrent.description ?? null,
        wind_speed: weatherCurrent.wind_speed ?? null,
        wind_dir: weatherCurrent.wind_dir ?? null,
        humidity: weatherCurrent.humidity ?? null,
        sunrise: weatherCurrent.sunrise ?? null,
        sunset: weatherCurrent.sunset ?? null,
        updated_at: weatherCurrent.updated_at || null,
      });
    }

    const insertEvent = db.prepare(`
      INSERT OR REPLACE INTO events (id, date, time, title, color, source, source_id, updated_at)
      VALUES (@id, @date, @time, @title, @color, @source, @source_id, @updated_at)
    `);
    for (const e of events) {
      insertEvent.run({
        id: e.id ?? null,
        date: e.date,
        time: e.time ?? null,
        title: e.title,
        color: e.color ?? '#8be9fd',
        source: e.source ?? 'manual',
        source_id: e.source_id ?? null,
        updated_at: e.updated_at || null,
      });
    }

    const insertForecast = db.prepare(`
      INSERT OR REPLACE INTO weather_forecast (id, date, day_label, icon, hi, lo, updated_at)
      VALUES (@id, @date, @day_label, @icon, @hi, @lo, @updated_at)
    `);
    for (const f of weatherForecast) {
      insertForecast.run({
        id: f.id ?? null,
        date: f.date,
        day_label: f.day_label ?? null,
        icon: f.icon ?? null,
        hi: f.hi ?? null,
        lo: f.lo ?? null,
        updated_at: f.updated_at || null,
      });
    }

    const insertCalendar = db.prepare(`
      INSERT OR REPLACE INTO calendar_sources (id, name, type, color, enabled, config, last_synced, created_at, updated_at)
      VALUES (@id, @name, @type, @color, @enabled, @config, @last_synced, @created_at, @updated_at)
    `);
    for (const c of calendarSources) {
      insertCalendar.run({
        id: c.id ?? null,
        name: c.name,
        type: c.type,
        color: c.color ?? '#8be9fd',
        enabled: c.enabled ? 1 : 0,
        config: typeof c.config === 'string' ? c.config : JSON.stringify(c.config || {}),
        last_synced: c.last_synced || null,
        created_at: c.created_at || null,
        updated_at: c.updated_at || null,
      });
    }

    const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)');
    for (const s of settings) {
      if (!s.key) continue;
      insertSetting.run({ key: s.key, value: s.value ?? null });
    }

    const insertBirthday = db.prepare(`
      INSERT OR REPLACE INTO birthdays (id, name, month, day, year, created_at)
      VALUES (@id, @name, @month, @day, @year, @created_at)
    `);
    for (const b of birthdays) {
      insertBirthday.run({
        id: b.id ?? null,
        name: b.name,
        month: b.month,
        day: b.day,
        year: b.year ?? null,
        created_at: b.created_at || null,
      });
    }

    const insertReminder = db.prepare(`
      INSERT OR REPLACE INTO reminders (id, title, icon, color, recurrence, day_of_week, day_of_month, start_date, enabled, created_at)
      VALUES (@id, @title, @icon, @color, @recurrence, @day_of_week, @day_of_month, @start_date, @enabled, @created_at)
    `);
    for (const r of reminders) {
      insertReminder.run({
        id: r.id ?? null,
        title: r.title,
        icon: r.icon ?? 'fa-bell',
        color: r.color ?? '#ff79c6',
        recurrence: r.recurrence,
        day_of_week: r.day_of_week ?? null,
        day_of_month: r.day_of_month ?? null,
        start_date: r.start_date ?? null,
        enabled: r.enabled ? 1 : 0,
        created_at: r.created_at || null,
      });
    }
  });

  tx();
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
  pruneForecastRange,
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
  getEnabledBirthdays,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  upsertAuroraForecast,
  getAuroraForecast,
  clearOldAurora,
  getAllReminders,
  getReminder,
  getEnabledReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  getAllSchoolHolidaySources,
  getSchoolHolidaySource,
  createSchoolHolidaySource,
  updateSchoolHolidaySource,
  deleteSchoolHolidaySource,
  getSchoolHolidayDates,
  replaceSchoolHolidayDates,
  getActiveSchoolHolidays,
  close,
  exportAllData,
  importAllData,
  isSetupComplete,
  createUser,
  getUser,
  verifyUser,
};
