/* ══════════════════════════════════════════
   PLAYRA — ADMIN PANEL CONTROLLER
   ══════════════════════════════════════════ */

import { auth, db } from './firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword
} from 'firebase/auth';
import { showToast } from './utils.js';

// Controller State
let usersList = [];
let quizzesList = [];
let queriesList = [];
let platformSettings = {
  maintenanceMode: false,
  allowAiGeneration: true,
  maxQuestions: 30
};

// Pagination State
let userPage = 0;
const userPageSize = 5;
let filteredUsers = [];

// Selected items for modal actions
let selectedUserForDelete = null;
let selectedQuizForEdit = null;

// Active Overlay vs Standalone Page Detection
let isOverlayMode = false;

// ══════════════════════════════════════════
//  INITIALIZE CONTROLLER
// ══════════════════════════════════════════

export function initAdminController(overlay = false) {
  isOverlayMode = overlay;
  console.log(`[AdminController] Initializing (Overlay Mode: ${isOverlayMode})`);

  if (isOverlayMode) {
    window.checkOverlayAdminPermissions = checkOverlayAdminPermissions;
    setupAdminUI();
  } else if (window.location.pathname.includes('/pages/admin.html')) {
    checkAdminPermissions();
  }
}

// ══════════════════════════════════════════
//  PERMISSION CHECK
// ══════════════════════════════════════════

function checkAdminPermissions() {
  const authLoader = document.getElementById('admin-auth-loader');
  const mainContent = document.getElementById('admin-main-content');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      showToast('Please log in as an administrator.', 'error');
      window.location.href = '/';
      return;
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userDocRef);
      let isAdmin = false;

      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.status === 'blocked') {
          await auth.signOut();
          showToast('Your account is blocked.', 'error');
          window.location.href = '/';
          return;
        }
        isAdmin = (userData.role === 'admin');
      } else {
        isAdmin = (user.email === 'admin@playra.com');
      }

      if (!isAdmin) {
        showToast('Access denied: Administrator role required.', 'error');
        window.location.href = '/';
        return;
      }

      // Hide loader, show admin panel
      if (authLoader) authLoader.style.display = 'none';
      if (mainContent) mainContent.style.display = 'flex';

      setupAdminUI();
    } catch (err) {
      console.error('[AdminController] Permission verification failed:', err);
      showToast('Error verifying credentials. Redirecting...', 'error');
      window.location.href = '/';
    }
  });
}

export function checkOverlayAdminPermissions() {
  const loader = document.getElementById('admin-overlay-auth-loader');
  const main = document.getElementById('admin-overlay-main-content');

  if (loader) loader.style.display = 'flex';
  if (main) main.style.display = 'none';

  const user = auth.currentUser;
  if (!user) {
    if (loader) loader.style.display = 'none';
    return;
  }

  // Double check in database
  const userDocRef = doc(db, 'users', user.uid);
  getDoc(userDocRef).then((snap) => {
    let isAdmin = false;
    if (snap.exists() && snap.data().role === 'admin') {
      isAdmin = true;
    } else if (user.email === 'admin@playra.com') {
      isAdmin = true;
    }

    if (isAdmin) {
      if (loader) loader.style.display = 'none';
      if (main) main.style.display = 'flex';
    } else {
      // Hide admin panel entirely if somehow non-admin bypassed overlay
      const overlay = document.getElementById('overlay-admin-panel');
      if (overlay) overlay.style.display = 'none';
      showToast('Access denied.', 'error');
    }
  }).catch((err) => {
    console.error(err);
    if (loader) loader.style.display = 'none';
  });
}

// ══════════════════════════════════════════
//  SETUP UI LISTENERS
// ══════════════════════════════════════════

function setupAdminUI() {
  // 1. Sidebar views toggling
  const tabs = ['overview', 'users', 'quizzes', 'queries', 'settings'];
  const prefix = isOverlayMode ? 'overlay-' : '';

  tabs.forEach(tabName => {
    const sidebarBtn = document.querySelector(`#admin-sidebar-${tabName}`);
    if (sidebarBtn) {
      sidebarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Remove active class from all links
        document.querySelectorAll('.sidebar-link').forEach(link => {
          if (link.id && link.id.startsWith('admin-sidebar-')) {
            link.classList.remove('active');
          }
        });

        // Add active to current link
        sidebarBtn.classList.add('active');

        // Swap view divs
        document.querySelectorAll('.admin-view').forEach(view => {
          view.classList.remove('active');
        });

        const targetView = document.querySelector(`#admin-view-${tabName}`);
        if (targetView) targetView.classList.add('active');
      });
    }
  });

  // 2. Real-time DB listeners
  bindRealtimeListeners();

  // 3. User search & pagination UI events
  const userSearch = document.querySelector('#user-search-input');
  if (userSearch) {
    userSearch.addEventListener('input', () => {
      userPage = 0;
      applyUserFilters();
    });
  }

  const btnPrev = document.querySelector('#btn-user-prev');
  const btnNext = document.querySelector('#btn-user-next');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (userPage > 0) {
        userPage--;
        renderUsersTable();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const maxPages = Math.ceil(filteredUsers.length / userPageSize);
      if (userPage < maxPages - 1) {
        userPage++;
        renderUsersTable();
      }
    });
  }

  // 4. Quiz search UI events
  const quizSearch = document.querySelector('#quiz-search-input');
  if (quizSearch) {
    quizSearch.addEventListener('input', renderQuizzesTable);
  }

  // 4b. Queries search UI events
  const queriesSearch = document.querySelector('#queries-search-input');
  if (queriesSearch) {
    queriesSearch.addEventListener('input', renderQueriesList);
  }

  // 5. Settings forms
  setupSettingsForms();

  // 6. Modal close actions
  setupModals();
}

// ══════════════════════════════════════════
//  DATABASE SYNC (Real-time Listeners)
// ══════════════════════════════════════════

function bindRealtimeListeners() {
  // Sync Users
  onSnapshot(collection(db, 'users'), (snapshot) => {
    usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by name or creation
    usersList.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    updateOverviewStats();
    applyUserFilters();
    renderQuizzesTable(); // In case owners list updates
  });

  // Sync Quizzes
  onSnapshot(collection(db, 'quizzes'), (snapshot) => {
    quizzesList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateOverviewStats();
    renderQuizzesTable();
  });

  // Sync Platform Settings
  onSnapshot(doc(db, 'settings', 'platform'), (snapshot) => {
    if (snapshot.exists()) {
      platformSettings = snapshot.data();
      applyPlatformSettingsToForm();
      applyMaintenanceModeUI(platformSettings.maintenanceMode);
    } else {
      // Seed default settings if they do not exist
      setDoc(doc(db, 'settings', 'platform'), platformSettings);
    }
  });

  // Sync Contact Messages (Customer Queries)
  const queriesQuery = query(collection(db, 'contactMessages'), orderBy('createdAt', 'desc'));
  onSnapshot(queriesQuery, (snapshot) => {
    queriesList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderQueriesList();
    updateUnreadBadge();
  });
}

// ══════════════════════════════════════════
//  TAB 1: OVERVIEW STATS
// ══════════════════════════════════════════

function updateOverviewStats() {
  const totalUsersEl = document.querySelector('#admin-stat-users');
  const activeQuizzesEl = document.querySelector('#admin-stat-quizzes');
  const sessionsTodayEl = document.querySelector('#admin-stat-sessions');

  if (totalUsersEl) totalUsersEl.textContent = usersList.length.toLocaleString();
  
  const activeQuizzesCount = quizzesList.filter(q => q.status === 'live').length;
  if (activeQuizzesEl) activeQuizzesEl.textContent = activeQuizzesCount.toLocaleString();

  // Sessions today can represent quizzes created or played today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const activeSessionsToday = quizzesList.filter(q => {
    const updated = q.updatedAt?.toMillis?.() || 0;
    return updated >= todayStart.getTime();
  }).length;

  if (sessionsTodayEl) sessionsTodayEl.textContent = activeSessionsToday.toLocaleString();
}

// ══════════════════════════════════════════
//  TAB 2: USERS TAB
// ══════════════════════════════════════════

function applyUserFilters() {
  const queryText = (document.querySelector('#user-search-input')?.value || '').toLowerCase().trim();

  filteredUsers = usersList.filter(user => {
    const name = (user.displayName || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    return name.includes(queryText) || email.includes(queryText);
  });

  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.querySelector('#admin-users-table-body');
  const paginationInfo = document.querySelector('#user-pagination-info');
  const btnPrev = document.querySelector('#btn-user-prev');
  const btnNext = document.querySelector('#btn-user-next');

  if (!tbody) return;

  tbody.innerHTML = '';

  const total = filteredUsers.length;
  const maxPages = Math.ceil(total / userPageSize);

  // Pagination bounds
  const start = userPage * userPageSize;
  const end = Math.min(start + userPageSize, total);

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-text-secondary); font-style:italic; padding:32px;">No accounts found.</td></tr>`;
    if (paginationInfo) paginationInfo.textContent = 'Showing 0-0 of 0 users';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  // Update button states
  if (btnPrev) btnPrev.disabled = userPage === 0;
  if (btnNext) btnNext.disabled = userPage >= maxPages - 1;
  if (paginationInfo) paginationInfo.textContent = `Showing ${start + 1}-${end} of ${total} users`;

  const pageUsers = filteredUsers.slice(start, end);

  pageUsers.forEach(user => {
    const tr = document.createElement('tr');

    const formattedDate = user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    }) : '—';

    const roleBadge = user.role === 'admin'
      ? `<span class="admin-badge admin-badge--admin">🛡️ admin</span>`
      : `<span class="admin-badge admin-badge--user">👥 user</span>`;

    const statusBadge = user.status === 'blocked'
      ? `<span class="admin-badge admin-badge--blocked">🚫 blocked</span>`
      : `<span class="admin-badge admin-badge--active">⚡ active</span>`;

    const blockBtn = user.status === 'blocked'
      ? `<button class="admin-btn admin-btn--success btn-unblock" data-uid="${user.uid}">Unblock</button>`
      : `<button class="admin-btn btn-block-user" data-uid="${user.uid}">Block</button>`;

    // Prevent deleting or blocking self
    const isSelf = auth.currentUser && auth.currentUser.uid === user.uid;
    const actionsHtml = isSelf ? `<em>Current User</em>` : `
      <div class="admin-actions">
        ${blockBtn}
        <button class="admin-btn admin-btn--danger btn-delete-user" data-uid="${user.uid}">Delete</button>
      </div>
    `;

    tr.innerHTML = `
      <td><strong>${user.displayName || '—'}</strong></td>
      <td>${user.email || '—'}</td>
      <td>${formattedDate}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${actionsHtml}</td>
    `;

    tbody.appendChild(tr);
  });

  // Bind row actions
  tbody.querySelectorAll('.btn-block-user').forEach(btn => {
    btn.addEventListener('click', () => updateUserStatus(btn.dataset.uid, 'blocked'));
  });

  tbody.querySelectorAll('.btn-unblock').forEach(btn => {
    btn.addEventListener('click', () => updateUserStatus(btn.dataset.uid, 'active'));
  });

  tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = usersList.find(u => u.uid === btn.dataset.uid);
      if (user) {
        selectedUserForDelete = user;
        const confirmName = document.querySelector('#delete-user-name');
        if (confirmName) confirmName.textContent = user.displayName || user.email;
        openAdminModal('overlay-delete-user');
      }
    });
  });
}

async function updateUserStatus(uid, status) {
  try {
    const userDocRef = doc(db, 'users', uid);
    await updateDoc(userDocRef, { status });
    showToast(`User status updated to ${status}.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to update user status.', 'error');
  }
}

async function deleteUserAccount() {
  if (!selectedUserForDelete) return;
  const uid = selectedUserForDelete.uid;

  try {
    // 1. Delete user from Firestore
    await deleteDoc(doc(db, 'users', uid));

    // 2. Delete user's quizzes from Firestore
    const userQuizzes = quizzesList.filter(q => q.hostId === uid);
    const deleteQuizPromises = userQuizzes.map(q => {
      // Delete quiz doc
      return deleteDoc(doc(db, 'quizzes', q.id));
    });
    await Promise.all(deleteQuizPromises);

    showToast('User account and associated quizzes deleted successfully.', 'success');
    closeAdminModal('overlay-delete-user');
    selectedUserForDelete = null;
  } catch (err) {
    console.error(err);
    showToast('Failed to delete account.', 'error');
  }
}

// ══════════════════════════════════════════
//  TAB 3: ALL QUIZZES TAB
// ══════════════════════════════════════════

function renderQuizzesTable() {
  const tbody = document.querySelector('#admin-quizzes-table-body');
  const queryText = (document.querySelector('#quiz-search-input')?.value || '').toLowerCase().trim();

  if (!tbody) return;

  tbody.innerHTML = '';

  // Filter quizzes by search query
  const filteredQuizzes = quizzesList.filter(quiz => {
    const title = (quiz.title || '').toLowerCase();
    const code = (quiz.quizCode || '').toLowerCase();
    return title.includes(queryText) || code.includes(queryText);
  });

  if (filteredQuizzes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-text-secondary); font-style:italic; padding:32px;">No quizzes found.</td></tr>`;
    return;
  }

  // Group quizzes by user (hostId)
  const groupedQuizzes = {};
  filteredQuizzes.forEach(quiz => {
    const hostId = quiz.hostId || 'unknown';
    if (!groupedQuizzes[hostId]) groupedQuizzes[hostId] = [];
    groupedQuizzes[hostId].push(quiz);
  });

  // Render grouped structure
  for (const [hostId, quizzes] of Object.entries(groupedQuizzes)) {
    const creatorUser = usersList.find(u => u.uid === hostId);
    const creatorLabel = creatorUser
      ? `${creatorUser.displayName} (${creatorUser.email})`
      : `User ID: ${hostId}`;

    // Render group header row
    const headerTr = document.createElement('tr');
    headerTr.className = 'admin-table-group-header';
    headerTr.innerHTML = `<td colspan="6">👤 Created by: <strong>${creatorLabel}</strong> (${quizzes.length} quizzes)</td>`;
    tbody.appendChild(headerTr);

    quizzes.forEach(quiz => {
      const tr = document.createElement('tr');
      
      const formattedDate = quiz.createdAt ? new Date(quiz.createdAt.seconds * 1000).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      }) : '—';

      const qCount = quiz.questions ? quiz.questions.length : 0;
      const category = quiz.category || 'General';
      const code = quiz.status === 'live' && quiz.quizCode ? `<strong>${quiz.quizCode}</strong>` : `<span style="color:var(--color-text-secondary);">Draft</span>`;

      tr.innerHTML = `
        <td style="padding-left:36px;">📝 ${quiz.title || 'Untitled Quiz'}</td>
        <td>${category}</td>
        <td>${qCount} questions</td>
        <td>${formattedDate}</td>
        <td>${code}</td>
        <td>
          <div class="admin-actions">
            <button class="admin-btn btn-view-quiz" data-id="${quiz.id}">View/Edit</button>
            <button class="admin-btn admin-btn--danger btn-delete-quiz" data-id="${quiz.id}">Delete</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  // Bind actions
  tbody.querySelectorAll('.btn-view-quiz').forEach(btn => {
    btn.addEventListener('click', () => {
      const quiz = quizzesList.find(q => q.id === btn.dataset.id);
      if (quiz) {
        openQuizViewerModal(quiz);
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-quiz').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to permanently delete "${btn.closest('tr').cells[0].textContent.replace('📝 ', '')}"?`)) {
        try {
          await deleteDoc(doc(db, 'quizzes', btn.dataset.id));
          showToast('Quiz deleted successfully.', 'success');
        } catch (err) {
          console.error(err);
          showToast('Failed to delete quiz.', 'error');
        }
      }
    });
  });
}

// ══════════════════════════════════════════
//  TAB 5: CUSTOMER QUERIES
// ══════════════════════════════════════════

function renderQueriesList() {
  const container = document.querySelector('#admin-queries-list');
  const searchText = (document.querySelector('#queries-search-input')?.value || '').toLowerCase().trim();

  if (!container) return;

  container.innerHTML = '';

  // Filter
  const filtered = queriesList.filter(msg => {
    const name = (msg.name || '').toLowerCase();
    const email = (msg.email || '').toLowerCase();
    const message = (msg.message || '').toLowerCase();
    return name.includes(searchText) || email.includes(searchText) || message.includes(searchText);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="queries-empty">
        <div class="queries-empty-icon">📭</div>
        <h3>No messages found</h3>
        <p>${searchText ? 'Try a different search term.' : 'Customer messages submitted through the Contact Us form will appear here.'}</p>
      </div>
    `;
    return;
  }

  filtered.forEach((msg, index) => {
    const card = document.createElement('div');
    card.className = `query-card ${msg.status === 'unread' ? 'query-card--unread' : ''}`;
    card.style.animationDelay = `${index * 0.05}s`;

    const statusClass = msg.status === 'unread' ? 'query-card-status--unread' : 'query-card-status--read';
    const statusIcon = msg.status === 'unread' ? '●' : '✓';
    const statusLabel = msg.status === 'unread' ? 'Unread' : 'Read';

    let formattedDate = '—';
    if (msg.createdAt) {
      const ts = msg.createdAt.seconds ? new Date(msg.createdAt.seconds * 1000) : new Date(msg.createdAt);
      formattedDate = ts.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      }) + ' at ' + ts.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit'
      });
    }

    const markReadBtn = msg.status === 'unread'
      ? `<button class="admin-btn admin-btn--read btn-mark-read" data-id="${msg.id}">✓ Mark as Read</button>`
      : `<span class="admin-badge admin-badge--active" style="font-size:0.72rem;">✓ Read</span>`;

    card.innerHTML = `
      <div class="query-card-header">
        <div class="query-card-sender">
          <span class="query-card-name">${escapeHtml(msg.name || 'Anonymous')}</span>
          <span class="query-card-email">${escapeHtml(msg.email || '—')}</span>
        </div>
        <span class="query-card-status ${statusClass}">${statusIcon} ${statusLabel}</span>
      </div>
      <div class="query-card-body">${escapeHtml(msg.message || '')}</div>
      <div class="query-card-footer">
        <span class="query-card-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formattedDate}
        </span>
        <div class="query-card-actions">
          ${markReadBtn}
          <button class="admin-btn admin-btn--danger btn-delete-query" data-id="${msg.id}">Delete</button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  // Bind mark-as-read
  container.querySelectorAll('.btn-mark-read').forEach(btn => {
    btn.addEventListener('click', () => markQueryAsRead(btn.dataset.id));
  });

  // Bind delete
  container.querySelectorAll('.btn-delete-query').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await deleteDoc(doc(db, 'contactMessages', btn.dataset.id));
        showToast('Message deleted.', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to delete message.', 'error');
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function markQueryAsRead(msgId) {
  try {
    await updateDoc(doc(db, 'contactMessages', msgId), { status: 'read' });
    showToast('Message marked as read.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to update message status.', 'error');
  }
}

function updateUnreadBadge() {
  const unreadCount = queriesList.filter(m => m.status === 'unread').length;
  const badges = document.querySelectorAll('#queries-unread-badge');

  badges.forEach(badge => {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  });
}

// ══════════════════════════════════════════
//  QUIZ DETAIL/EDITOR MODAL WINDOW
// ══════════════════════════════════════════

function openQuizViewerModal(quiz) {
  selectedQuizForEdit = quiz;
  
  const titleInput = document.querySelector('#quiz-edit-title');
  const qlist = document.querySelector('#quiz-edit-qlist');
  const modalTitle = document.querySelector('#quiz-modal-title');

  if (modalTitle) modalTitle.textContent = `Edit Quiz: ${quiz.title || 'Untitled'}`;
  if (titleInput) titleInput.value = quiz.title || '';

  if (qlist) {
    qlist.innerHTML = '';
    const questions = quiz.questions || [];

    questions.forEach((q, index) => {
      const card = document.createElement('div');
      card.className = 'admin-quiz-qcard';
      card.dataset.index = index;

      const optionsHtml = (q.options || []).map((opt, optIdx) => {
        const isCorrectClass = optIdx === q.correctAnswer ? 'admin-quiz-option--correct' : '';
        const isCorrectIcon = optIdx === q.correctAnswer ? '✓ ' : '';
        return `
          <div class="admin-quiz-option ${isCorrectClass}">
            <input type="radio" name="correct-for-q-${index}" value="${optIdx}" ${optIdx === q.correctAnswer ? 'checked' : ''} style="margin-right:6px; cursor:pointer;" />
            <input type="text" class="settings-input q-option-input" value="${opt}" style="padding: 4px 8px; font-size: 0.8rem; border-color:transparent; background:transparent; width: calc(100% - 24px);" />
          </div>
        `;
      }).join('');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="font-size:0.85rem; color:var(--color-primary);">Question ${index + 1}</strong>
          <button class="admin-btn admin-btn--danger btn-del-q" style="padding:2px 8px; font-size:0.75rem;" data-idx="${index}">Remove</button>
        </div>
        <input type="text" class="settings-input q-text-input" value="${q.question || ''}" style="margin-bottom:8px; width:100%; font-size:0.9rem; padding: 6px 12px;" />
        <div class="admin-quiz-options">
          ${optionsHtml}
        </div>
      `;

      // Set correct answer radio listener
      card.querySelectorAll(`input[name="correct-for-q-${index}"]`).forEach(radio => {
        radio.addEventListener('change', (e) => {
          card.querySelectorAll('.admin-quiz-option').forEach((optDiv, idx) => {
            if (idx === parseInt(e.target.value)) {
              optDiv.classList.add('admin-quiz-option--correct');
            } else {
              optDiv.classList.remove('admin-quiz-option--correct');
            }
          });
        });
      });

      card.querySelector('.btn-del-q').addEventListener('click', () => {
        card.remove();
        reindexQuestionsList();
      });

      qlist.appendChild(card);
    });
  }

  openAdminModal('overlay-quiz-edit');
}

function reindexQuestionsList() {
  const cards = document.querySelectorAll('#quiz-edit-qlist .admin-quiz-qcard');
  cards.forEach((card, index) => {
    card.dataset.index = index;
    const label = card.querySelector('strong');
    if (label) label.textContent = `Question ${index + 1}`;
    
    // Rename inputs
    card.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.name = `correct-for-q-${index}`;
    });
  });
}

async function saveQuizEditChanges() {
  if (!selectedQuizForEdit) return;

  const titleInput = document.querySelector('#quiz-edit-title');
  const title = (titleInput?.value || 'Untitled Quiz').trim();

  // Re-build questions array from DOM
  const questionCards = document.querySelectorAll('#quiz-edit-qlist .admin-quiz-qcard');
  const questions = [];

  questionCards.forEach(card => {
    const questionText = card.querySelector('.q-text-input').value.trim();
    
    const optionInputs = card.querySelectorAll('.q-option-input');
    const options = Array.from(optionInputs).map(inp => inp.value.trim());

    const selectedRadio = card.querySelector('input[type="radio"]:checked');
    const correctAnswer = selectedRadio ? parseInt(selectedRadio.value) : 0;

    questions.push({
      question: questionText,
      options: options,
      correctAnswer: correctAnswer
    });
  });

  try {
    const docRef = doc(db, 'quizzes', selectedQuizForEdit.id);
    await updateDoc(docRef, {
      title: title,
      questions: questions,
      updatedAt: serverTimestamp()
    });
    showToast('Quiz updated successfully.', 'success');
    closeAdminModal('overlay-quiz-edit');
    selectedQuizForEdit = null;
  } catch (err) {
    console.error(err);
    showToast('Failed to save changes.', 'error');
  }
}

// ══════════════════════════════════════════
//  TAB 4: SETTINGS MANAGEMENT
// ══════════════════════════════════════════

function applyPlatformSettingsToForm() {
  const maintenanceCb = document.querySelector('#toggle-maintenance');
  const allowAiCb = document.querySelector('#toggle-allow-ai');
  const maxQuestionsInp = document.querySelector('#settings-max-questions');

  if (maintenanceCb) maintenanceCb.checked = platformSettings.maintenanceMode || false;
  if (allowAiCb) allowAiCb.checked = platformSettings.allowAiGeneration !== false;
  if (maxQuestionsInp) maxQuestionsInp.value = platformSettings.maxQuestions || 30;
}

function setupSettingsForms() {
  // Update Profile
  const profileForm = document.querySelector('#admin-profile-form');
  const profileNameInp = document.querySelector('#admin-profile-name');

  // Fill in display name
  onAuthStateChanged(auth, (user) => {
    if (user && profileNameInp) {
      profileNameInp.value = user.displayName || 'Administrator';
    }
  });

  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      const newName = (profileNameInp?.value || '').trim();
      if (!user || !newName) return;

      try {
        await updateProfile(user, { displayName: newName });
        // Update user record in database
        await updateDoc(doc(db, 'users', user.uid), { displayName: newName });
        showToast('Profile name updated.', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to update name.', 'error');
      }
    });
  }

  // Change password
  const passwordForm = document.querySelector('#admin-password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      const newPassword = document.querySelector('#admin-new-password').value;
      if (!user || !newPassword) return;

      try {
        await updatePassword(user, newPassword);
        showToast('Password updated successfully.', 'success');
        passwordForm.reset();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to update password. Please log in again and retry.', 'error');
      }
    });
  }

  // Platform Config Toggles & Input
  const maintenanceCb = document.querySelector('#toggle-maintenance');
  const allowAiCb = document.querySelector('#toggle-allow-ai');
  const maxQuestionsInp = document.querySelector('#settings-max-questions');

  const updatePlatformConfig = async () => {
    try {
      const config = {
        maintenanceMode: maintenanceCb ? maintenanceCb.checked : false,
        allowAiGeneration: allowAiCb ? allowAiCb.checked : true,
        maxQuestions: maxQuestionsInp ? parseInt(maxQuestionsInp.value) : 30
      };
      await setDoc(doc(db, 'settings', 'platform'), config);
    } catch (err) {
      console.error(err);
      showToast('Failed to save platform configuration.', 'error');
    }
  };

  if (maintenanceCb) maintenanceCb.addEventListener('change', updatePlatformConfig);
  if (allowAiCb) allowAiCb.addEventListener('change', updatePlatformConfig);
  if (maxQuestionsInp) maxQuestionsInp.addEventListener('change', updatePlatformConfig);

  // Promote User
  const promoteForm = document.querySelector('#admin-promote-form');
  if (promoteForm) {
    promoteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.querySelector('#promote-email').value.trim().toLowerCase();
      if (!email) return;

      try {
        // Query users collection for user with this email
        const q = query(collection(db, 'users'), where('email', '==', email));
        const snap = await getDocs(q);

        if (snap.empty) {
          showToast('User email not found. Make sure they have signed up first.', 'error');
          return;
        }

        const userDoc = snap.docs[0];
        await updateDoc(userDoc.ref, { role: 'admin' });
        showToast(`User ${email} successfully promoted to Administrator!`, 'success');
        promoteForm.reset();
      } catch (err) {
        console.error(err);
        showToast('Failed to promote user.', 'error');
      }
    });
  }
}

// ══════════════════════════════════════════
//  MAINTENANCE MODE BANNER & HOOK
// ══════════════════════════════════════════

function applyMaintenanceModeUI(isEnabled) {
  let banner = document.querySelector('#global-maintenance-banner');
  
  if (isEnabled) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'global-maintenance-banner';
      banner.className = 'maintenance-banner';
      banner.innerHTML = `⚠️ <strong>Maintenance Mode is Active</strong> — Public actions are temporarily disabled.`;
      document.body.prepend(banner);
    }
  } else {
    if (banner) banner.remove();
  }
}

// ══════════════════════════════════════════
//  MODAL DIALOG ACTION CONTROLS
// ══════════════════════════════════════════

function setupModals() {
  // User Delete confirmation
  const btnCloseDel = document.querySelector('#btn-close-delete-modal');
  const btnCancelDel = document.querySelector('#btn-cancel-delete');
  const btnConfirmDel = document.querySelector('#btn-confirm-delete');

  if (btnCloseDel) btnCloseDel.addEventListener('click', () => closeAdminModal('overlay-delete-user'));
  if (btnCancelDel) btnCancelDel.addEventListener('click', () => closeAdminModal('overlay-delete-user'));
  if (btnConfirmDel) btnConfirmDel.addEventListener('click', deleteUserAccount);

  // Quiz Viewer
  const btnCloseQuiz = document.querySelector('#btn-close-quiz-modal');
  const btnCancelQuiz = document.querySelector('#btn-close-quiz-edit');
  const btnSaveQuiz = document.querySelector('#btn-save-quiz-edit');

  if (btnCloseQuiz) btnCloseQuiz.addEventListener('click', () => closeAdminModal('overlay-quiz-edit'));
  if (btnCancelQuiz) btnCancelQuiz.addEventListener('click', () => closeAdminModal('overlay-quiz-edit'));
  if (btnSaveQuiz) btnSaveQuiz.addEventListener('click', saveQuizEditChanges);
}

function openAdminModal(id) {
  const overlay = document.querySelector(`#${id}`);
  if (overlay) overlay.classList.add('open');
}

function closeAdminModal(id) {
  const overlay = document.querySelector(`#${id}`);
  if (overlay) overlay.classList.remove('open');
}
