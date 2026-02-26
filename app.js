// ─── Digital Calendar Wallboard — app.js ───
// All data is hardcoded / mock for template purposes.

(function () {
  'use strict';

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

  // ───────── Mock Events Data ─────────
  // Keyed by "YYYY-MM-DD" → array of { title, color }
  const MOCK_EVENTS = {
    '2026-02-02': [
      { title: 'Swimming — kids',  color: '#8be9fd' },
    ],
    '2026-02-05': [
      { title: 'Parent-teacher',   color: '#ff5555' },
      { title: 'Piano — Emma',     color: '#bd93f9' },
    ],
    '2026-02-10': [
      { title: 'Dentist — Mum',    color: '#50fa7b' },
    ],
    '2026-02-14': [
      { title: "Valentine's dinner", color: '#ff79c6' },
      { title: 'School disco',      color: '#ffb86c' },
    ],
    '2026-02-17': [
      { title: 'Vet — Biscuit',    color: '#f1fa8c' },
    ],
    '2026-02-20': [
      { title: 'Soccer finals',    color: '#50fa7b' },
      { title: 'Haircuts',         color: '#8be9fd' },
    ],
    '2026-02-24': [
      { title: 'Groceries',        color: '#ffb86c' },
    ],
    '2026-02-26': [
      { title: 'School drop-off',  color: '#ff5555' },
      { title: 'Dentist — Mum',    color: '#50fa7b' },
      { title: 'Soccer — Liam',    color: '#8be9fd' },
    ],
    '2026-02-27': [
      { title: 'Grocery shop',     color: '#ffb86c' },
      { title: 'Play date — Emma', color: '#bd93f9' },
    ],
    '2026-02-28': [
      { title: 'Family BBQ',       color: '#ff79c6' },
    ],
    '2026-03-02': [
      { title: 'Swimming — kids',  color: '#8be9fd' },
    ],
    '2026-03-05': [
      { title: 'Book club — Dad',  color: '#f1fa8c' },
    ],
    '2026-03-07': [
      { title: 'Birthday — Nana',  color: '#ff79c6' },
      { title: 'Cake pickup',      color: '#ffb86c' },
    ],
    '2026-03-12': [
      { title: 'School photos',    color: '#bd93f9' },
    ],
    '2026-03-14': [
      { title: 'Soccer semis',     color: '#50fa7b' },
    ],
  };

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
    const events = MOCK_EVENTS[key] || [];

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
      // Month separator label
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

  buildCalendar();

  // Rebuild calendar at midnight
  function msUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
  }

  setTimeout(function rebuildAtMidnight() {
    buildCalendar();
    updateClock();
    setTimeout(rebuildAtMidnight, msUntilMidnight());
  }, msUntilMidnight());

})();
