// ─── sync.js — Shared calendar sync logic ───
// Used by both worker.js (scheduled) and server.js (on-demand sync endpoint).

const db = require('./db');
const ical = require('node-ical');

// ── Sync a single calendar source by ID ──
async function syncCalendarSource(id) {
  const src = db.getCalendarSource(id);
  if (!src) throw new Error(`Calendar source ${id} not found`);

  const config    = JSON.parse(src.config || '{}');
  const sourceKey = `cal-${src.id}`;

  if (src.type === 'ics') {
    return await syncIcsCalendar(src, config, sourceKey);
  } else if (src.type === 'google') {
    throw new Error('Google OAuth integration not yet implemented');
  } else if (src.type === 'microsoft') {
    throw new Error('Microsoft OAuth integration not yet implemented');
  } else {
    throw new Error(`Unknown calendar type: ${src.type}`);
  }
}

// ── Sync all enabled calendar sources ──
async function syncAllCalendars() {
  const sources = db.getEnabledCalendarSources();
  let totalEvents = 0;

  for (const src of sources) {
    try {
      const count = await syncCalendarSource(src.id);
      totalEvents += count;
    } catch (e) {
      console.error(`[sync] ✕ Error syncing "${src.name}":`, e.message);
    }
  }

  return { sources: sources.length, events: totalEvents };
}

// ── ICS feed sync ──
async function syncIcsCalendar(src, config, sourceKey) {
  const url = config.url;
  if (!url) throw new Error(`No URL configured for "${src.name}"`);

  const events = await ical.async.fromURL(url);
  let count = 0;

  const now        = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rangeEnd   = new Date(now.getFullYear(), now.getMonth() + 4, 0);

  // Clear existing events from this source before re-populating
  db.deleteEventsBySource(sourceKey);

  for (const [uid, ev] of Object.entries(events)) {
    if (ev.type !== 'VEVENT') continue;

    const occurrences = getEventOccurrences(ev, rangeStart, rangeEnd);

    for (const occ of occurrences) {
      const dateStr = formatDate(occ.start);
      const timeStr = occ.allDay ? null : formatTimeHHMM(occ.start);
      const title   = icalText(ev.summary) || '(No title)';

      db.upsertEvent({
        date:      dateStr,
        time:      timeStr,
        title:     title,
        color:     src.color || '#8be9fd',
        source:    sourceKey,
        source_id: `${sourceKey}-${uid}-${dateStr}`,
      });
      count++;
    }
  }

  // Mark last_synced timestamp
  db.markCalendarSynced(src.id);

  return count;
}

// ───────── Helpers ─────────

function getEventOccurrences(ev, rangeStart, rangeEnd) {
  const occurrences = [];

  if (ev.rrule) {
    try {
      const dates = ev.rrule.between(rangeStart, rangeEnd, true);
      for (const d of dates) {
        const isAllDay = !ev.start || isAllDayEvent(ev);
        occurrences.push({ start: d, allDay: isAllDay });
      }
    } catch (e) {
      addSingleOccurrence(ev, rangeStart, rangeEnd, occurrences);
    }
  } else {
    addSingleOccurrence(ev, rangeStart, rangeEnd, occurrences);
  }

  return occurrences;
}

function addSingleOccurrence(ev, rangeStart, rangeEnd, occurrences) {
  if (!ev.start) return;
  const start = new Date(ev.start);
  if (start >= rangeStart && start <= rangeEnd) {
    occurrences.push({ start, allDay: isAllDayEvent(ev) });
  }
}

function isAllDayEvent(ev) {
  if (!ev.start) return true;
  if (ev.start.dateOnly) return true;
  if (ev.datetype === 'date') return true;
  const s = new Date(ev.start);
  return s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0 &&
         ev.end && (new Date(ev.end) - s) % (86400000) === 0;
}

function formatDate(d) {
  const dt = new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatTimeHHMM(d) {
  const dt = new Date(d);
  const h  = String(dt.getHours()).padStart(2, '0');
  const m  = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function icalText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.val != null) return String(v.val);
  return String(v);
}

module.exports = { syncCalendarSource, syncAllCalendars };
