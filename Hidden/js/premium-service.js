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
  free:        'free',
  premiumPass: 'premiumPass',   // ₹39 one-time — credit-based
  monthly:     'monthly',       // ₹99/month — unlimited
};

const FREE_LIMITS = {
  maxParticipants:  30,
  maxTeamBattles:   2,
};

/**
 * Feature gating map — which features require premium.
 */
export const PREMIUM_FEATURES = {
  exportResults:        { label: 'Export PDF / Results',     icon: '📄' },
  aiGeneration:         { label: 'AI Question Generation',   icon: '✨' },
  unlimitedPlayers:     { label: 'Unlimited Participants',   icon: '👥' },
  unlimitedTeamBattles: { label: 'Unlimited Team Battles',   icon: '⚔️' },
  premiumBadge:         { label: 'Premium ⭐ Badge',         icon: '⭐' },
  prioritySupport:      { label: 'Priority Support',         icon: '🛡️' },
};

// ══════════════════════════════════════════
//  INTERNAL STATE
// ══════════════════════════════════════════

let _userPlan  = null;   // { plan, expiresAt, classicCredits, teamBattleCredits, teamBattleCount, userId }
let _listeners = [];     // callbacks notified on plan change

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
    const snap    = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();

      if (!data.userPlan) {
        // First-time user — write defaults
        await updateDoc(userRef, {
          userPlan:          PLANS.free,
          planExpiresAt:     null,
          teamBattleCount:   0,
          classicCredits:    0,
          teamBattleCredits: 0,
        });
        _userPlan = {
          plan:              PLANS.free,
          expiresAt:         null,
          classicCredits:    0,
          teamBattleCredits: 0,
          teamBattleCount:   0,
          userId,
        };
      } else {
        let plan              = data.userPlan;
        const expiresAt       = data.planExpiresAt ?? null;
        let classicCredits    = data.classicCredits    ?? 0;
        let teamBattleCredits = data.teamBattleCredits ?? 0;

        // ── Monthly plan expiry check ──
        if (plan === PLANS.monthly && expiresAt) {
          const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
          if (expiryDate < new Date()) {
            plan = PLANS.free;
            await updateDoc(userRef, { userPlan: PLANS.free });
            showToast('Your premium plan has expired. Upgrade to continue.', 'error');
          }
        }

        // ── Premium Pass: revert when all credits consumed ──
        if (plan === PLANS.premiumPass && classicCredits <= 0 && teamBattleCredits <= 0) {
          plan = PLANS.free;
          await updateDoc(userRef, { userPlan: PLANS.free });
          showToast('Your Premium Pass credits are used up. Upgrade for more access.', 'error');
          classicCredits    = 0;
          teamBattleCredits = 0;
        }

        _userPlan = {
          plan,
          expiresAt,
          classicCredits,
          teamBattleCredits,
          teamBattleCount: data.teamBattleCount || 0,
          userId,
        };
      }
    }
  } catch (err) {
    console.error('[Premium] Failed to initialize premium:', err);
    _userPlan = {
      plan:              PLANS.free,
      expiresAt:         null,
      classicCredits:    0,
      teamBattleCredits: 0,
      teamBattleCount:   0,
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
 * Premium Pass is premium only while at least one credit type > 0.
 */
export function isPremium() {
  if (!_userPlan) return false;

  const { plan, expiresAt, classicCredits, teamBattleCredits } = _userPlan;

  if (plan === PLANS.free) return false;

  if (plan === PLANS.premiumPass) {
    // Active as long as at least one credit remains
    return (classicCredits > 0 || teamBattleCredits > 0);
  }

  if (plan === PLANS.monthly) {
    if (expiresAt) {
      const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
      if (expiryDate < new Date()) return false;
    }
    return true;
  }

  return false;
}

/**
 * Check if a specific premium feature is available.
 * @param {string} featureName - Key from PREMIUM_FEATURES
 */
export function canUseFeature(featureName) {
  if (isPremium()) return true;
  if (PREMIUM_FEATURES[featureName]) return false;
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
 * Free limit: 2. Premium Pass uses teamBattleCredits. Monthly: unlimited.
 * @returns {boolean} true if allowed
 */
export function checkTeamBattleLimit() {
  if (!_userPlan) return true; // plan not loaded yet — allow

  const { plan, teamBattleCredits, teamBattleCount } = _userPlan;

  if (plan === PLANS.monthly) return true;

  if (plan === PLANS.premiumPass) {
    return teamBattleCredits > 0;
  }

  // Free plan
  return (teamBattleCount || 0) < FREE_LIMITS.maxTeamBattles;
}

/**
 * Increment the team battle count in Firestore for free users.
 * For Premium Pass users, use consumeTeamBattleCredit() instead.
 */
export async function incrementTeamBattleCount() {
  if (!_userPlan?.userId) return;
  if (_userPlan.plan !== PLANS.free) return; // only free users use this counter

  try {
    const newCount = (_userPlan.teamBattleCount || 0) + 1;
    const userRef  = doc(db, 'users', _userPlan.userId);
    await updateDoc(userRef, { teamBattleCount: newCount });
    _userPlan.teamBattleCount = newCount;
  } catch (err) {
    console.error('[Premium] Failed to increment team battle count:', err);
  }
}

// ══════════════════════════════════════════
//  CREDIT CONSUMPTION (Premium Pass only)
// ══════════════════════════════════════════

/**
 * Consume one Classic Quiz credit for Premium Pass users.
 * If both credit types reach 0, reverts plan to free automatically.
 */
export async function consumeClassicCredit() {
  if (!_userPlan?.userId) return;
  if (_userPlan.plan !== PLANS.premiumPass) return;

  const newClassic = Math.max((_userPlan.classicCredits || 0) - 1, 0);
  _userPlan.classicCredits = newClassic;

  const updates = { classicCredits: newClassic };

  // Auto-revert if all credits exhausted
  if (newClassic <= 0 && (_userPlan.teamBattleCredits || 0) <= 0) {
    _userPlan.plan   = PLANS.free;
    updates.userPlan = PLANS.free;
    showToast('Your Premium Pass credits are all used up. Upgrade to continue!', 'error');
  } else {
    const remaining = newClassic + (_userPlan.teamBattleCredits || 0);
    showToast(`Classic credit used. ${newClassic} Classic + ${_userPlan.teamBattleCredits} Team Battle credit${remaining === 1 ? '' : 's'} remaining.`);
  }

  try {
    const userRef = doc(db, 'users', _userPlan.userId);
    await updateDoc(userRef, updates);
  } catch (err) {
    console.error('[Premium] Failed to consume classic credit:', err);
  }

  _notifyListeners();
  _applyPremiumUI();
}

/**
 * Consume one Team Battle credit for Premium Pass users.
 * If both credit types reach 0, reverts plan to free automatically.
 */
export async function consumeTeamBattleCredit() {
  if (!_userPlan?.userId) return;
  if (_userPlan.plan !== PLANS.premiumPass) return;

  const newTeam = Math.max((_userPlan.teamBattleCredits || 0) - 1, 0);
  _userPlan.teamBattleCredits = newTeam;

  const updates = { teamBattleCredits: newTeam };

  // Auto-revert if all credits exhausted
  if (newTeam <= 0 && (_userPlan.classicCredits || 0) <= 0) {
    _userPlan.plan   = PLANS.free;
    updates.userPlan = PLANS.free;
    showToast('Your Premium Pass credits are all used up. Upgrade to continue!', 'error');
  } else {
    const remaining = (_userPlan.classicCredits || 0) + newTeam;
    showToast(`Team Battle credit used. ${_userPlan.classicCredits} Classic + ${newTeam} Team Battle credit${remaining === 1 ? '' : 's'} remaining.`);
  }

  try {
    const userRef = doc(db, 'users', _userPlan.userId);
    await updateDoc(userRef, updates);
  } catch (err) {
    console.error('[Premium] Failed to consume team battle credit:', err);
  }

  _notifyListeners();
  _applyPremiumUI();
}

// ══════════════════════════════════════════
//  ACTIVATE PREMIUM (Post-payment)
// ══════════════════════════════════════════

/**
 * Activate premium for the current user.
 * @param {'premiumPass'|'monthly'} plan
 */
export async function activatePremium(plan) {
  if (!_userPlan?.userId) return;

  try {
    const userRef = doc(db, 'users', _userPlan.userId);

    if (plan === PLANS.premiumPass) {
      // Credit-based — no expiry date
      await updateDoc(userRef, {
        userPlan:             PLANS.premiumPass,
        planExpiresAt:        null,
        classicCredits:       2,
        teamBattleCredits:    2,
        premiumActivatedAt:   serverTimestamp(),
      });

      _userPlan.plan             = PLANS.premiumPass;
      _userPlan.expiresAt        = null;
      _userPlan.classicCredits   = 2;
      _userPlan.teamBattleCredits = 2;

    } else if (plan === PLANS.monthly) {
      // Time-based — 1 month expiry
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      await updateDoc(userRef, {
        userPlan:           PLANS.monthly,
        planExpiresAt:      expiresAt,
        premiumActivatedAt: serverTimestamp(),
      });

      _userPlan.plan      = PLANS.monthly;
      _userPlan.expiresAt = expiresAt;
    } else {
      throw new Error(`Unknown plan: ${plan}`);
    }

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

  const contextEl = modal.querySelector('.premium-modal-context');
  if (contextEl) {
    const messages = {
      ai:           '✨ AI Question Generation is a Premium feature.',
      export:       '📄 Exporting Results & PDF is a Premium feature.',
      teamBattle:   '⚔️ You\'ve used all your Team Battle credits. Upgrade for more!',
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
 * Call once from main.js / razorpay.js.
 */
export function initUpgradeModalBindings() {
  const modal = document.getElementById('premium-upgrade-modal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.premium-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeUpgradeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeUpgradeModal();
  });

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
 */
function _injectBadgeInto(container, premium) {
  if (!container) return;
  const existing = container.querySelector('.premium-user-badge');
  if (existing) existing.remove();
  if (premium) {
    const badge       = document.createElement('span');
    badge.className   = 'premium-user-badge';
    badge.textContent = '⭐ Premium';
    container.appendChild(badge);
  }
}

/**
 * Apply premium visual indicators across the app.
 * Called after plan is loaded or changed.
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
    el.classList.remove('premium-locked', 'premium-locked-btn');
    const oldBadge = el.querySelector('.premium-lock-badge');
    if (oldBadge) oldBadge.remove();
    const oldTag = el.querySelector('.premium-lock-tag');
    if (oldTag) oldTag.remove();

    if (!premium && !canUseFeature(feature)) {
      el.classList.add('premium-locked-btn');
      const tag       = document.createElement('span');
      tag.className   = 'premium-lock-tag';
      tag.textContent = '🔒 Premium';
      el.appendChild(tag);
    }
  });
}

/**
 * Public helper — re-apply premium badge to all slots.
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
  _userPlan  = null;
  _listeners = [];
}
