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
  //  WEATHER — city search (UI only)
  // ═══════════════════════════════════════

  const weatherSearch  = document.getElementById('weather-search');
  const searchResults  = document.getElementById('weather-search-results');

  weatherSearch.addEventListener('focus', () => {
    if (weatherSearch.value.length > 0) searchResults.classList.add('open');
  });

  weatherSearch.addEventListener('input', () => {
    // TODO: call Open-Meteo geocoding API
    // For now, show the static results if there's input
    if (weatherSearch.value.length > 0) {
      searchResults.classList.add('open');
    } else {
      searchResults.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-input-wrap')) {
      searchResults.classList.remove('open');
    }
  });

  // Clicking a search result
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const name   = item.querySelector('.search-result-name').textContent;
      const region = item.querySelector('.search-result-region').textContent;
      const lat    = item.dataset.lat;
      const lon    = item.dataset.lon;
      const tz     = item.dataset.tz;

      weatherSearch.value = `${name}, ${region}`;
      document.getElementById('weather-lat').value = lat;
      document.getElementById('weather-lon').value = lon;
      document.getElementById('weather-tz').value  = tz;

      // Update display
      const display = document.getElementById('weather-current-location');
      display.querySelector('span:nth-child(2)').textContent = `${name}, ${region}`;
      display.querySelector('.current-coords').textContent = `${lat}, ${lon}`;

      searchResults.classList.remove('open');
    });
  });

  // Save button (UI only)
  document.getElementById('btn-weather-save').addEventListener('click', () => {
    // TODO: wire to backend
    const btn = document.getElementById('btn-weather-save');
    const orig = btn.textContent;
    btn.textContent = '✓ Saved';
    btn.style.background = '#50fa7b';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  });

})();
