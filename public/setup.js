// Setup wizard form handler
const form = document.getElementById('setup-form');
const statusDiv = document.getElementById('setup-status');

// Step navigation
const nextButtons = document.querySelectorAll('.next-step');
const prevButtons = document.querySelectorAll('.prev-step');
const allSteps = document.querySelectorAll('.form-step');
const stepOne = document.getElementById('step-1');

// Form step navigation
function showStep(stepId) {
  allSteps.forEach(step => step.classList.remove('active'));
  document.getElementById(stepId).classList.add('active');
  window.scrollTo(0, 0);
}

function validateStep(stepEl) {
  const inputs = stepEl.querySelectorAll('input[required]');
  let isValid = true;

  inputs.forEach(input => {
    if (!input.value.trim()) {
      isValid = false;
      input.style.borderColor = '#ff5555';
    } else {
      input.style.borderColor = '';
    }
  });

  return isValid;
}

function goToNextStep(button) {
  const currentStep = button.closest('.form-step');
  if (!validateStep(currentStep)) return;
  showStep(button.dataset.next);
}

nextButtons.forEach(button => {
  button.addEventListener('click', (e) => {
    e.preventDefault();
    goToNextStep(button);
  });
});

if (stepOne) {
  stepOne.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const nextButton = stepOne.querySelector('.next-step');
    if (!nextButton) return;

    e.preventDefault();
    goToNextStep(nextButton);
  });
}

prevButtons.forEach(button => {
  button.addEventListener('click', (e) => {
    e.preventDefault();
    const prevStep = button.dataset.prev;
    showStep(prevStep);
  });
});

// Form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const location = document.getElementById('location').value.trim();
  const lat = document.getElementById('lat').value ? parseFloat(document.getElementById('lat').value) : null;
  const lon = document.getElementById('lon').value ? parseFloat(document.getElementById('lon').value) : null;
  const tz = document.getElementById('tz').value.trim();

  // Validate
  if (!username || !password) {
    showStatus('Username and password are required', 'error');
    return;
  }

  if (password.length < 8) {
    showStatus('Password must be at least 8 characters', 'error');
    return;
  }

  // Disable buttons during submission
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Setting up...';

  showStatus('Initializing setup...', 'loading');

  try {
    const response = await fetch('/api/setup/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
        location,
        lat,
        lon,
        tz,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      showStatus('Setup complete! Redirecting...', 'success');
      setTimeout(() => {
        window.location.href = '/admin';
      }, 1500);
    } else {
      showStatus(data.error || 'Setup failed', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  } catch (error) {
    showStatus('Setup failed: ' + error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

// Attempt to fetch geocoding data for location search (future enhancement)
// For now, users manually enter lat/lon or clear fields
document.getElementById('location').addEventListener('change', async () => {
  const location = document.getElementById('location').value.trim();
  if (location) {
    try {
      // Try to geocode using Open-Meteo (would need /api/geocode endpoint)
      // For now, just a placeholder for future enhancement
    } catch (e) {
      // Silently fail, user can manually enter coords
    }
  }
});
