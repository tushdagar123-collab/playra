/* ══════════════════════════════════════════
   PLAYRA — ACCOUNT SERVICE
   Profile, Plan, Usage, Billing, Queries
   ══════════════════════════════════════════ */

import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, collection, query, where, orderBy,
  getDocs, addDoc, serverTimestamp, onSnapshot
} from 'firebase/firestore';
import { getUserPlan, isPremium, onPlanChange, openUpgradeModal } from './premium-service.js';
import { showToast } from './utils.js';

// ══════════════════════════════════════════
//  INITIALIZE ACCOUNT VIEW
// ══════════════════════════════════════════

let _initialized = false;

/**
 * Load account data and render the Account view.
 * Safe to call multiple times — skips if view element is missing.
 */
export async function initAccountView() {
  const container = document.getElementById('view-account');
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  // Avoid redundant re-renders if already loaded for same user
  if (_initialized && container.dataset.uid === user.uid) return;
  _initialized = true;
  container.dataset.uid = user.uid;

  // Show loading state
  container.innerHTML = buildLoadingHTML();

  try {
    // Fetch user doc from Firestore
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    // Fetch payment history from Firestore
    const payments = await fetchPaymentHistory(user.uid);

    // Render initial view (queries loaded separately via real-time listener)
    container.innerHTML = buildAccountHTML(user, userData, payments, []);

    // Wire up upgrade button
    const upgradeBtn = container.querySelector('#account-upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openUpgradeModal();
      });
    }

    // Start real-time listener for My Queries
    setupQueriesRealtime(user);

  } catch (err) {
    console.error('[Account] Failed to load account data:', err);
    container.innerHTML = `
      <h1 class="dashboard-title">Account</h1>
      <p class="dashboard-subtitle" style="color: #ef4444;">Failed to load account information. Please try again.</p>
    `;
  }
}

/**
 * Force re-render on plan change.
 */
export function setupAccountPlanListener() {
  onPlanChange(() => {
    _initialized = false;
    initAccountView();
  });
}

// ══════════════════════════════════════════
//  FIRESTORE: PAYMENT HISTORY
// ══════════════════════════════════════════

/**
 * Store a payment record in Firestore after successful Razorpay payment.
 * Call this from razorpay.js handler after verification succeeds.
 *
 * @param {object} params
 * @param {string} params.userId - Firebase Auth UID
 * @param {string} params.paymentId - Razorpay payment ID
 * @param {string} params.orderId - Razorpay order ID
 * @param {string} params.plan - 'monthly' or 'premiumPass'
 * @param {number} params.amount - Amount in paise
 * @param {string} params.currency - e.g. 'INR'
 */
export async function storePaymentRecord({ userId, paymentId, orderId, plan, amount, currency }) {
  if (!userId) return;

  try {
    await addDoc(collection(db, 'payments'), {
      userId,
      paymentId,
      orderId,
      plan,
      amount,
      currency: currency || 'INR',
      status: 'captured',
      createdAt: serverTimestamp(),
    });
    console.log('[Account] Payment record stored:', paymentId);
  } catch (err) {
    console.error('[Account] Failed to store payment record:', err);
  }
}

/**
 * Fetch payment history for a user from Firestore.
 * @param {string} userId
 * @returns {Array}
 */
async function fetchPaymentHistory(userId) {
  try {
    const q = query(
      collection(db, 'payments'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[Account] Failed to fetch payments:', err);
    return [];
  }
}

/**
 * Set up real-time listener for user's own contact queries.
 * Queries by userId first, then merges email-matched older records.
 * Updates the My Queries section of the account view in real-time.
 * @param {object} user - Firebase Auth user
 */
let _queriesUnsubscribe = null;

function setupQueriesRealtime(user) {
  // Cancel any previous listener
  if (_queriesUnsubscribe) {
    _queriesUnsubscribe();
    _queriesUnsubscribe = null;
  }

  // Query by userId (new records)
  const qByUid = query(
    collection(db, 'contactMessages'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc')
  );

  _queriesUnsubscribe = onSnapshot(qByUid, (snapshot) => {
    const queries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const card = document.querySelector('#account-queries-card');
    if (card) {
      card.innerHTML = buildMyQueriesContent(queries);
    }
  }, (err) => {
    console.error('[Account] Real-time queries listener error:', err);
  });
}

/**
 * Fetch user's own contact queries from Firestore (legacy email-based).
 * @param {string} email
 * @returns {Array}
 */
async function fetchUserQueries(email) {
  if (!email) return [];
  try {
    const q = query(
      collection(db, 'contactMessages'),
      where('email', '==', email),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[Account] Failed to fetch queries:', err);
    return [];
  }
}

// ══════════════════════════════════════════
//  HTML BUILDERS
// ══════════════════════════════════════════

function buildLoadingHTML() {
  return `
    <h1 class="dashboard-title">Account</h1>
    <p class="dashboard-subtitle">Loading your account information…</p>
    <div class="account-grid">
      <div class="account-profile-card"><div class="account-skeleton" style="width:60%;height:20px;"></div></div>
      <div class="account-plan-card"><div class="account-skeleton" style="width:40%;height:20px;"></div></div>
    </div>
  `;
}

function buildAccountHTML(user, userData, payments, queries) {
  const plan = getUserPlan();
  const premium = isPremium();

  return `
    <h1 class="dashboard-title">Account</h1>
    <p class="dashboard-subtitle">Manage your profile, plan, and billing information.</p>

    <div class="account-grid">

      <!-- Profile Card -->
      ${buildProfileCard(user, userData)}

      <!-- Plan Status Card -->
      ${buildPlanCard(plan, premium)}

      <!-- Usage Stats -->
      <div class="account-full-width">
        ${buildUsageStats(plan, userData)}
      </div>

      <!-- Billing History -->
      <div class="account-full-width">
        ${buildBillingHistory(payments)}
      </div>

      <!-- My Queries -->
      <div class="account-full-width">
        <h3 class="account-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          My Queries
        </h3>
        <div class="account-queries-card" id="account-queries-card">
          <div class="queries-user-empty">
            <div class="queries-user-empty-icon">💬</div>
            <h4>Loading queries…</h4>
          </div>
        </div>
      </div>

    </div>
  `;
}

function buildProfileCard(user, userData) {
  const name = user.displayName || userData.displayName || 'User';
  const email = user.email || userData.email || '—';
  const photoURL = user.photoURL || userData.photoURL;
  const provider = userData.authProvider || (user.providerData?.[0]?.providerId === 'google.com' ? 'google' : 'email');
  const joinDate = userData.createdAt
    ? new Date(userData.createdAt.seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const avatarContent = photoURL
    ? `<img src="${photoURL}" alt="${name}" referrerpolicy="no-referrer" />`
    : name.charAt(0);

  const providerTag = provider === 'google'
    ? '<span class="account-meta-tag account-meta-tag--google">Google</span>'
    : '<span class="account-meta-tag">Email</span>';

  return `
    <div class="account-profile-card">
      <div class="account-avatar">${avatarContent}</div>
      <div class="account-profile-info">
        <h3 class="account-profile-name">${escapeHtml(name)}</h3>
        <p class="account-profile-email">${escapeHtml(email)}</p>
        <div class="account-profile-meta">
          ${providerTag}
          <span class="account-meta-tag">Joined ${joinDate}</span>
        </div>
      </div>
    </div>
  `;
}

function buildPlanCard(plan, premium) {
  const planName = plan?.plan || 'free';
  let badgeClass, badgeLabel;

  if (planName === 'monthly') {
    badgeClass = 'plan-badge--monthly';
    badgeLabel = '⭐ Monthly Premium';
  } else if (planName === 'premiumPass') {
    badgeClass = 'plan-badge--pass';
    badgeLabel = '🎫 Premium Pass';
  } else {
    badgeClass = 'plan-badge--free';
    badgeLabel = 'Free Plan';
  }

  let detailsHTML = '';

  if (planName === 'premiumPass') {
    const cc = plan?.classicCredits ?? 0;
    const tc = plan?.teamBattleCredits ?? 0;
    detailsHTML = `
      <div class="account-plan-details">
        <div class="account-plan-detail"><span>Classic Credits</span><strong>${cc}</strong></div>
        <div class="account-plan-detail"><span>Team Battle Credits</span><strong>${tc}</strong></div>
      </div>
    `;
  } else if (planName === 'monthly') {
    const expiresAt = plan?.expiresAt;
    let expiryStr = '—';
    if (expiresAt) {
      const d = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
      expiryStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    detailsHTML = `
      <div class="account-plan-details">
        <div class="account-plan-detail"><span>Expires</span><strong>${expiryStr}</strong></div>
        <div class="account-plan-detail"><span>Features</span><strong>All Unlimited</strong></div>
      </div>
    `;
  } else {
    const tbCount = plan?.teamBattleCount ?? 0;
    detailsHTML = `
      <div class="account-plan-details">
        <div class="account-plan-detail"><span>Participants Limit</span><strong>30 max</strong></div>
        <div class="account-plan-detail"><span>Team Battles Used</span><strong>${tbCount} / 2</strong></div>
      </div>
    `;
  }

  const upgradeHTML = !premium
    ? `<div class="account-plan-upgrade"><button class="btn btn--primary btn--sm" id="account-upgrade-btn">⭐ Upgrade to Premium</button></div>`
    : '';

  return `
    <div class="account-plan-card">
      <div class="account-plan-header">
        <span class="account-plan-label">Current Plan</span>
        <span class="plan-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      ${detailsHTML}
      ${upgradeHTML}
    </div>
  `;
}

function buildUsageStats(plan, userData) {
  const planName = plan?.plan || 'free';
  const tbCount = plan?.teamBattleCount ?? userData.teamBattleCount ?? 0;

  let stat3Label, stat3Value;
  if (planName === 'premiumPass') {
    stat3Label = 'Credits Left';
    stat3Value = (plan?.classicCredits ?? 0) + (plan?.teamBattleCredits ?? 0);
  } else if (planName === 'monthly') {
    stat3Label = 'Plan Status';
    stat3Value = '∞';
  } else {
    stat3Label = 'Free Battles Left';
    stat3Value = Math.max(0, 2 - tbCount);
  }

  return `
    <h3 class="account-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      Plan Usage
    </h3>
    <div class="account-usage-stats">
      <div class="account-stat-card">
        <div class="account-stat-icon">📋</div>
        <div class="account-stat-value" id="account-total-quizzes">—</div>
        <div class="account-stat-label">Quizzes Created</div>
      </div>
      <div class="account-stat-card">
        <div class="account-stat-icon">⚔️</div>
        <div class="account-stat-value">${tbCount}</div>
        <div class="account-stat-label">Team Battles</div>
      </div>
      <div class="account-stat-card">
        <div class="account-stat-icon">${planName === 'monthly' ? '♾️' : '🎯'}</div>
        <div class="account-stat-value">${stat3Value}</div>
        <div class="account-stat-label">${stat3Label}</div>
      </div>
    </div>
  `;
}

function buildBillingHistory(payments) {
  let tableBody = '';

  if (payments.length === 0) {
    tableBody = `
      <div class="billing-empty">
        <div class="billing-empty-icon">🧾</div>
        <h4>No billing history</h4>
        <p>Your payment records will appear here after your first purchase.</p>
      </div>
    `;
  } else {
    const rows = payments.map(p => {
      const date = p.createdAt
        ? new Date(p.createdAt.seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';
      const amount = p.amount ? `₹${(p.amount / 100).toFixed(0)}` : '—';
      const planLabel = p.plan === 'premiumPass' ? 'Premium Pass' : p.plan === 'monthly' ? 'Monthly' : p.plan || '—';
      const statusClass = p.status === 'captured' ? 'billing-status--success' : 'billing-status--failed';
      const statusLabel = p.status === 'captured' ? '✓ Paid' : p.status || '—';

      return `
        <tr>
          <td>${date}</td>
          <td><strong>${amount}</strong></td>
          <td>${planLabel}</td>
          <td><span class="billing-status ${statusClass}">${statusLabel}</span></td>
        </tr>
      `;
    }).join('');

    tableBody = `
      <table class="account-billing-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Plan</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  return `
    <h3 class="account-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      Billing History
    </h3>
    <div class="account-billing-card">
      ${tableBody}
    </div>
  `;
}

function buildMyQueriesContent(queries) {
  if (queries.length === 0) {
    return `
      <div class="queries-user-empty">
        <div class="queries-user-empty-icon">💬</div>
        <h4>No messages sent</h4>
        <p>Messages you send through the Contact form will appear here.</p>
      </div>
    `;
  }

  return queries.map(q => {
    const date = q.createdAt
      ? new Date(q.createdAt.seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';

    // Normalise status: old 'unread' -> 'Pending', old 'read' -> 'Read'
    const rawStatus = q.status || 'Pending';
    const status = rawStatus === 'unread' ? 'Pending' : rawStatus === 'read' ? 'Read' : rawStatus;

    let statusClass, statusLabel;
    if (status === 'Resolved') {
      statusClass = 'account-query-status--resolved';
      statusLabel = '✅ Resolved';
    } else if (status === 'Read') {
      statusClass = 'account-query-status--read';
      statusLabel = '🔵 Read';
    } else {
      statusClass = 'account-query-status--pending';
      statusLabel = '🟡 Pending';
    }

    const replyHTML = q.adminReply
      ? `<div class="account-query-reply">
           <span class="account-query-reply-label">Admin Reply:</span>
           <p class="account-query-reply-text">${escapeHtml(q.adminReply)}</p>
         </div>`
      : '';

    return `
      <div class="account-query-item">
        <p class="account-query-message">${escapeHtml(q.message || '')}</p>
        ${replyHTML}
        <div class="account-query-meta">
          <span>${date}</span>
          <span class="account-query-status ${statusClass}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');
}

function buildMyQueries(queries) {
  return `
    <h3 class="account-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      My Queries
    </h3>
    <div class="account-queries-card" id="account-queries-card">
      ${buildMyQueriesContent(queries)}
    </div>
  `;
}

// ── Helpers ──

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
