/* ══════════════════════════════════════════
   PLAYRA — QUIZ EDITOR SYSTEM
   ══════════════════════════════════════════ */

import { showToast } from './utils.js';
import { getCurrentUser } from './auth.js';
import { saveQuizToFirestore, startQuiz, getMyQuizzes, deleteQuiz } from './quiz-service.js';
import { generateWithGemini } from './gemini-service.js';
import { TEAM_PRESETS, buildTeamConfig } from './team-battle-service.js';
import { canUseFeature, checkTeamBattleLimit, incrementTeamBattleCount, openUpgradeModal, onPlanChange, getUserPlan, consumeClassicCredit, consumeTeamBattleCredit } from './premium-service.js';
import { initAccountView } from './account-service.js';

let quizQuestions = [];
let activeSlideIndex = 0;
let currentQuizId = null; // Track saved quiz Firestore ID
let activeTeamBattleQuizId = null; // Track which quiz is currently selected for team battle config

function createEmptyQuestion() {
  return { question: '', options: ['', '', '', ''], correctAnswer: -1 };
}

function isQuestionComplete(q) {
  return q.question.trim() !== '' && q.options.every(o => o.trim() !== '') && q.correctAnswer >= 0;
}

export function initQuizEditor() {
  const viewDashHome = document.getElementById('view-dash-home');
  const viewQuizEditor = document.getElementById('view-quiz-editor');
  const viewMyQuizzes = document.getElementById('view-my-quizzes');
  const viewAnalytics = document.getElementById('view-analytics');
  const sidebarDashboard = document.getElementById('sidebar-dashboard');
  const sidebarCreate = document.getElementById('sidebar-create');
  const sidebarMyQuizzes = document.getElementById('sidebar-my-quizzes');
  const sidebarAnalytics = document.getElementById('sidebar-analytics');
  const sidebarAccount = document.getElementById('sidebar-account');
  const btnNewQuiz = document.getElementById('btn-new-quiz');
  const qeBack = document.getElementById('qe-back');
  const qeSlideList = document.getElementById('qe-slide-list');
  const qeEditorInner = document.getElementById('qe-editor-inner');
  const qeProgress = document.getElementById('qe-progress');

  const allViews = [viewDashHome, viewQuizEditor, viewMyQuizzes, viewAnalytics, document.getElementById('view-account')];
  const allSidebarLinks = [sidebarDashboard, sidebarCreate, sidebarMyQuizzes, sidebarAnalytics, sidebarAccount];

  function showView(viewEl, sidebarEl) {
    allViews.forEach(v => { if (v) v.style.display = 'none'; });
    if (viewEl) viewEl.style.display = '';
    allSidebarLinks.forEach(l => { if (l) l.classList.remove('active'); });
    if (sidebarEl) sidebarEl.classList.add('active');
  }

  function showEditorView() { showView(viewQuizEditor, sidebarCreate); }
  function showDashHomeView() { showView(viewDashHome, sidebarDashboard); }
  function showMyQuizzesView() { showView(viewMyQuizzes, sidebarMyQuizzes); loadMyQuizzes(); }
  function showAnalyticsView() { showView(viewAnalytics, sidebarAnalytics); loadAnalytics(); }
  function showAccountView() { showView(document.getElementById('view-account'), sidebarAccount); initAccountView(); }

  async function loadAnalytics() {
    const user = getCurrentUser();
    if (!user) return;
    
    document.getElementById('stat-total-quizzes').textContent = '...';
    document.getElementById('stat-total-participants').textContent = '...';
    document.getElementById('stat-live-sessions').textContent = '...';
    document.getElementById('stat-avg-score').textContent = '...';

    try {
      const quizzes = await getMyQuizzes(user.uid);
      let totalQuizzes = quizzes.length;
      let totalAttempts = 0;
      let liveSessions = 0;
      let totalScore = 0;
      
      quizzes.forEach(q => {
        if (q.status === 'live') liveSessions++;
        if (q.scores) {
          const pIds = Object.keys(q.scores);
          totalAttempts += pIds.length;
          pIds.forEach(id => {
            totalScore += q.scores[id] || 0;
          });
        }
      });
      
      const avgScore = totalAttempts > 0 ? Math.round(totalScore / totalAttempts) : 0;
      
      const totalQuizzesEl = document.getElementById('stat-total-quizzes');
      if(totalQuizzesEl) totalQuizzesEl.textContent = totalQuizzes;
      const totalParticipantsEl = document.getElementById('stat-total-participants');
      if(totalParticipantsEl) totalParticipantsEl.textContent = totalAttempts;
      const liveSessionsEl = document.getElementById('stat-live-sessions');
      if(liveSessionsEl) liveSessionsEl.textContent = liveSessions;
      const avgScoreEl = document.getElementById('stat-avg-score');
      if(avgScoreEl) avgScoreEl.textContent = avgScore;
    } catch (err) {
      console.error('Failed to load analytics:', err);
      showToast('Could not load analytics.', 'error');
    }
  }

  function initNewQuiz() {
    quizQuestions = [createEmptyQuestion()];
    activeSlideIndex = 0;
    currentQuizId = null;
    const titleInput = document.getElementById('qe-quiz-title');
    if (titleInput) titleInput.value = 'Untitled Quiz';
    showEditorView();
    renderSlides();
    renderEditor();
  }

  // Cache for user's quizzes to enable instant filtering/searching
  let cachedQuizzes = [];

  // Wire up sidebar buttons
  if (btnNewQuiz) btnNewQuiz.addEventListener('click', initNewQuiz);
  if (sidebarCreate) sidebarCreate.addEventListener('click', (e) => { e.preventDefault(); initNewQuiz(); });
  if (sidebarDashboard) sidebarDashboard.addEventListener('click', (e) => { e.preventDefault(); showDashHomeView(); });
  if (sidebarMyQuizzes) sidebarMyQuizzes.addEventListener('click', (e) => { e.preventDefault(); showMyQuizzesView(); });
  if (sidebarAnalytics) sidebarAnalytics.addEventListener('click', (e) => { e.preventDefault(); showAnalyticsView(); });
  if (sidebarAccount) sidebarAccount.addEventListener('click', (e) => { e.preventDefault(); showAccountView(); });
  if (qeBack) qeBack.addEventListener('click', showDashHomeView);

  // Wire up View All button on Dashboard
  const btnViewAllQuizzes = document.getElementById('btn-view-all-quizzes');
  if (btnViewAllQuizzes) {
    btnViewAllQuizzes.addEventListener('click', (e) => {
      e.preventDefault();
      showMyQuizzesView();
    });
  }

  // ── Mobile My Quizzes back button → Dashboard home ──
  const mqBackBtn = document.getElementById('mq-back-btn');
  if (mqBackBtn) {
    mqBackBtn.addEventListener('click', () => showDashHomeView());
  }

  // ── Mobile My Quizzes "+ New" quick-create button ──
  const mqMobileCreateBtn = document.getElementById('mq-mobile-create-btn');
  if (mqMobileCreateBtn) {
    mqMobileCreateBtn.addEventListener('click', () => initNewQuiz());
  }

  // Wire up My Quizzes Search and Filters
  const mqSearchInput = document.getElementById('mq-search-input');
  const mqFilterStatus = document.getElementById('mq-filter-status');

  if (mqSearchInput) {
    mqSearchInput.addEventListener('input', renderFilteredQuizzes);
  }
  if (mqFilterStatus) {
    mqFilterStatus.addEventListener('change', renderFilteredQuizzes);
  }

  // ─── My Quizzes loader ───
  async function loadMyQuizzes() {
    const container = document.getElementById('my-quizzes-list');
    if (!container) return;
    const user = getCurrentUser();
    if (!user) {
      container.innerHTML = '<p class="mq-empty">Please log in to see your quizzes.</p>';
      return;
    }
    
    // Reset filters visual state
    if (mqSearchInput) mqSearchInput.value = '';
    if (mqFilterStatus) mqFilterStatus.value = 'all';

    container.innerHTML = '<p class="mq-loading">Loading your quizzes…</p>';
    try {
      cachedQuizzes = await getMyQuizzes(user.uid);
      renderFilteredQuizzes();
    } catch (err) { 
      container.innerHTML = `<p class="mq-empty">Error loading quizzes: ${err.message}</p>`; 
    }
  }

  // ─── Dynamic client-side filtering and rendering ───
  function renderFilteredQuizzes() {
    const container = document.getElementById('my-quizzes-list');
    if (!container) return;

    const queryStr = (mqSearchInput?.value || '').trim().toLowerCase();
    const statusFilter = mqFilterStatus?.value || 'all';

    const filtered = cachedQuizzes.filter(quiz => {
      const matchesSearch = (quiz.title || 'Untitled Quiz').toLowerCase().includes(queryStr);
      const matchesStatus = statusFilter === 'all' || quiz.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
      if (cachedQuizzes.length === 0) {
        container.innerHTML = '<div class="mq-empty"><div class="mq-empty-icon">📝</div><h3>No quizzes yet</h3><p>Create your first quiz to see it here!</p></div>';
      } else {
        container.innerHTML = '<div class="mq-empty"><div class="mq-empty-icon">🔍</div><h3>No matches found</h3><p>Try adjusting your search query or status filter.</p></div>';
      }
      return;
    }

    container.innerHTML = '';
    filtered.forEach(quiz => {
      const card = document.createElement('div');
      card.className = 'mq-card';
      const statusClass = quiz.status === 'live' ? 'mq-status--live' : quiz.status === 'ended' ? 'mq-status--ended' : 'mq-status--draft';
      const qCount = (quiz.questions || []).length;
      const dateStr = quiz.createdAt?.toDate ? quiz.createdAt.toDate().toLocaleDateString() : 'Unknown';
      card.innerHTML = `
        <div class="mq-card-header">
          <h3 class="mq-card-title">${quiz.title || 'Untitled Quiz'}</h3>
          <span class="mq-status ${statusClass}">${quiz.status}</span>
        </div>
        <div class="mq-card-meta">
          <span>📋 ${qCount} question${qCount !== 1 ? 's' : ''}</span>
          <span>📅 ${dateStr}</span>
          ${quiz.quizCode ? `<span>🔑 Code: ${quiz.quizCode}</span>` : ''}
        </div>
        <div class="mq-card-actions">
          ${quiz.status === 'draft' ? `<button class="btn btn--primary btn--sm mq-start-btn" data-id="${quiz.id}">▶ Start Quiz</button>` : ''}
          ${quiz.status === 'live' ? `<button class="btn btn--primary btn--sm mq-lobby-btn" data-id="${quiz.id}" data-code="${quiz.quizCode}">🎯 Go to Lobby</button>` : ''}
          ${quiz.status === 'draft' || quiz.status === 'live' ? `<button class="btn btn--sm mq-team-battle-btn" data-id="${quiz.id}" style="background: linear-gradient(135deg, #f97316, #ef4444); color: #fff; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);">⚔️ Team Battle</button>` : ''}
          ${quiz.status === 'draft' ? `<button class="btn btn--outline btn--sm mq-edit-btn" data-id="${quiz.id}">✏️ Edit</button>` : ''}
          <button class="btn btn--outline btn--sm mq-delete-btn" data-id="${quiz.id}">🗑️ Delete</button>
        </div>`;
      container.appendChild(card);
    });

    // Bind start buttons
    container.querySelectorAll('.mq-start-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.textContent = 'Starting…';
        btn.disabled = true;
        try {
          const quizCode = await startQuiz(btn.dataset.id);
          showToast(`Quiz is live! Code: ${quizCode}`);
          sessionStorage.setItem('playra_lobby_quizId', btn.dataset.id);
          sessionStorage.setItem('playra_lobby_role', 'host');
          window.location.href = `/pages/lobby.html?quizId=${btn.dataset.id}&role=host`;
        } catch (err) { 
          showToast(err.message, 'error'); 
          btn.textContent = '▶ Start Quiz'; 
          btn.disabled = false; 
        }
      });
    });

    // Bind lobby buttons
    container.querySelectorAll('.mq-lobby-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sessionStorage.setItem('playra_lobby_quizId', btn.dataset.id);
        sessionStorage.setItem('playra_lobby_role', 'host');
        window.location.href = `/pages/lobby.html?quizId=${btn.dataset.id}&role=host`;
      });
    });

    // Bind Team Battle buttons
    container.querySelectorAll('.mq-team-battle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!checkTeamBattleLimit()) {
          openUpgradeModal('teamBattle');
          return;
        }
        if (qeTeamPanel) {
          activeTeamBattleQuizId = btn.dataset.id;
          qeTeamPanel.style.display = '';
          renderTeamConfigList();
        }
      });
    });

    // Bind edit buttons
    container.querySelectorAll('.mq-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const quizId = btn.dataset.id;
        const quiz = cachedQuizzes.find(q => q.id === quizId);
        if (quiz) {
          quizQuestions = [...(quiz.questions || [createEmptyQuestion()])];
          activeSlideIndex = 0;
          currentQuizId = quiz.id;
          const titleInput = document.getElementById('qe-quiz-title');
          if (titleInput) titleInput.value = quiz.title || 'Untitled Quiz';
          const timerSelect = document.getElementById('qe-timer');
          if (timerSelect) timerSelect.value = quiz.timer || '20';
          showEditorView();
          renderSlides();
          renderEditor();
          showToast(`Loaded "${quiz.title}" for editing!`);
        }
      });
    });

    // Bind delete buttons
    container.querySelectorAll('.mq-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this quiz permanently?')) return;
        btn.textContent = 'Deleting…';
        try { 
          await deleteQuiz(btn.dataset.id); 
          showToast('Quiz deleted.'); 
          loadMyQuizzes(); 
        } catch (err) { 
          showToast(err.message, 'error'); 
        }
      });
    });
  }

  // ─── Render slide panel ───
  function renderSlides() {
    if (!qeSlideList) return;
    qeSlideList.innerHTML = '';
    quizQuestions.forEach((q, i) => {
      const thumb = document.createElement('div');
      thumb.className = `qe-slide-thumb${i === activeSlideIndex ? ' active' : ''}`;
      thumb.dataset.index = i;
      const complete = isQuestionComplete(q);
      const previewText = q.question.trim() || 'Empty question…';
      const previewClass = q.question.trim() ? '' : ' empty';
      thumb.innerHTML = `
        <div class="qe-slide-num">Q${i + 1}</div>
        <div class="qe-slide-preview${previewClass}">${previewText}</div>
        <button class="qe-slide-delete" data-index="${i}" title="Delete">✕</button>
        <div class="qe-slide-status${complete ? ' complete' : ''}"></div>`;
      thumb.addEventListener('click', (e) => {
        if (e.target.closest('.qe-slide-delete')) return;
        saveCurrentSlide();
        activeSlideIndex = i;
        renderSlides();
        renderEditor();
      });
      qeSlideList.appendChild(thumb);
    });
    qeSlideList.querySelectorAll('.qe-slide-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        if (quizQuestions.length <= 1) { showToast('You need at least one question.', 'error'); return; }
        quizQuestions.splice(idx, 1);
        if (activeSlideIndex >= quizQuestions.length) activeSlideIndex = quizQuestions.length - 1;
        if (activeSlideIndex < 0) activeSlideIndex = 0;
        renderSlides();
        renderEditor();
      });
    });
    updateProgress();
  }

  // ─── Render question editor ───
  function renderEditor() {
    if (!qeEditorInner) return;
    const q = quizQuestions[activeSlideIndex];
    if (!q) return;
    const letters = ['A', 'B', 'C', 'D'];
    qeEditorInner.innerHTML = `
      <div class="qe-field">
        <label class="qe-question-label"><span>Question</span><span class="qe-q-number">Q${activeSlideIndex + 1}</span></label>
        <textarea class="qe-question-input" id="qe-q-text" placeholder="Type your question here…">${q.question}</textarea>
      </div>
      <div class="qe-field">
        <label>Answer Options</label>
        <div class="qe-options-grid">
          ${q.options.map((opt, oi) => `
            <div class="qe-option${q.correctAnswer === oi ? ' correct-selected' : ''}">
              <div class="qe-option-letter">${letters[oi]}</div>
              <input type="text" value="${opt}" placeholder="Option ${letters[oi]}" data-opt="${oi}" class="qe-opt-input" />
              <div class="qe-option-radio">
                <input type="radio" name="qe-correct" value="${oi}" ${q.correctAnswer === oi ? 'checked' : ''} title="Mark as correct" />
              </div>
            </div>`).join('')}
        </div>
        <p class="qe-correct-hint">Click the radio button to mark the correct answer</p>
      </div>`;
    qeEditorInner.style.animation = 'none';
    qeEditorInner.offsetHeight;
    qeEditorInner.style.animation = '';
    const qText = document.getElementById('qe-q-text');
    if (qText) { qText.addEventListener('input', () => { quizQuestions[activeSlideIndex].question = qText.value; updateSlidePreview(activeSlideIndex); }); }
    qeEditorInner.querySelectorAll('.qe-opt-input').forEach(inp => {
      inp.addEventListener('input', () => { quizQuestions[activeSlideIndex].options[parseInt(inp.dataset.opt)] = inp.value; updateSlideStatus(activeSlideIndex); });
    });
    qeEditorInner.querySelectorAll('input[name="qe-correct"]').forEach(radio => {
      radio.addEventListener('change', () => {
        quizQuestions[activeSlideIndex].correctAnswer = parseInt(radio.value);
        qeEditorInner.querySelectorAll('.qe-option').forEach((el, i) => { el.classList.toggle('correct-selected', i === parseInt(radio.value)); });
        updateSlideStatus(activeSlideIndex);
      });
    });
  }

  function saveCurrentSlide() { /* auto-saved via input events */ }

  function updateSlidePreview(index) {
    const thumb = qeSlideList?.querySelector(`[data-index="${index}"]`);
    if (!thumb) return;
    const preview = thumb.querySelector('.qe-slide-preview');
    const q = quizQuestions[index];
    if (preview) { preview.textContent = q.question.trim() || 'Empty question…'; preview.className = `qe-slide-preview${q.question.trim() ? '' : ' empty'}`; }
    updateSlideStatus(index);
  }

  function updateSlideStatus(index) {
    const thumb = qeSlideList?.querySelector(`[data-index="${index}"]`);
    if (!thumb) return;
    const status = thumb.querySelector('.qe-slide-status');
    if (status) status.className = `qe-slide-status${isQuestionComplete(quizQuestions[index]) ? ' complete' : ''}`;
    updateProgress();
  }

  function updateProgress() {
    if (qeProgress) {
      const total = quizQuestions.length;
      const completed = quizQuestions.filter(isQuestionComplete).length;
      qeProgress.textContent = `Question ${activeSlideIndex + 1} of ${total} · ${completed} completed`;
    }
  }

  // ─── Add slide ───
  const qeAddSlide = document.getElementById('qe-add-slide');
  if (qeAddSlide) {
    qeAddSlide.addEventListener('click', () => {
      saveCurrentSlide();
      quizQuestions.push(createEmptyQuestion());
      activeSlideIndex = quizQuestions.length - 1;
      renderSlides();
      renderEditor();
    });
  }

  // ─── Save Quiz (Firestore) ───
  const btnSaveQuiz = document.getElementById('btn-save-quiz');
  if (btnSaveQuiz) {
    btnSaveQuiz.addEventListener('click', async () => {
      saveCurrentSlide();
      const title = document.getElementById('qe-quiz-title')?.value || 'Untitled Quiz';
      const timer = document.getElementById('qe-timer')?.value || '20';
      const completed = quizQuestions.filter(isQuestionComplete).length;
      if (completed === 0) { showToast('Please complete at least one question before saving.', 'error'); return; }
      const user = getCurrentUser();
      if (!user) { showToast('Please log in to save quizzes.', 'error'); return; }

      const quizData = { title, timer: parseInt(timer), questions: quizQuestions };
      const originalHTML = btnSaveQuiz.innerHTML;
      btnSaveQuiz.innerHTML = '💾 Saving…';
      btnSaveQuiz.disabled = true;

      try {
        console.log('[Editor] Save clicked. currentQuizId:', currentQuizId, 'user:', user.uid);
        currentQuizId = await saveQuizToFirestore(user.uid, quizData, currentQuizId);
        console.log('[Editor] Save complete. quizId:', currentQuizId);
        showToast(`Quiz "${title}" saved with ${completed} question${completed > 1 ? 's' : ''}!`);
      } catch (err) {
        console.error('[Editor] Save FAILED:', err);
        showToast(`Save failed: ${err.message}`, 'error');
      } finally {
        btnSaveQuiz.innerHTML = originalHTML;
        btnSaveQuiz.disabled = false;
      }
    });
  }

  // ─── Start Quiz ───
  const btnStartQuiz = document.getElementById('btn-start-quiz');
  if (btnStartQuiz) {
    btnStartQuiz.addEventListener('click', async () => {
      saveCurrentSlide();
      const title = document.getElementById('qe-quiz-title')?.value || 'Untitled Quiz';
      const timer = document.getElementById('qe-timer')?.value || '20';
      const completed = quizQuestions.filter(isQuestionComplete).length;
      if (completed === 0) { showToast('Please complete at least one question.', 'error'); return; }
      const user = getCurrentUser();
      if (!user) { showToast('Please log in first.', 'error'); return; }

      const originalHTML = btnStartQuiz.innerHTML;
      btnStartQuiz.innerHTML = '⏳ Starting…';
      btnStartQuiz.disabled = true;

      try {
        // Step 1: Save first if not already saved
        if (!currentQuizId) {
          console.log('[Editor] No quizId yet — saving first...');
          const quizData = { title, timer: parseInt(timer), questions: quizQuestions };
          currentQuizId = await saveQuizToFirestore(user.uid, quizData);
          console.log('[Editor] Saved. Got quizId:', currentQuizId);
        }

        // Step 2: Guard — quizId must exist
        if (!currentQuizId) {
          throw new Error('Failed to obtain quiz ID after save.');
        }

        // Step 3: Start the quiz (sequential, not parallel)
        console.log('[Editor] Starting quiz with ID:', currentQuizId);
        const quizCode = await startQuiz(currentQuizId);
        console.log('[Editor] Quiz started! Code:', quizCode);

        // Consume a Classic credit for Premium Pass users
        const planNow = getUserPlan();
        if (planNow?.plan === 'premiumPass') {
          await consumeClassicCredit();
        }

        showToast(`Quiz is live! Code: ${quizCode}`);
        sessionStorage.setItem('playra_lobby_quizId', currentQuizId);
        sessionStorage.setItem('playra_lobby_role', 'host');
        window.location.href = `/pages/lobby.html?quizId=${currentQuizId}&role=host`;
      } catch (err) {
        console.error('[Editor] Start FAILED:', err);
        showToast(`Start failed: ${err.message}`, 'error');
      } finally {
        btnStartQuiz.innerHTML = originalHTML;
        btnStartQuiz.disabled = false;
      }
    });
  }

  // ─── GEMINI QUESTION GENERATOR ───
  const qeAiBtn = document.getElementById('qe-ai-btn');
  const qeAiPanel = document.getElementById('qe-ai-panel');
  const qeAiClose = document.getElementById('qe-ai-close');
  const qeAiGenerate = document.getElementById('qe-ai-generate');

  // ── Apply premium lock visual to AI button ──
  function applyAiPremiumLock() {
    if (!qeAiBtn) return;
    // Clean up any existing lock state
    qeAiBtn.classList.remove('premium-locked-btn');
    const oldTag = qeAiBtn.querySelector('.premium-lock-tag');
    if (oldTag) oldTag.remove();

    if (!canUseFeature('aiGeneration')) {
      qeAiBtn.classList.add('premium-locked-btn');
      const tag = document.createElement('span');
      tag.className = 'premium-lock-tag';
      tag.textContent = '🔒 Premium';
      qeAiBtn.appendChild(tag);
    }
  }

  applyAiPremiumLock();
  // Re-apply whenever the premium plan loads or changes (async Firestore init)
  onPlanChange(() => applyAiPremiumLock());

  if (qeAiBtn) qeAiBtn.addEventListener('click', () => {
    if (!canUseFeature('aiGeneration')) {
      openUpgradeModal('ai');
      return;
    }
    if (qeAiPanel) qeAiPanel.style.display = '';
  });
  if (qeAiClose) qeAiClose.addEventListener('click', () => { if (qeAiPanel) qeAiPanel.style.display = 'none'; });

  document.querySelectorAll('.qe-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qe-diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ─── TEAM BATTLE CONFIG PANEL ───
  const qeTeamPanel = document.getElementById('qe-team-panel');
  const qeTeamClose = document.getElementById('qe-team-close');
  const btnStartTeamBattle = document.getElementById('btn-start-team-battle');
  const teamNumTeams = document.getElementById('team-num-teams');
  const teamConfigList = document.getElementById('team-config-list');
  const qeTeamStart = document.getElementById('qe-team-start');

  function renderTeamConfigList() {
    if (!teamConfigList || !teamNumTeams) return;
    const num = parseInt(teamNumTeams.value);
    teamConfigList.innerHTML = '';
    for (let i = 0; i < num; i++) {
      const preset = TEAM_PRESETS[i];
      const row = document.createElement('div');
      row.className = 'team-config-row';
      row.innerHTML = `
        <span class="team-config-color" style="background:${preset.color};">${preset.emoji}</span>
        <input type="text" class="team-config-name" data-team-id="${preset.id}" value="${preset.name}" placeholder="Team ${i + 1}" />`;
      teamConfigList.appendChild(row);
    }
  }

  if (teamNumTeams) {
    teamNumTeams.addEventListener('change', renderTeamConfigList);
    renderTeamConfigList(); // initial render
  }

  if (btnStartTeamBattle) {
    btnStartTeamBattle.addEventListener('click', () => {
      if (!checkTeamBattleLimit()) {
        openUpgradeModal('teamBattle');
        return;
      }
      if (qeTeamPanel) {
        activeTeamBattleQuizId = null; // Use current editor state
        qeTeamPanel.style.display = '';
        renderTeamConfigList();
      }
    });
  }

  if (qeTeamClose) {
    qeTeamClose.addEventListener('click', () => {
      if (qeTeamPanel) qeTeamPanel.style.display = 'none';
    });
  }

  if (qeTeamStart) {
    qeTeamStart.addEventListener('click', async () => {
      const user = getCurrentUser();
      if (!user) { showToast('Please log in first.', 'error'); return; }

      const numTeams = parseInt(teamNumTeams?.value || '2');
      const maxPerTeam = parseInt(document.getElementById('team-max-members')?.value || '5');

      // Collect custom team names
      const customNames = {};
      teamConfigList?.querySelectorAll('.team-config-name').forEach(inp => {
        customNames[inp.dataset.teamId] = inp.value.trim();
      });

      const teamConfig = buildTeamConfig(numTeams, maxPerTeam, customNames);

      const originalHTML = qeTeamStart.innerHTML;
      qeTeamStart.innerHTML = '⏳ Starting…';
      qeTeamStart.disabled = true;

      try {
        let quizIdToStart = activeTeamBattleQuizId;

        if (!quizIdToStart) {
          // Started from editor — validate and save current slide/quiz first
          saveCurrentSlide();
          const title = document.getElementById('qe-quiz-title')?.value || 'Untitled Quiz';
          const timer = document.getElementById('qe-timer')?.value || '20';
          const completed = quizQuestions.filter(isQuestionComplete).length;
          if (completed === 0) { showToast('Please complete at least one question.', 'error'); return; }

          if (!currentQuizId) {
            const quizData = { title, timer: parseInt(timer), questions: quizQuestions };
            currentQuizId = await saveQuizToFirestore(user.uid, quizData);
          }
          quizIdToStart = currentQuizId;
        }

        if (!quizIdToStart) throw new Error('Failed to obtain quiz ID.');

        // Start as team mode
        const quizCode = await startQuiz(quizIdToStart, 'team', teamConfig);
        showToast(`⚔️ Team Battle is live! Code: ${quizCode}`);

        // Consume the right credit based on plan
        const planNow = getUserPlan();
        if (planNow?.plan === 'premiumPass') {
          await consumeTeamBattleCredit();
        } else {
          await incrementTeamBattleCount(); // free-user counter
        }

        // Hide team panel
        if (qeTeamPanel) qeTeamPanel.style.display = 'none';

        sessionStorage.setItem('playra_lobby_quizId', quizIdToStart);
        sessionStorage.setItem('playra_lobby_role', 'host');
        sessionStorage.setItem('playra_lobby_mode', 'team');
        window.location.href = `/pages/lobby.html?quizId=${quizIdToStart}&role=host&mode=team`;
      } catch (err) {
        console.error('[Editor] Team Battle start FAILED:', err);
        showToast(`Start failed: ${err.message}`, 'error');
      } finally {
        qeTeamStart.innerHTML = originalHTML;
        qeTeamStart.disabled = false;
      }
    });
  }

  // ── Synchronous in-progress guard ──
  // Prevents a second call being queued between the click event and the first
  // await (the window where `disabled` hasn't yet taken effect in the browser).
  let _aiPending = false;

  if (qeAiGenerate) {
    qeAiGenerate.addEventListener('click', async () => {
      if (_aiPending) return; // drop duplicate clicks

      const topic      = document.getElementById('ai-topic')?.value.trim();
      const count      = parseInt(document.getElementById('ai-count')?.value || '5');
      const difficulty = document.querySelector('.qe-diff-btn.active')?.dataset.diff || 'medium';

      if (!topic) { showToast('Please enter a topic.', 'error'); return; }

      // ── Lock ──
      _aiPending = true;
      const originalHTML = qeAiGenerate.innerHTML;
      qeAiGenerate.disabled = true;
      qeAiGenerate.classList.add('generating');
      qeAiGenerate.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;" class="gemini-spinner">
          <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.9 2-2 2h-4a2 2 0 0 1-2-2 4 4 0 0 1 4-4z"/>
          <path d="M8 8v2a4 4 0 0 0 8 0V8"/>
          <rect x="5" y="14" width="14" height="8" rx="2"/>
        </svg>
        Generating with Gemini…`;

      try {
        const generated = await generateWithGemini(topic, difficulty, count);

        if (!generated || generated.length === 0) {
          showToast('Gemini returned no questions. Please try again.', 'error');
          return;
        }

        // ── Auto-fill into quiz editor ──
        saveCurrentSlide();
        if (
          quizQuestions.length === 1 &&
          !isQuestionComplete(quizQuestions[0]) &&
          quizQuestions[0].question.trim() === ''
        ) {
          quizQuestions = [];
        }

        generated.forEach(q => {
          quizQuestions.push({
            question:      q.question,
            options:       [...q.options],
            correctAnswer: q.correctAnswer,
          });
        });

        activeSlideIndex = quizQuestions.length > 0 ? quizQuestions.length - generated.length : 0;
        renderSlides();
        renderEditor();

        if (qeAiPanel) qeAiPanel.style.display = 'none';
        showToast(`✨ Generated ${generated.length} ${difficulty} questions on "${topic}" with Gemini!`);
      } catch (err) {
        console.error('[Gemini] Generation failed:', err);
        showToast(err.message || 'Failed to generate questions. Check your API key.', 'error');
      } finally {
        // ── Unlock — always runs, even on error ──
        _aiPending = false;
        qeAiGenerate.disabled = false;
        qeAiGenerate.classList.remove('generating');
        qeAiGenerate.innerHTML = originalHTML;
      }
    });
  }
}
