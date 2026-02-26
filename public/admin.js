// ─── admin.js — Settings panel UI interactions ───
// Handles navigation, modals, type switching, colour picking.
// No backend integration yet — just UI behaviour.

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
    });
  });

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
  //  CALENDAR MODAL
  // ═══════════════════════════════════════

  const calModal = 'modal-calendar';

  // Open — Add
  document.getElementById('btn-add-calendar').addEventListener('click', () => {
    document.getElementById('modal-calendar-title').textContent = 'Add Calendar';
    resetCalendarForm();
    openModal(calModal);
  });

  // Close
  document.getElementById('modal-calendar-close').addEventListener('click', () => closeModal(calModal));
  document.getElementById('btn-calendar-cancel').addEventListener('click', () => closeModal(calModal));

  // Save (UI only — just close for now)
  document.getElementById('btn-calendar-save').addEventListener('click', () => {
    // TODO: wire to backend
    closeModal(calModal);
  });

  // Edit buttons on existing cards
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card  = btn.closest('.card');
      const title = card.querySelector('.card-title').textContent;
      document.getElementById('modal-calendar-title').textContent = 'Edit Calendar';
      document.getElementById('cal-name').value = title;
      openModal(calModal);
    });
  });

  // ── Type picker ──
  const typePicker = document.getElementById('cal-type-picker');
  const typeButtons = typePicker.querySelectorAll('.type-option');
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

  // ── Auth buttons (UI feedback only) ──
  document.getElementById('btn-google-auth').addEventListener('click', () => {
    // TODO: trigger real OAuth flow
    document.getElementById('google-auth-status').innerHTML = '✓ Would open Google sign-in…';
  });

  document.getElementById('btn-ms-auth').addEventListener('click', () => {
    // TODO: trigger real OAuth flow
    document.getElementById('ms-auth-status').innerHTML = '✓ Would open Microsoft sign-in…';
  });

  function resetCalendarForm() {
    document.getElementById('cal-name').value = '';

    // Reset type to Google
    typeButtons.forEach(b => b.classList.remove('selected'));
    typeButtons[0].classList.add('selected');
    Object.values(typeFieldSets).forEach(el => el.classList.add('hidden'));
    typeFieldSets.google.classList.remove('hidden');

    // Reset colour to first
    colorSwatches.forEach(s => s.classList.remove('selected'));
    colorSwatches[0].classList.add('selected');

    // Reset auth statuses
    document.getElementById('google-auth-status').innerHTML = '';
    document.getElementById('ms-auth-status').innerHTML = '';

    // Reset ICS fields
    document.getElementById('ics-url').value = '';
  }

  // ═══════════════════════════════════════
  //  DELETE MODAL
  // ═══════════════════════════════════════

  const deleteModal = 'modal-delete';

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const name = card.querySelector('.card-title').textContent;
      document.getElementById('delete-cal-name').textContent = name;
      openModal(deleteModal);
    });
  });

  document.getElementById('modal-delete-close').addEventListener('click', () => closeModal(deleteModal));
  document.getElementById('btn-delete-cancel').addEventListener('click', () => closeModal(deleteModal));
  document.getElementById('btn-delete-confirm').addEventListener('click', () => {
    // TODO: wire to backend
    closeModal(deleteModal);
  });

  // ═══════════════════════════════════════
  //  TOGGLE SWITCHES — card appearance
  // ═══════════════════════════════════════

  document.querySelectorAll('.card .toggle input').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const card  = toggle.closest('.card');
      const badge = card.querySelector('.badge');

      if (toggle.checked) {
        card.classList.remove('card-disabled');
        badge.className = 'badge badge-connected';
        badge.textContent = 'Connected';
      } else {
        card.classList.add('card-disabled');
        badge.className = 'badge badge-disabled';
        badge.textContent = 'Disabled';
      }
    });
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
