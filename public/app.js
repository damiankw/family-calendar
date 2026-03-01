// ─── FamilyDash — app.js ───
// Front-end reads everything from the API (backed by SQLite).
// The worker.js process keeps the DB populated independently.

(function () {
  'use strict';

  const REFRESH_MS = 60 * 1000; // 1 minute

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

  // Keyed by "MM-DD" → array of { name, year }
  let birthdaysMap = {};

  // Raw reminder objects from the API
  let remindersRaw = [];

  // Aurora forecast keyed by "YYYY-MM-DD" → { max_kp, visibility }
  let auroraMap = {};
  let auroraHemisphere = 'borealis';
  let auroraTodayVisibility = 'unlikely';

  // Unit settings (fetched from API)
  let tempUnit   = 'celsius';   // 'celsius' | 'fahrenheit'
  let windUnit   = 'kmh';       // 'kmh' | 'mph' | 'ms'
  let showTemp     = true;
  let showDetails  = true;
  let showForecast = true;
  let showAurora   = true;

  // ── Unit-conversion helpers (stored data is always metric) ──
  function convertTemp(c) {
    if (tempUnit === 'fahrenheit') return Math.round(c * 9 / 5 + 32);
    return Math.round(c);
  }
  function tempSymbol() {
    return tempUnit === 'fahrenheit' ? '°F' : '°C';
  }
  function convertWind(kmh) {
    if (windUnit === 'mph') return Math.round(kmh * 0.621371);
    if (windUnit === 'ms')  return Math.round(kmh / 3.6);
    return Math.round(kmh);
  }
  function windLabel() {
    const map = { ms: 'm/s', kmh: 'km/h', mph: 'mph' };
    return map[windUnit] || 'km/h';
  }

  // ───────── Fetch helpers ─────────

  async function fetchWeatherSettings() {
    try {
      const res = await fetch('/api/settings/weather');
      const s   = await res.json();
      tempUnit   = s.temp_unit || 'celsius';
      windUnit   = s.wind_unit || 'kmh';
      showTemp     = s.show_temp !== false;
      showDetails  = s.show_details !== false;
      showForecast = s.show_forecast !== false;
      showAurora   = s.show_aurora !== false;
    } catch (e) {
      console.warn('Failed to fetch weather settings:', e);
    }
  }

  async function fetchBirthdays() {
    try {
      const res  = await fetch('/api/birthdays/enabled');
      const rows = await res.json();
      birthdaysMap = {};
      for (const b of rows) {
        const key = `${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
        if (!birthdaysMap[key]) birthdaysMap[key] = [];
        birthdaysMap[key].push({ name: b.name, year: b.year });
      }
    } catch (e) {
      console.warn('Failed to fetch birthdays:', e);
    }
  }

  async function fetchReminders() {
    try {
      const res  = await fetch('/api/reminders/enabled');
      remindersRaw = await res.json();
    } catch (e) {
      console.warn('Failed to fetch reminders:', e);
    }
  }

  async function fetchAurora() {
    try {
      const res  = await fetch('/api/weather/aurora');
      const data = await res.json();
      auroraHemisphere = data.hemisphere || 'borealis';
      auroraMap = {};
      const today = new Date().toISOString().slice(0, 10);
      for (const d of (data.days || [])) {
        auroraMap[d.date] = { max_kp: d.max_kp, visibility: d.visibility };
        if (d.date === today) auroraTodayVisibility = d.visibility;
      }

      // Render the aurora bar in the weather section
      const auroraBar = document.getElementById('aurora-bar');
      if (auroraBar) {
        auroraBar.style.display = showAurora ? '' : 'none';
        if (showAurora) {
          const name = auroraHemisphere === 'australis' ? 'Aurora Australis' : 'Aurora Borealis';
          document.getElementById('aurora-name').textContent = name;

          const v = auroraTodayVisibility;
          const badge = document.getElementById('aurora-badge');
          badge.className = 'aurora-badge aurora-' + v;
          if (v === 'visible') {
            badge.textContent = 'Visible tonight';
            document.getElementById('aurora-icon').textContent = '🌌';
          } else if (v === 'possible') {
            badge.textContent = 'Possible';
            document.getElementById('aurora-icon').textContent = '✨';
          } else {
            badge.textContent = 'Unlikely';
            document.getElementById('aurora-icon').textContent = '☀';
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch aurora:', e);
    }
  }

  // Check if a reminder fires on a given date (JS Date object)
  function reminderMatchesDate(r, date) {
    const dow = date.getDay(); // 0=Sun…6=Sat
    if (r.recurrence === 'weekly') {
      return dow === r.day_of_week;
    }
    if (r.recurrence === 'fortnightly') {
      if (dow !== r.day_of_week) return false;
      if (!r.start_date) return true; // no anchor → treat as weekly
      // Compare using UTC-normalised midnights to avoid timezone drift
      const dateUtc   = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      const [ay, am, ad] = r.start_date.split('-').map(Number);
      const anchorUtc = Date.UTC(ay, am - 1, ad);
      const diffDays  = Math.round((dateUtc - anchorUtc) / 86400000);
      return (diffDays % 14 + 14) % 14 === 0;
    }
    if (r.recurrence === 'monthly') {
      return date.getDate() === r.day_of_month;
    }
    return false;
  }

  // Get reminders that fire on a specific date
  function remindersForDate(date) {
    return remindersRaw.filter(r => reminderMatchesDate(r, date));
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
      // Apply visibility settings to dashboard sections
      const weatherMain    = document.querySelector('.weather-main');
      const detailsEl      = document.querySelector('.weather-details');
      const forecastSection = document.querySelector('.forecast');

      if (weatherMain)     weatherMain.style.display     = showTemp ? '' : 'none';
      if (detailsEl)       detailsEl.style.display       = showDetails ? '' : 'none';
      if (forecastSection) forecastSection.style.display  = showForecast ? '' : 'none';

      const [curRes, fcRes] = await Promise.all([
        fetch('/api/weather/current'),
        fetch('/api/weather/forecast'),
      ]);
      const current  = await curRes.json();
      const forecast = await fcRes.json();

      // Current weather (stored in metric – convert for display)
      if (current && current.temp != null) {
        document.getElementById('current-temp').textContent = `${convertTemp(current.temp)}${tempSymbol()}`;
        const iconEl = document.getElementById('current-icon');
        iconEl.className = `wi weather-icon ${current.icon || 'wi-day-cloudy'}`;
        document.getElementById('wind-speed').textContent   = `${convertWind(current.wind_speed)} ${windLabel()} ${current.wind_dir || ''}`.trim();
        document.getElementById('humidity').textContent      = `${current.humidity}%`;
        document.getElementById('sunrise').textContent       = current.sunrise || '';
        document.getElementById('sunset').textContent        = current.sunset || '';
      }

      // Forecast (stored in metric – convert for display)
      if (forecast && forecast.length) {
        forecast.forEach((f, i) => {
          const el = document.getElementById(`forecast-${i}`);
          if (!el) return;
          el.querySelector('.forecast-label').textContent = f.day_label || '';
          const fIcon = el.querySelector('.forecast-icon');
          fIcon.className = `wi forecast-icon ${f.icon || 'wi-na'}`;
          el.querySelector('.hi').textContent             = `${convertTemp(f.hi)}°`;
          el.querySelector('.lo').textContent             = `${convertTemp(f.lo)}°`;
        });
      }
    } catch (e) {
      console.warn('Failed to fetch weather:', e);
    }
  }

  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function dayLabel(offset) {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    const d = new Date(); d.setDate(d.getDate() + offset);
    return DAY_NAMES[d.getDay()];
  }

  function buildDayGroups(count) {
    const section = document.getElementById('events-section');
    section.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const group = document.createElement('div');
      group.className = 'events-group';
      group.dataset.day = i;
      group.innerHTML = `
        <h3 class="events-heading">${dayLabel(i)}</h3>
        <ul class="events-list" id="events-day-${i}"></ul>
      `;
      section.appendChild(group);
    }
  }

  async function fetchTodayTomorrow() {
    const numDays = isMobile() ? 7 : 2;
    buildDayGroups(numDays);

    const now = new Date();

    try {
      const fetches = [];
      for (let i = 0; i < numDays; i++) {
        const d = new Date(now); d.setDate(d.getDate() + i);
        fetches.push(fetch(`/api/events/${dateKey(d.getFullYear(), d.getMonth(), d.getDate())}`));
      }
      const responses = await Promise.all(fetches);
      const allEvents = await Promise.all(responses.map(r => r.json()));

      for (let i = 0; i < numDays; i++) {
        const d = new Date(now); d.setDate(d.getDate() + i);
        const bdays = birthdaysForDate(d.getMonth() + 1, d.getDate());
        const rems  = remindersForDate(d).map(r => ({
          time: null, color: r.color, title: r.title, _reminder: true, _icon: r.icon || 'fa-bell'
        }));
        renderEventsList(`events-day-${i}`, [...bdays, ...rems, ...allEvents[i]]);
      }
    } catch (e) {
      console.warn('Failed to fetch schedule events:', e);
    }
  }

  // Build birthday pseudo-events for the left panel schedule
  function birthdaysForDate(month, day) {
    const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const list = birthdaysMap[key];
    if (!list || !list.length) return [];
    return list.map(b => {
      let label = `\uD83C\uDF82 ${b.name}'s Birthday`;
      if (b.year) {
        const now = new Date();
        let age = now.getFullYear() - b.year;
        if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--;
        label += ` (turns ${age + 1})`;
      }
      return { time: null, color: '#f1c40f', title: label, _birthday: true };
    });
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
      if (ev._reminder) {
        // Reminder: "Reminder" in time slot, coloured icon where dot goes, then title
        li.innerHTML = `
          <span class="event-time all-day">Reminder</span>
          <span class="event-dot" style="background:transparent; display:flex; align-items:center; justify-content:center"><i class="fa-solid ${ev._icon || 'fa-bell'}" style="color:${ev.color || '#ff79c6'}; font-size:1vw"></i></span>
          <span class="event-title">${ev.title}</span>
        `;
      } else {
        let timeHtml;
        if (ev._birthday) {
          timeHtml = '<span class="event-time all-day">\uD83C\uDF82</span>';
        } else {
          const displayTime = (!ev.time || ev.time === '00:00') ? 'All Day' : ev.time;
          timeHtml = `<span class="event-time${displayTime === 'All Day' ? ' all-day' : ''}">${displayTime}</span>`;
        }
        li.innerHTML = `
          ${timeHtml}
          <span class="event-dot" style="background:${ev.color || '#8be9fd'}"></span>
          <span class="event-title">${ev.title}</span>
        `;
      }
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

    // Day number header (number + optional birthday icon)
    const header = document.createElement('div');
    header.className = 'day-header';

    const num = document.createElement('span');
    num.className = 'day-number';
    num.textContent = day;
    header.appendChild(num);

    // Birthday indicator(s)
    const bdayKey = `${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const bdays = birthdaysMap[bdayKey];
    if (bdays && bdays.length) {
      for (const b of bdays) {
        const tag = document.createElement('span');
        tag.className = 'birthday-tag';
        tag.innerHTML = `\uD83C\uDF82 ${b.name}`;
        header.appendChild(tag);
      }
    }

    // Aurora indicator
    if (showAurora) {
      const aKey = dateKey(year, month, day);
      const aurora = auroraMap[aKey];
      if (aurora && (aurora.visibility === 'visible' || aurora.visibility === 'possible')) {
        const aTag = document.createElement('span');
        aTag.className = `aurora-tag aurora-${aurora.visibility}`;
        aTag.textContent = aurora.visibility === 'visible' ? '🌌 Aurora' : '✨ Aurora?';
        header.appendChild(aTag);
      }
    }

    cell.appendChild(header);

    // Events container
    const eventsDiv = document.createElement('div');
    eventsDiv.className = 'day-events';

    // Inject reminders at the top of the events list
    const cellDate = new Date(year, month, day);
    const dayReminders = remindersForDate(cellDate);
    const reminderItems = dayReminders.map(r => ({
      title: r.title,
      color: r.color || '#ff79c6',
      _reminderIcon: r.icon || 'fa-bell',
    }));

    const key = dateKey(year, month, day);
    const events = eventsMap[key] || [];

    // Combine reminders + events, then apply the visible limit
    const combined = [...reminderItems, ...events];
    const visible = combined.slice(0, MAX_VISIBLE_EVENTS);
    const remaining = combined.length - visible.length;

    visible.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'cal-event';

      if (ev._reminderIcon) {
        // Render reminder with FA icon instead of dot
        const icon = document.createElement('i');
        icon.className = `fa-solid ${ev._reminderIcon}`;
        icon.style.color = ev.color;
        icon.style.fontSize = '0.65vw';
        icon.style.flexShrink = '0';
        item.appendChild(icon);
      } else {
        const dot = document.createElement('span');
        dot.className = 'cal-event-dot';
        dot.style.background = ev.color;
        item.appendChild(dot);
      }

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
    await Promise.all([fetchEvents(), fetchWeather(), fetchBirthdays(), fetchReminders(), fetchAurora()]);
    buildCalendar();
    await fetchTodayTomorrow();
  }

  // Initial load + recurring refresh
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);

})();
