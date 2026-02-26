// ─── Digital Calendar Wallboard — app.js ───
// Front-end reads everything from the API (backed by SQLite).
// The worker.js process keeps the DB populated independently.

(function () {
  'use strict';

  const REFRESH_MS = 5 * 60 * 1000; // 5 minutes — matches worker interval

  // ───────── Clock ─────────
  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const mins  = String(now.getMinutes()).padStart(2, '0');
    const ampm  = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    document.getElementById('clock-time').textContent = `${hours}:${mins}`;
    document.getElementById('clock-ampm').textContent = ampm;

    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    document.getElementById('clock-date').textContent =
      `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
  }

  updateClock();
  setInterval(updateClock, 1000);

  // ───────── Data cache (populated from API) ─────────
  // Keyed by "YYYY-MM-DD" → array of { title, color, time }
  let eventsMap = {};

  // Unit settings (fetched from API)
  let tempSymbol = '°';
  let windLabel  = 'km/h';

  // ───────── Fetch helpers ─────────

  async function fetchWeatherSettings() {
    try {
      const res = await fetch('/api/settings/weather');
      const s   = await res.json();
      tempSymbol = s.temp_unit === 'fahrenheit' ? '°F' : '°C';
      const windMap = { ms: 'm/s', kmh: 'km/h', mph: 'mph' };
      windLabel = windMap[s.wind_unit] || 'km/h';
    } catch (e) {
      console.warn('Failed to fetch weather settings:', e);
    }
  }

  async function fetchEvents() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1; // 1-based
    try {
      const res  = await fetch(`/api/events?year=${year}&month=${month}&includeNext=1`);
      const rows = await res.json();
      // Group by date
      eventsMap = {};
      for (const row of rows) {
        if (!eventsMap[row.date]) eventsMap[row.date] = [];
        eventsMap[row.date].push({ title: row.title, color: row.color, time: row.time });
      }
    } catch (e) {
      console.warn('Failed to fetch events:', e);
    }
  }

  async function fetchWeather() {
    try {
      const [curRes, fcRes] = await Promise.all([
        fetch('/api/weather/current'),
        fetch('/api/weather/forecast'),
      ]);
      const current  = await curRes.json();
      const forecast = await fcRes.json();

      // Current weather
      if (current && current.temp != null) {
        document.getElementById('current-temp').textContent = `${Math.round(current.temp)}${tempSymbol}`;
        document.getElementById('current-icon').textContent = current.icon || '⛅';
        document.getElementById('wind-speed').textContent   = `${current.wind_speed} ${windLabel} ${current.wind_dir || ''}`.trim();
        document.getElementById('humidity').textContent      = `${current.humidity}%`;
        document.getElementById('sunrise').textContent       = current.sunrise || '';
        document.getElementById('sunset').textContent        = current.sunset || '';
      }

      // Forecast
      if (forecast && forecast.length) {
        forecast.forEach((f, i) => {
          const el = document.getElementById(`forecast-${i}`);
          if (!el) return;
          el.querySelector('.forecast-label').textContent = f.day_label || '';
          el.querySelector('.forecast-icon').textContent  = f.icon || '';
          el.querySelector('.hi').textContent             = `${Math.round(f.hi)}°`;
          el.querySelector('.lo').textContent             = `${Math.round(f.lo)}°`;
        });
      }
    } catch (e) {
      console.warn('Failed to fetch weather:', e);
    }
  }

  async function fetchTodayTomorrow() {
    const now = new Date();
    const todayStr    = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    const tom         = new Date(now); tom.setDate(tom.getDate() + 1);
    const tomorrowStr = dateKey(tom.getFullYear(), tom.getMonth(), tom.getDate());

    try {
      const [todayRes, tomRes] = await Promise.all([
        fetch(`/api/events/${todayStr}`),
        fetch(`/api/events/${tomorrowStr}`),
      ]);
      const todayEvents = await todayRes.json();
      const tomEvents   = await tomRes.json();

      renderEventsList('events-today', todayEvents);
      renderEventsList('events-tomorrow', tomEvents);
    } catch (e) {
      console.warn('Failed to fetch today/tomorrow events:', e);
    }
  }

  function renderEventsList(elementId, events) {
    const ul = document.getElementById(elementId);
    ul.innerHTML = '';
    if (!events.length) {
      const li = document.createElement('li');
      li.className = 'event';
      li.innerHTML = '<span class="event-title" style="opacity:0.35">Nothing scheduled</span>';
      ul.appendChild(li);
      return;
    }
    for (const ev of events) {
      const li = document.createElement('li');
      li.className = 'event';
      li.innerHTML = `
        <span class="event-time">${ev.time || ''}</span>
        <span class="event-dot" style="background:${ev.color || '#8be9fd'}"></span>
        <span class="event-title">${ev.title}</span>
      `;
      ul.appendChild(li);
    }
  }

  // Max events to show per cell before "+N more"
  const MAX_VISIBLE_EVENTS = 3;

  // ───────── Helpers ─────────
  function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function createDayCell(year, month, day, extraClasses) {
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (extraClasses ? ' ' + extraClasses : '');

    // Day number
    const num = document.createElement('span');
    num.className = 'day-number';
    num.textContent = day;
    cell.appendChild(num);

    // Events container
    const eventsDiv = document.createElement('div');
    eventsDiv.className = 'day-events';

    const key = dateKey(year, month, day);
    const events = eventsMap[key] || [];

    const visible = events.slice(0, MAX_VISIBLE_EVENTS);
    const remaining = events.length - visible.length;

    visible.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'cal-event';

      const dot = document.createElement('span');
      dot.className = 'cal-event-dot';
      dot.style.background = ev.color;
      item.appendChild(dot);

      const text = document.createElement('span');
      text.className = 'cal-event-text';
      text.textContent = ev.title;
      item.appendChild(text);

      eventsDiv.appendChild(item);
    });

    if (remaining > 0) {
      const more = document.createElement('span');
      more.className = 'cal-event-more';
      more.textContent = `+${remaining} more`;
      eventsDiv.appendChild(more);
    }

    cell.appendChild(eventsDiv);
    return cell;
  }

  // ───────── Calendar Grid ─────────
  function buildCalendar() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const today = now.getDate();

    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    document.getElementById('calendar-month').textContent = `${months[month]} ${year}`;

    const grid = document.querySelector('.calendar-grid');

    // Remove existing day cells (keep the 7 .dow headers)
    grid.querySelectorAll('.day-cell, .month-label').forEach(el => el.remove());

    const firstDay    = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Previous month trailing days
    const prevMonth     = month === 0 ? 11 : month - 1;
    const prevYear      = month === 0 ? year - 1 : year;
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const cell = createDayCell(prevYear, prevMonth, d, 'other-month');
      grid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const classes = d === today ? 'today' : '';
      const cell = createDayCell(year, month, d, classes);
      grid.appendChild(cell);
    }

    // Next month leading days to fill last row
    const totalCells    = firstDay + daysInMonth;
    const trailingCells = (7 - (totalCells % 7)) % 7;
    const nextMonth     = (month + 1) % 12;
    const nextYear      = month === 11 ? year + 1 : year;
    const nextMonthName = months[nextMonth];
    const daysInNext    = new Date(nextYear, nextMonth + 1, 0).getDate();

    for (let d = 1; d <= trailingCells; d++) {
      const cell = createDayCell(nextYear, nextMonth, d, 'other-month');
      grid.appendChild(cell);
    }

    // ── Extra rows from next month to fill the screen ──
    let nextDayStart = trailingCells + 1;
    const currentRows = Math.ceil(totalCells / 7);
    const extraRows   = Math.max(0, 6 - currentRows);

    if (extraRows > 0 && nextDayStart <= daysInNext) {
      const label = document.createElement('div');
      label.className = 'month-label';
      label.textContent = nextMonthName;
      grid.appendChild(label);

      const startDow = new Date(nextYear, nextMonth, nextDayStart).getDay();

      for (let b = 0; b < startDow; b++) {
        const blank = document.createElement('div');
        blank.className = 'day-cell empty';
        grid.appendChild(blank);
      }

      const maxExtraDays = extraRows * 7 - startDow;
      const endDay = Math.min(nextDayStart + maxExtraDays - 1, daysInNext);

      for (let d = nextDayStart; d <= endDay; d++) {
        const cell = createDayCell(nextYear, nextMonth, d, 'other-month');
        grid.appendChild(cell);
      }
    }
  }

  // ───────── Refresh cycle ─────────
  async function refreshAll() {
    await fetchWeatherSettings();
    await Promise.all([fetchEvents(), fetchWeather()]);
    buildCalendar();
    await fetchTodayTomorrow();
  }

  // Initial load + recurring refresh
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);

})();
