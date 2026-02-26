// ─── admin.js — Settings panel UI interactions ───
// Calendars: full CRUD wired to /api/calendars
// Weather: full settings wired to /api/settings/weather

(function () {
  'use strict';

  // ═══════════════════════════════════════
  //  SIDEBAR NAVIGATION
  // ═══════════════════════════════════════

  const navItems   = document.querySelectorAll('.nav-item');
  const sections   = document.querySelectorAll('.settings-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.section;

      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(s => {
        s.classList.toggle('active', s.id === `section-${target}`);
      });

      // Remember active tab across refreshes
      try { localStorage.setItem('admin-tab', target); } catch (_) {}
    });
  });

  // Restore last active tab on load
  try {
    const saved = localStorage.getItem('admin-tab');
    if (saved) {
      const btn = document.querySelector(`.nav-item[data-section="${saved}"]`);
      if (btn) btn.click();
    }
  } catch (_) {}

  // ═══════════════════════════════════════
  //  MODAL HELPERS
  // ═══════════════════════════════════════

  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });

  // ═══════════════════════════════════════
  //  CALENDARS — fully wired to backend
  // ═══════════════════════════════════════

  const calModal     = 'modal-calendar';
  const deleteModal  = 'modal-delete';
  const calList      = document.getElementById('calendar-list');
  const calEmpty     = document.getElementById('calendar-empty');

  // In-memory list refreshed from API
  let calendars = [];
  // Track which calendar we're editing (null = creating new)
  let editingCalId = null;

  const TYPE_LABELS = {
    google:    'Google Calendar',
    microsoft: 'Microsoft 365',
    ics:       'ICS URL',
  };

  // ── Load calendars on page load ──
  async function loadCalendars() {
    try {
      const res = await fetch('/api/calendars');
      calendars = await res.json();
      renderCalendarList();
    } catch (e) {
      console.warn('Failed to load calendars:', e);
    }
  }

  loadCalendars();

  // ── Render the card list ──
  function renderCalendarList() {
    calList.innerHTML = '';

    if (!calendars.length) {
      calEmpty.style.display = '';
      return;
    }
    calEmpty.style.display = 'none';

    for (const cal of calendars) {
      const card = document.createElement('div');
      card.className = 'card' + (cal.enabled ? '' : ' card-disabled');
      card.dataset.id = cal.id;

      const subtitle = buildSubtitle(cal);

      card.innerHTML = `
        <div class="card-left">
          <span class="cal-color-dot" style="background: ${cal.color}"></span>
          <div class="card-info">
            <span class="card-title">${esc(cal.name)}</span>
            <span class="card-subtitle">${esc(subtitle)}</span>
          </div>
        </div>
        <div class="card-right">
          <span class="badge ${cal.enabled ? 'badge-connected' : 'badge-disabled'}">${cal.enabled ? 'Enabled' : 'Disabled'}</span>
          <label class="toggle">
            <input type="checkbox" ${cal.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-icon-only btn-sync" title="Sync now"><span>🔄</span></button>
          <button class="btn-icon-only btn-edit" title="Edit"><span>✏️</span></button>
          <button class="btn-icon-only btn-delete" title="Remove"><span>🗑️</span></button>
        </div>
      `;

      // Toggle enable/disable
      card.querySelector('.toggle input').addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        try {
          const res = await fetch(`/api/calendars/${cal.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          });
          const updated = await res.json();
          cal.enabled = updated.enabled;
          const badge = card.querySelector('.badge');
          card.classList.toggle('card-disabled', !cal.enabled);
          badge.className = `badge ${cal.enabled ? 'badge-connected' : 'badge-disabled'}`;
          badge.textContent = cal.enabled ? 'Enabled' : 'Disabled';
        } catch (err) {
          console.error('Toggle failed:', err);
          e.target.checked = !enabled; // revert
        }
      });

      // Sync button
      card.querySelector('.btn-sync').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('spinning');
        btn.disabled = true;
        try {
          const res = await fetch(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Sync failed');
          // Flash success
          const badge = card.querySelector('.badge');
          const origText = badge.textContent;
          const origClass = badge.className;
          badge.className = 'badge badge-connected';
          badge.textContent = `✓ ${data.events} events`;
          setTimeout(() => {
            badge.className = origClass;
            badge.textContent = origText;
          }, 3000);
        } catch (err) {
          const badge = card.querySelector('.badge');
          const origText = badge.textContent;
          const origClass = badge.className;
          badge.className = 'badge badge-error';
          badge.textContent = '✕ Sync failed';
          setTimeout(() => {
            badge.className = origClass;
            badge.textContent = origText;
          }, 3000);
          console.error('Sync error:', err);
        }
        btn.classList.remove('spinning');
        btn.disabled = false;
      });

      // Edit button
      card.querySelector('.btn-edit').addEventListener('click', () => {
        openEditModal(cal);
      });

      // Delete button
      card.querySelector('.btn-delete').addEventListener('click', () => {
        openDeleteModal(cal);
      });

      calList.appendChild(card);
    }
  }

  function buildSubtitle(cal) {
    const typeLabel = TYPE_LABELS[cal.type] || cal.type;
    if (cal.type === 'ics' && cal.config?.url) {
      const url = cal.config.url.length > 45 ? cal.config.url.slice(0, 42) + '…' : cal.config.url;
      return `${typeLabel} · ${url}`;
    }
    return typeLabel;
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Type picker ──
  const typePicker   = document.getElementById('cal-type-picker');
  const typeButtons  = typePicker.querySelectorAll('.type-option');
  const typeFieldSets = {
    google:    document.getElementById('fields-google'),
    microsoft: document.getElementById('fields-microsoft'),
    ics:       document.getElementById('fields-ics'),
  };

  typeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      typeButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const type = btn.dataset.type;
      Object.entries(typeFieldSets).forEach(([key, el]) => {
        el.classList.toggle('hidden', key !== type);
      });
    });
  });

  // ── Colour picker ──
  const colorPicker   = document.getElementById('cal-color-picker');
  const colorSwatches = colorPicker.querySelectorAll('.color-swatch');

  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
  });

  // ── Auth buttons (placeholder — OAuth not yet implemented) ──
  document.getElementById('btn-google-auth').addEventListener('click', () => {
    document.getElementById('google-auth-status').innerHTML =
      '<span style="color:#ffb86c">⚠ Google OAuth integration coming soon. Use ICS URL for now.</span>';
  });

  document.getElementById('btn-ms-auth').addEventListener('click', () => {
    document.getElementById('ms-auth-status').innerHTML =
      '<span style="color:#ffb86c">⚠ Microsoft OAuth integration coming soon. Use ICS URL for now.</span>';
  });

  // ── Open Add modal ──
  document.getElementById('btn-add-calendar').addEventListener('click', () => {
    editingCalId = null;
    document.getElementById('modal-calendar-title').textContent = 'Add Calendar';
    document.getElementById('btn-calendar-save').textContent = 'Add Calendar';
    resetCalendarForm();
    openModal(calModal);
  });

  // ── Open Edit modal ──
  function openEditModal(cal) {
    editingCalId = cal.id;
    document.getElementById('modal-calendar-title').textContent = 'Edit Calendar';
    document.getElementById('btn-calendar-save').textContent = 'Save Changes';
    resetCalendarForm();

    // Populate fields
    document.getElementById('cal-name').value = cal.name;

    // Select type
    typeButtons.forEach(b => {
      b.classList.toggle('selected', b.dataset.type === cal.type);
    });
    Object.entries(typeFieldSets).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== cal.type);
    });

    // Select colour
    colorSwatches.forEach(s => {
      s.classList.toggle('selected', s.dataset.color === cal.color);
    });

    // ICS-specific fields
    if (cal.type === 'ics' && cal.config) {
      document.getElementById('ics-url').value = cal.config.url || '';
      document.getElementById('ics-refresh').value = String(cal.config.refresh_minutes || 30);
    }

    openModal(calModal);
  }

  // ── Close modal ──
  document.getElementById('modal-calendar-close').addEventListener('click', () => closeModal(calModal));
  document.getElementById('btn-calendar-cancel').addEventListener('click', () => closeModal(calModal));

  // ── Save (create or update) ──
  document.getElementById('btn-calendar-save').addEventListener('click', async () => {
    const btn = document.getElementById('btn-calendar-save');
    const name  = document.getElementById('cal-name').value.trim();
    const type  = typePicker.querySelector('.type-option.selected')?.dataset.type || 'ics';
    const color = colorPicker.querySelector('.color-swatch.selected')?.dataset.color || '#8be9fd';

    if (!name) {
      document.getElementById('cal-name').focus();
      document.getElementById('cal-name').style.borderColor = '#ff5555';
      setTimeout(() => { document.getElementById('cal-name').style.borderColor = ''; }, 2000);
      return;
    }

    // Build config based on type
    const config = {};
    if (type === 'ics') {
      const icsUrl = document.getElementById('ics-url').value.trim();
      if (!icsUrl) {
        document.getElementById('ics-url').focus();
        document.getElementById('ics-url').style.borderColor = '#ff5555';
        setTimeout(() => { document.getElementById('ics-url').style.borderColor = ''; }, 2000);
        return;
      }
      config.url = icsUrl;
      config.refresh_minutes = parseInt(document.getElementById('ics-refresh').value, 10) || 30;
    }
    // Google/Microsoft config would go here when OAuth is implemented

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      let res;
      if (editingCalId) {
        res = await fetch(`/api/calendars/${editingCalId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type, color, config }),
        });
      } else {
        res = await fetch('/api/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type, color, enabled: true, config }),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server returned ${res.status}`);
      }

      closeModal(calModal);
      await loadCalendars(); // refresh the list
    } catch (e) {
      alert('Error saving calendar: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = editingCalId ? 'Save Changes' : 'Add Calendar';
  });

  // ── Delete modal ──
  let deletingCalId = null;

  function openDeleteModal(cal) {
    deletingCalId = cal.id;
    document.getElementById('delete-cal-name').textContent = cal.name;
    openModal(deleteModal);
  }

  document.getElementById('modal-delete-close').addEventListener('click', () => closeModal(deleteModal));
  document.getElementById('btn-delete-cancel').addEventListener('click', () => closeModal(deleteModal));
  document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
    if (!deletingCalId) return;

    const btn = document.getElementById('btn-delete-confirm');
    btn.disabled = true;
    btn.textContent = 'Removing…';

    try {
      const res = await fetch(`/api/calendars/${deletingCalId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      closeModal(deleteModal);
      await loadCalendars();
    } catch (e) {
      alert('Error removing calendar: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = 'Remove';
    deletingCalId = null;
  });

  // ── Form reset ──
  function resetCalendarForm() {
    document.getElementById('cal-name').value = '';
    document.getElementById('cal-name').style.borderColor = '';

    // Reset type to ICS (most useful default since Google/Microsoft OAuth not yet wired)
    typeButtons.forEach(b => b.classList.remove('selected'));
    typePicker.querySelector('[data-type="ics"]').classList.add('selected');
    Object.values(typeFieldSets).forEach(el => el.classList.add('hidden'));
    typeFieldSets.ics.classList.remove('hidden');

    // Reset colour to first
    colorSwatches.forEach(s => s.classList.remove('selected'));
    colorSwatches[0].classList.add('selected');

    // Reset auth statuses
    document.getElementById('google-auth-status').innerHTML = '';
    document.getElementById('ms-auth-status').innerHTML = '';

    // Reset ICS fields
    document.getElementById('ics-url').value = '';
    document.getElementById('ics-url').style.borderColor = '';
    document.getElementById('ics-refresh').value = '30';
  }

  // ═══════════════════════════════════════
  //  BIRTHDAYS — fully wired to backend
  // ═══════════════════════════════════════

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const bdayList   = document.getElementById('birthday-list');
  const bdayEmpty  = document.getElementById('birthday-empty');
  let birthdays    = [];
  let editingBdayId = null;
  let deletingBdayId = null;

  // ── Load birthdays ──
  async function loadBirthdays() {
    try {
      const res = await fetch('/api/birthdays');
      birthdays = await res.json();
      renderBirthdayList();
    } catch (e) {
      console.warn('Failed to load birthdays:', e);
    }
  }

  loadBirthdays();

  // ── Render the list ──
  function renderBirthdayList() {
    bdayList.innerHTML = '';

    if (!birthdays.length) {
      bdayEmpty.style.display = '';
      return;
    }
    bdayEmpty.style.display = 'none';

    for (const b of birthdays) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = b.id;

      const dateStr = `${b.day} ${MONTH_NAMES[b.month]}`;
      const ageStr  = b.year ? calcAge(b) : '';

      card.innerHTML = `
        <div class="card-left">
          <span class="bday-icon">🎂</span>
          <div class="card-info">
            <span class="card-title">${esc(b.name)}</span>
            <span class="card-subtitle">${dateStr}${ageStr ? ' · ' + ageStr : ''}</span>
          </div>
        </div>
        <div class="card-right">
          <button class="btn-icon-only btn-edit" title="Edit"><span>✏️</span></button>
          <button class="btn-icon-only btn-delete" title="Remove"><span>🗑️</span></button>
        </div>
      `;

      card.querySelector('.btn-edit').addEventListener('click', () => openBdayEditModal(b));
      card.querySelector('.btn-delete').addEventListener('click', () => openBdayDeleteModal(b));

      bdayList.appendChild(card);
    }
  }

  function calcAge(b) {
    if (!b.year) return '';
    const now = new Date();
    let age = now.getFullYear() - b.year;
    // Check if birthday hasn't happened yet this year
    if (now.getMonth() + 1 < b.month || (now.getMonth() + 1 === b.month && now.getDate() < b.day)) {
      age--;
    }
    const nextAge = age + 1;
    return `Turning ${nextAge}`;
  }

  // ── Add button ──
  document.getElementById('btn-add-birthday').addEventListener('click', () => {
    editingBdayId = null;
    document.getElementById('modal-birthday-title').textContent = 'Add Birthday';
    document.getElementById('btn-birthday-save').textContent = 'Add Birthday';
    document.getElementById('bday-name').value = '';
    document.getElementById('bday-day').value = '';
    document.getElementById('bday-month').value = '1';
    document.getElementById('bday-year').value = '';
    openModal('modal-birthday');
  });

  // ── Edit ──
  function openBdayEditModal(b) {
    editingBdayId = b.id;
    document.getElementById('modal-birthday-title').textContent = 'Edit Birthday';
    document.getElementById('btn-birthday-save').textContent = 'Save Changes';
    document.getElementById('bday-name').value = b.name;
    document.getElementById('bday-day').value = b.day;
    document.getElementById('bday-month').value = b.month;
    document.getElementById('bday-year').value = b.year || '';
    openModal('modal-birthday');
  }

  // ── Close ──
  document.getElementById('modal-birthday-close').addEventListener('click', () => closeModal('modal-birthday'));
  document.getElementById('btn-birthday-cancel').addEventListener('click', () => closeModal('modal-birthday'));

  // ── Save ──
  document.getElementById('btn-birthday-save').addEventListener('click', async () => {
    const btn   = document.getElementById('btn-birthday-save');
    const name  = document.getElementById('bday-name').value.trim();
    const day   = parseInt(document.getElementById('bday-day').value, 10);
    const month = parseInt(document.getElementById('bday-month').value, 10);
    const yearVal = document.getElementById('bday-year').value.trim();
    const year  = yearVal ? parseInt(yearVal, 10) : null;

    if (!name) {
      document.getElementById('bday-name').focus();
      document.getElementById('bday-name').style.borderColor = '#ff5555';
      setTimeout(() => { document.getElementById('bday-name').style.borderColor = ''; }, 2000);
      return;
    }
    if (!day || day < 1 || day > 31) {
      document.getElementById('bday-day').focus();
      document.getElementById('bday-day').style.borderColor = '#ff5555';
      setTimeout(() => { document.getElementById('bday-day').style.borderColor = ''; }, 2000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      let res;
      if (editingBdayId) {
        res = await fetch(`/api/birthdays/${editingBdayId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, month, day, year }),
        });
      } else {
        res = await fetch('/api/birthdays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, month, day, year }),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server returned ${res.status}`);
      }

      closeModal('modal-birthday');
      await loadBirthdays();
    } catch (e) {
      alert('Error saving birthday: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = editingBdayId ? 'Save Changes' : 'Add Birthday';
  });

  // ── Delete ──
  function openBdayDeleteModal(b) {
    deletingBdayId = b.id;
    document.getElementById('delete-bday-name').textContent = b.name;
    openModal('modal-birthday-delete');
  }

  document.getElementById('modal-bday-delete-close').addEventListener('click', () => closeModal('modal-birthday-delete'));
  document.getElementById('btn-bday-delete-cancel').addEventListener('click', () => closeModal('modal-birthday-delete'));
  document.getElementById('btn-bday-delete-confirm').addEventListener('click', async () => {
    if (!deletingBdayId) return;
    const btn = document.getElementById('btn-bday-delete-confirm');
    btn.disabled = true;
    btn.textContent = 'Removing…';

    try {
      const res = await fetch(`/api/birthdays/${deletingBdayId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      closeModal('modal-birthday-delete');
      await loadBirthdays();
    } catch (e) {
      alert('Error removing birthday: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = 'Remove';
    deletingBdayId = null;
  });

  // ═══════════════════════════════════════
  //  WEATHER — fully wired to backend
  // ═══════════════════════════════════════

  const weatherSearch  = document.getElementById('weather-search');
  const searchResults  = document.getElementById('weather-search-results');
  const weatherLat     = document.getElementById('weather-lat');
  const weatherLon     = document.getElementById('weather-lon');
  const weatherTz      = document.getElementById('weather-tz');
  const displayName    = document.getElementById('weather-display-name');
  const displayCoords  = document.getElementById('weather-display-coords');

  // ── Load saved settings on page load ──
  async function loadWeatherSettings() {
    try {
      const res = await fetch('/api/settings/weather');
      const s   = await res.json();

      weatherLat.value = s.lat  || '';
      weatherLon.value = s.lon  || '';
      weatherTz.value  = s.tz   || '';

      displayName.textContent   = s.location_name || '—';
      displayCoords.textContent = (s.lat && s.lon) ? `${s.lat}, ${s.lon}` : '—';

      // Set radio buttons
      const tempInput = document.querySelector(`input[name="temp-unit"][value="${s.temp_unit || 'celsius'}"]`);
      if (tempInput) tempInput.checked = true;

      const windInput = document.querySelector(`input[name="wind-unit"][value="${s.wind_unit || 'kmh'}"]`);
      if (windInput) windInput.checked = true;
    } catch (e) {
      console.warn('Failed to load weather settings:', e);
    }
  }

  loadWeatherSettings();

  // ── City search — debounced geocoding via server proxy ──
  let searchTimer = null;

  weatherSearch.addEventListener('input', () => {
    const q = weatherSearch.value.trim();
    clearTimeout(searchTimer);

    if (q.length < 2) {
      searchResults.classList.remove('open');
      searchResults.innerHTML = '';
      return;
    }

    searchTimer = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderSearchResults(data.results || []);
      } catch (e) {
        console.warn('Geocode search failed:', e);
      }
    }, 300);
  });

  weatherSearch.addEventListener('focus', () => {
    if (searchResults.children.length > 0) searchResults.classList.add('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-input-wrap')) {
      searchResults.classList.remove('open');
    }
  });

  function renderSearchResults(results) {
    searchResults.innerHTML = '';
    if (!results.length) {
      const none = document.createElement('div');
      none.className = 'search-result-item search-no-results';
      none.innerHTML = '<span class="search-result-name">No cities found</span>';
      searchResults.appendChild(none);
      searchResults.classList.add('open');
      return;
    }

    for (const r of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';

      const parts = [r.admin1, r.country].filter(Boolean);
      item.innerHTML = `
        <span class="search-result-name">${r.name}</span>
        <span class="search-result-region">${parts.join(', ')}</span>
      `;

      item.addEventListener('click', () => {
        const locName = `${r.name}, ${parts.join(', ')}`;
        weatherSearch.value = locName;
        weatherLat.value = r.latitude;
        weatherLon.value = r.longitude;
        weatherTz.value  = r.timezone || '';

        displayName.textContent   = locName;
        displayCoords.textContent = `${r.latitude}, ${r.longitude}`;

        searchResults.classList.remove('open');
      });

      searchResults.appendChild(item);
    }

    searchResults.classList.add('open');
  }

  // ── Save weather settings ──
  document.getElementById('btn-weather-save').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-weather-save');
    const status = document.getElementById('weather-save-status');

    const tempUnit = document.querySelector('input[name="temp-unit"]:checked')?.value || 'celsius';
    const windUnit = document.querySelector('input[name="wind-unit"]:checked')?.value || 'kmh';

    const lat = weatherLat.value.trim();
    const lon = weatherLon.value.trim();
    const tz  = weatherTz.value.trim();

    // Basic validation
    if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
      status.textContent = '⚠ Enter valid coordinates';
      status.style.color = '#ff5555';
      setTimeout(() => { status.textContent = ''; }, 3000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const locName = displayName.textContent !== '—'
        ? displayName.textContent
        : `${lat}, ${lon}`;

      const res = await fetch('/api/settings/weather', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat, lon, tz,
          location_name: locName,
          temp_unit: tempUnit,
          wind_unit: windUnit,
        }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      displayCoords.textContent = `${lat}, ${lon}`;
      if (displayName.textContent === '—') displayName.textContent = locName;

      btn.textContent = '✓ Saved';
      btn.style.background = '#50fa7b';
      btn.style.color = '#000';
      status.textContent = 'Weather will update on the next worker cycle (~5 min).';
      status.style.color = '#8b8b8b';
    } catch (e) {
      btn.textContent = '✕ Error';
      btn.style.background = '#ff5555';
      btn.style.color = '#fff';
      status.textContent = e.message;
      status.style.color = '#ff5555';
    }

    setTimeout(() => {
      btn.textContent = 'Save Weather Settings';
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2000);
  });

})();
