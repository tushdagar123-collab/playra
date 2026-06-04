/* ══════════════════════════════════════════
   PLAYRA — PREMIUM SERVICE
   Plan management, feature gating, upgrade modal
   ══════════════════════════════════════════ */

import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from './utils.js';

// ══════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════

const PLANS = {
  free: 'free',
  monthly: 'monthly',
  sixMonth: 'sixMonth',
};

const FREE_LIMITS = {
  maxParticipants: 30,
  maxTeamBattles: 2,
};

/**
 * Feature gating map — which features require premium.
 */
export const PREMIUM_FEATURES = {
  exportResults:  { label: 'Export PDF / Results',     icon: '📄' },
  aiGeneration:   { label: 'AI Question Generation',   icon: '✨' },
  unlimitedPlayers: { label: 'Unlimited Participants', icon: '👥' },
  unlimitedTeamBattles: { label: 'Unlimited Team Battles', icon: '⚔️' },
  premiumBadge:   { label: 'Premium ⭐ Badge',         icon: '⭐' },
  prioritySupport: { label: 'Priority Support',        icon: '🛡️' },
};

// ══════════════════════════════════════════
//  INTERNAL STATE
// ══════════════════════════════════════════

let _userPlan = null;   // { plan, expiresAt, teamBattleCount, userId }
let _listeners = [];    // callbacks notified on plan change

// ══════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════

/**
 * Load or initialize the user's plan from Firestore.
 * Call this after login/signup.
 * @param {string} userId - Firebase Auth UID
 */
export async function initPremium(userId) {
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();

      // If userPlan doesn't exist yet, initialize it
      if (!data.userPlan) {
        await updateDoc(userRef, {
          userPlan: PLANS.free,
          planExpiresAt: null,
          teamBattleCount: 0,
        });
        _userPlan = {
          plan: PLANS.free,
          expiresAt: null,
          teamBattleCount: 0,
          userId,
        };
      } else {
        // Check if premium has expired
        let plan = data.userPlan;
        const expiresAt = data.planExpiresAt;

        if (plan !== PLANS.free && expiresAt) {
          const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
          if (expiryDate < new Date()) {
            // Premium expired — revert to free
            plan = PLANS.free;
            await updateDoc(userRef, { userPlan: PLANS.free });
            showToast('Your premium plan has expired. Upgrade to continue enjoying premium features.', 'error');
          }
        }

        _userPlan = {
          plan,
          expiresAt: expiresAt,
          teamBattleCount: data.teamBattleCount || 0,
          userId,
        };
      }
    }
  } catch (err) {
    console.error('[Premium] Failed to initialize premium:', err);
    // Default to free on error
    _userPlan = {
      plan: PLANS.free,
      expiresAt: null,
      teamBattleCount: 0,
      userId,
    };
  }

  _notifyListeners();
  _applyPremiumUI();
}

// ══════════════════════════════════════════
//  GETTERS
// ══════════════════════════════════════════

/**
 * Returns the current user plan object.
 */
export function getUserPlan() {
  return _userPlan;
}

/**
 * Returns true if the user has an active premium plan.
 */
export function isPremium() {
  if (!_userPlan) return false;
  if (_userPlan.plan === PLANS.free) return false;

  // Check expiry
  if (_userPlan.expiresAt) {
    const expiryDate = _userPlan.expiresAt.toDate
      ? _userPlan.expiresAt.toDate()
      : new Date(_userPlan.expiresAt);
    if (expiryDate < new Date()) return false;
  }

  return true;
}

/**
 * Check if a specific premium feature is available.
 * @param {string} featureName - Key from PREMIUM_FEATURES
 */
export function canUseFeature(featureName) {
  if (isPremium()) return true;

  // Free users can't use any premium feature
  if (PREMIUM_FEATURES[featureName]) return false;

  // Unknown feature — allow by default
  return true;
}

// ══════════════════════════════════════════
//  LIMIT CHECKS
// ══════════════════════════════════════════

/**
 * Check if the current participant count is within free limits.
 * @param {number} currentCount
 * @returns {boolean} true if allowed
 */
export function checkParticipantLimit(currentCount) {
  if (isPremium()) return true;
  return currentCount < FREE_LIMITS.maxParticipants;
}

/**
 * Check if the user can start another Team Battle.
 * Free limit is 2 — the 3rd attempt triggers the modal.
 * @returns {boolean} true if allowed
 */
export function checkTeamBattleLimit() {
  if (isPremium()) return true;
  if (!_userPlan) return true; // no plan loaded yet, allow
  return _userPlan.teamBattleCount < FREE_LIMITS.maxTeamBattles;
}

/**
 * Increment the team battle count in Firestore.
 * Call this after a team battle is successfully started.
 */
export async function incrementTeamBattleCount() {
  if (!_userPlan?.userId) return;
  if (isPremium()) return; // no counting for premium users

  try {
    const newCount = (_userPlan.teamBattleCount || 0) + 1;
    const userRef = doc(db, 'users', _userPlan.userId);
    await updateDoc(userRef, { teamBattleCount: newCount });
    _userPlan.teamBattleCount = newCount;
  } catch (err) {
    console.error('[Premium] Failed to increment team battle count:', err);
  }
}

// ══════════════════════════════════════════
//  ACTIVATE PREMIUM (Post-payment)
// ══════════════════════════════════════════

/**
 * Activate premium for the current user.
 * @param {'monthly'|'sixMonth'} plan
 */
export async function activatePremium(plan) {
  if (!_userPlan?.userId) return;

  const durationMonths = plan === 'sixMonth' ? 6 : 1;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

  try {
    const userRef = doc(db, 'users', _userPlan.userId);
    await updateDoc(userRef, {
      userPlan: plan,
      planExpiresAt: expiresAt,
      premiumActivatedAt: serverTimestamp(),
    });

    _userPlan.plan = plan;
    _userPlan.expiresAt = expiresAt;

    _notifyListeners();
    _applyPremiumUI();
    _unlockAllFeatures();

    showToast('🎉 Premium activated! All features are now unlocked.');
  } catch (err) {
    console.error('[Premium] Failed to activate premium:', err);
    showToast('Failed to activate premium. Please contact support.', 'error');
  }
}

// ══════════════════════════════════════════
//  UPGRADE MODAL
// ══════════════════════════════════════════

/**
 * Open the upgrade modal with optional trigger context.
 * @param {string} [trigger] - What triggered the modal (e.g., 'ai', 'export')
 */
export function openUpgradeModal(trigger) {
  const modal = document.getElementById('premium-upgrade-modal');
  if (!modal) return;

  // Set context message if provided
  const contextEl = modal.querySelector('.premium-modal-context');
  if (contextEl) {
    const messages = {
      ai: '✨ AI Question Generation is a Premium feature.',
      export: '📄 Exporting Results & PDF is a Premium feature.',
      teamBattle: '⚔️ You\'ve reached the free Team Battle limit (2). Upgrade for unlimited!',
      participants: '👥 Free plan supports up to 30 participants. Upgrade for unlimited!',
    };
    contextEl.textContent = messages[trigger] || 'Unlock all premium features!';
    contextEl.style.display = '';
  }

  modal.classList.add('premium-modal--visible');
  document.body.style.overflow = 'hidden';
}

/**
 * Close the upgrade modal.
 */
export function closeUpgradeModal() {
  const modal = document.getElementById('premium-upgrade-modal');
  if (!modal) return;
  modal.classList.remove('premium-modal--visible');
  document.body.style.overflow = '';
}

/**
 * Initialize the upgrade modal event listeners.
 * Call once from main.js.
 */
export function initUpgradeModalBindings() {
  const modal = document.getElementById('premium-upgrade-modal');
  if (!modal) return;

  // Close button
  const closeBtn = modal.querySelector('.premium-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeUpgradeModal);

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeUpgradeModal();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('premium-modal--visible')) {
      closeUpgradeModal();
    }
  });
}

// ══════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════

/**
 * Inject or remove the ⭐ Premium badge inside a single container element.
 * Idempotent — safe to call multiple times.
 * @param {Element} container - The element to append the badge into.
 * @param {boolean} premium   - Whether the user is premium.
 */
function _injectBadgeInto(container, premium) {
  if (!container) return;
  const existing = container.querySelector('.premium-user-badge');
  if (existing) existing.remove();
  if (premium) {
    const badge = document.createElement('span');
    badge.className = 'premium-user-badge';
    badge.textContent = '⭐ Premium';
    container.appendChild(badge);
  }
}

/**
 * Apply premium visual indicators across the app.
 * Called after plan is loaded or changed.
 *
 * Targets:
 *  - #dashboard-user  (Dashboard / Create Quiz overlay)
 *  - [data-premium-badge-slot]  (any page can opt-in by adding this attribute)
 */
function _applyPremiumUI() {
  const premium = isPremium();

  // ── Premium badge in dashboard topbar (#dashboard-user) ──
  _injectBadgeInto(document.getElementById('dashboard-user'), premium);

  // ── Premium badge in any slot on any page ──
  document.querySelectorAll('[data-premium-badge-slot]').forEach(slot => {
    _injectBadgeInto(slot, premium);
  });

  // ── Lock indicators on premium buttons ──
  document.querySelectorAll('[data-premium]').forEach(el => {
    const feature = el.dataset.premium;
    // Clean up old lock state
    el.classList.remove('premium-locked', 'premium-locked-btn');
    const oldBadge = el.querySelector('.premium-lock-badge');
    if (oldBadge) oldBadge.remove();
    const oldTag = el.querySelector('.premium-lock-tag');
    if (oldTag) oldTag.remove();

    if (!premium && !canUseFeature(feature)) {
      el.classList.add('premium-locked-btn');
      // Add floating lock tag if not already present
      const tag = document.createElement('span');
      tag.className = 'premium-lock-tag';
      tag.textContent = '🔒 Premium';
      el.appendChild(tag);
    }
  });
}

/**
 * Public helper — re-apply premium badge to all slots.
 * Call this from any page after premium state is available.
 * Useful for pages (e.g. lobby) that load premium state on-demand.
 */
export function applyPremiumBadge() {
  _applyPremiumUI();
}

/**
 * Unlock all premium features visually (after payment).
 */
function _unlockAllFeatures() {
  document.querySelectorAll('.premium-locked, .premium-locked-btn').forEach(el => {
    el.classList.remove('premium-locked', 'premium-locked-btn');
    const lockBadge = el.querySelector('.premium-lock-badge');
    if (lockBadge) lockBadge.remove();
    const lockTag = el.querySelector('.premium-lock-tag');
    if (lockTag) lockTag.remove();
  });
}

// ══════════════════════════════════════════
//  LISTENERS
// ══════════════════════════════════════════

/**
 * Subscribe to plan changes.
 * @param {function} callback
 * @returns {function} unsubscribe
 */
export function onPlanChange(callback) {
  _listeners.push(callback);
  return () => {
    _listeners = _listeners.filter(l => l !== callback);
  };
}

function _notifyListeners() {
  _listeners.forEach(cb => {
    try { cb(_userPlan); } catch (e) { console.error('[Premium] Listener error:', e); }
  });
}

// ══════════════════════════════════════════
//  RESET (for logout)
// ══════════════════════════════════════════

/**
 * Clear premium state. Call on logout.
 */
export function resetPremium() {
  _userPlan = null;
  _listeners = [];
}
