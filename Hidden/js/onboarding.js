/* ══════════════════════════════════════════
   PLAYRA — FIRST-TIME SETUP WIZARD
   3-step onboarding for new users
   ══════════════════════════════════════════ */

import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { showToast } from './utils.js';

// ── Wizard State ──
let _currentStep = 1;
const TOTAL_STEPS = 3;
let _selections = {
  userType: null,
  organizationName: '',
  purpose: null,
};
let _overlayEl = null;

// ══════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════

/**
 * Check if the user needs onboarding. If yes, show the wizard.
 * @param {import('firebase/auth').User} user
 */
export async function checkOnboarding(user) {
  if (!user) return;

  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userDocRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.onboardingCompleted === true) return; // Already done
    }

    // Show the wizard
    _currentStep = 1;
    _selections = { userType: null, organizationName: '', purpose: null };
    _buildAndShowWizard(user);
  } catch (err) {
    console.error('[Onboarding] Failed to check onboarding status:', err);
    // Don't block the user — silently skip
  }
}

/**
 * Remove the wizard overlay from the DOM.
 */
export function destroyOnboarding() {
  if (_overlayEl) {
    _overlayEl.classList.remove('active');
    setTimeout(() => {
      _overlayEl.remove();
      _overlayEl = null;
      document.body.style.overflow = '';
    }, 400);
  }
}

// ══════════════════════════════════════════
//  BUILD WIZARD DOM
// ══════════════════════════════════════════

function _buildAndShowWizard(user) {
  // Remove any existing wizard
  const existing = document.getElementById('onboarding-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-container">
      <!-- Progress Bar -->
      <div class="onboarding-progress">
        <div class="onboarding-progress-fill" id="onb-progress-fill" style="width: 33.33%"></div>
      </div>

      <!-- Body -->
      <div class="onboarding-body">
        <!-- Step Indicator -->
        <div class="onboarding-step-indicator" id="onb-step-indicator">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Step 1 of 3
        </div>

        <!-- Steps -->
        <div class="onboarding-steps">

          <!-- Step 1: User Type -->
          <div class="onboarding-step active" id="onb-step-1">
            <h2 class="onboarding-title">Tell us about yourself</h2>
            <p class="onboarding-subtitle">Select the role that best describes you. This helps us personalize your experience.</p>
            <div class="onboarding-cards" id="onb-cards-usertype">
              <div class="onboarding-card" data-value="Student">
                <div class="onboarding-card-icon">🎓</div>
                <span class="onboarding-card-label">Student</span>
              </div>
              <div class="onboarding-card" data-value="Teacher">
                <div class="onboarding-card-icon">👨‍🏫</div>
                <span class="onboarding-card-label">Teacher</span>
              </div>
              <div class="onboarding-card" data-value="Entrepreneur">
                <div class="onboarding-card-icon">🚀</div>
                <span class="onboarding-card-label">Entrepreneur</span>
              </div>
              <div class="onboarding-card" data-value="Event Organizer">
                <div class="onboarding-card-icon">🎪</div>
                <span class="onboarding-card-label">Event Organizer</span>
              </div>
            </div>
          </div>

          <!-- Step 2: Organization -->
          <div class="onboarding-step" id="onb-step-2">
            <h2 class="onboarding-title">Your organization</h2>
            <p class="onboarding-subtitle">Tell us where you're from. This is optional — you can always update it later.</p>
            <div class="onboarding-input-group">
              <div class="onboarding-input-wrap">
                <svg class="onboarding-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                  <line x1="9" y1="9" x2="9" y2="9.01"/><line x1="9" y1="13" x2="9" y2="13.01"/>
                  <line x1="9" y1="17" x2="9" y2="17.01"/>
                </svg>
                <input type="text" id="onb-org-input" placeholder="e.g., MIT, Google, Stanford University" autocomplete="organization" />
              </div>
              <p class="onboarding-input-hint">College, school, company, or organization name</p>
            </div>
          </div>

          <!-- Step 3: Purpose -->
          <div class="onboarding-step" id="onb-step-3">
            <h2 class="onboarding-title">What's your purpose?</h2>
            <p class="onboarding-subtitle">How do you plan to use Playra? This helps us tailor your dashboard.</p>
            <div class="onboarding-cards onboarding-cards--purpose" id="onb-cards-purpose">
              <div class="onboarding-card" data-value="Education">
                <div class="onboarding-card-icon">📚</div>
                <span class="onboarding-card-label">Education</span>
              </div>
              <div class="onboarding-card" data-value="Competitions">
                <div class="onboarding-card-icon">🏆</div>
                <span class="onboarding-card-label">Competitions</span>
              </div>
              <div class="onboarding-card" data-value="Events">
                <div class="onboarding-card-icon">🎉</div>
                <span class="onboarding-card-label">Events</span>
              </div>
              <div class="onboarding-card" data-value="Team Building">
                <div class="onboarding-card-icon">🤝</div>
                <span class="onboarding-card-label">Team Building</span>
              </div>
              <div class="onboarding-card" data-value="Fun Quizzes">
                <div class="onboarding-card-icon">🎮</div>
                <span class="onboarding-card-label">Fun Quizzes</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Footer -->
      <div class="onboarding-footer">
        <div class="onboarding-footer-left">
          <button class="onboarding-btn-back" id="onb-btn-back" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
        </div>
        <div class="onboarding-footer-right">
          <button class="onboarding-btn-skip" id="onb-btn-skip">Skip for now</button>
          <button class="onboarding-btn-next" id="onb-btn-next">
            Next
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _overlayEl = overlay;

  // Show with animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  // Wire up event listeners
  _setupListeners(user);
}

// ══════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════

function _setupListeners(user) {
  // Card selection — Step 1 (userType)
  const cardsUserType = document.getElementById('onb-cards-usertype');
  if (cardsUserType) {
    cardsUserType.addEventListener('click', (e) => {
      const card = e.target.closest('.onboarding-card');
      if (!card) return;
      // Deselect siblings
      cardsUserType.querySelectorAll('.onboarding-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selections.userType = card.dataset.value;
    });
  }

  // Card selection — Step 3 (purpose)
  const cardsPurpose = document.getElementById('onb-cards-purpose');
  if (cardsPurpose) {
    cardsPurpose.addEventListener('click', (e) => {
      const card = e.target.closest('.onboarding-card');
      if (!card) return;
      cardsPurpose.querySelectorAll('.onboarding-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selections.purpose = card.dataset.value;
    });
  }

  // Next button
  const btnNext = document.getElementById('onb-btn-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => _handleNext(user));
  }

  // Back button
  const btnBack = document.getElementById('onb-btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => _handleBack());
  }

  // Skip button
  const btnSkip = document.getElementById('onb-btn-skip');
  if (btnSkip) {
    btnSkip.addEventListener('click', () => _handleSkip(user));
  }
}

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════

function _handleNext(user) {
  // Validate current step
  if (_currentStep === 1 && !_selections.userType) {
    _shakeCards('onb-cards-usertype');
    showToast('Please select a role to continue.', 'error');
    return;
  }

  if (_currentStep === 2) {
    // Capture org input (optional)
    const input = document.getElementById('onb-org-input');
    _selections.organizationName = (input?.value || '').trim();
  }

  if (_currentStep === 3 && !_selections.purpose) {
    _shakeCards('onb-cards-purpose');
    showToast('Please select your purpose to continue.', 'error');
    return;
  }

  // If on last step, finish
  if (_currentStep === TOTAL_STEPS) {
    _handleFinish(user);
    return;
  }

  // Animate current step out, next step in
  _goToStep(_currentStep + 1, 'forward');
}

function _handleBack() {
  if (_currentStep <= 1) return;

  // Save org input if going back from step 2
  if (_currentStep === 2) {
    const input = document.getElementById('onb-org-input');
    _selections.organizationName = (input?.value || '').trim();
  }

  _goToStep(_currentStep - 1, 'backward');
}

function _goToStep(targetStep, direction) {
  const currentEl = document.getElementById(`onb-step-${_currentStep}`);
  const targetEl = document.getElementById(`onb-step-${targetStep}`);
  if (!currentEl || !targetEl) return;

  // Animate out
  currentEl.classList.add(direction === 'forward' ? 'slide-out-left' : 'slide-out-right');

  setTimeout(() => {
    currentEl.classList.remove('active', 'slide-out-left', 'slide-out-right');
    currentEl.style.display = 'none';

    // Animate in
    targetEl.style.display = '';
    targetEl.classList.add('active');

    _currentStep = targetStep;
    _updateUI();
  }, 280);
}

function _updateUI() {
  // Progress bar
  const fill = document.getElementById('onb-progress-fill');
  if (fill) {
    fill.style.width = `${(_currentStep / TOTAL_STEPS) * 100}%`;
  }

  // Step indicator
  const indicator = document.getElementById('onb-step-indicator');
  if (indicator) {
    indicator.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      Step ${_currentStep} of ${TOTAL_STEPS}
    `;
  }

  // Back button visibility
  const btnBack = document.getElementById('onb-btn-back');
  if (btnBack) {
    btnBack.style.display = _currentStep > 1 ? '' : 'none';
  }

  // Next button text
  const btnNext = document.getElementById('onb-btn-next');
  if (btnNext) {
    if (_currentStep === TOTAL_STEPS) {
      btnNext.innerHTML = `
        Finish
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      `;
    } else {
      btnNext.innerHTML = `
        Next
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      `;
    }
  }

  // Restore org input value if going back to step 2
  if (_currentStep === 2) {
    const input = document.getElementById('onb-org-input');
    if (input && _selections.organizationName) {
      input.value = _selections.organizationName;
    }
  }
}

// ══════════════════════════════════════════
//  FINISH & SKIP
// ══════════════════════════════════════════

async function _handleFinish(user) {
  const btnNext = document.getElementById('onb-btn-next');
  if (btnNext) {
    btnNext.disabled = true;
    btnNext.innerHTML = `
      <span style="display:inline-block;width:18px;height:18px;border:2.5px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:authSpin 0.6s linear infinite;"></span>
      Saving…
    `;
  }

  try {
    const userDocRef = doc(db, 'users', user.uid);
    const updateData = {
      userType: _selections.userType,
      purpose: _selections.purpose,
      onboardingCompleted: true,
    };

    if (_selections.organizationName) {
      updateData.organizationName = _selections.organizationName;
    }

    // Use setDoc with merge to handle both existing and missing docs
    await setDoc(userDocRef, updateData, { merge: true });

    // Finish animation
    const container = _overlayEl?.querySelector('.onboarding-container');
    if (container) container.classList.add('finishing');

    showToast('Setup complete! Welcome to Playra 🎉', 'success');

    setTimeout(() => {
      destroyOnboarding();
    }, 600);
  } catch (err) {
    console.error('[Onboarding] Failed to save onboarding data:', err);
    showToast('Something went wrong. Please try again.', 'error');
    if (btnNext) {
      btnNext.disabled = false;
      btnNext.innerHTML = `
        Finish
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      `;
    }
  }
}

async function _handleSkip(user) {
  const btnSkip = document.getElementById('onb-btn-skip');
  if (btnSkip) {
    btnSkip.disabled = true;
    btnSkip.textContent = 'Skipping…';
  }

  try {
    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, { onboardingCompleted: true }, { merge: true });

    showToast('Setup skipped. You can update your profile anytime.', 'success');
    destroyOnboarding();
  } catch (err) {
    console.error('[Onboarding] Failed to skip onboarding:', err);
    showToast('Something went wrong. Please try again.', 'error');
    if (btnSkip) {
      btnSkip.disabled = false;
      btnSkip.textContent = 'Skip for now';
    }
  }
}

// ── Helpers ──

function _shakeCards(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove('shake');
  // Force reflow to restart animation
  void container.offsetWidth;
  container.classList.add('shake');
  setTimeout(() => container.classList.remove('shake'), 500);
}
