/* ══════════════════════════════════════════
   PLAYRA — JOIN QUIZ SYSTEM (Firebase)
   ══════════════════════════════════════════ */

import {
  showToast, openModal, closeModal, closeAllModals,
  showFormError, clearFormErrors
} from './utils.js';
import { findLiveQuizByCode, joinQuiz } from './quiz-service.js';

export function initJoinQuiz() {
  const btnJoinQuiz = document.getElementById('btn-join-quiz');
  const btnTeamBattle = document.getElementById('btn-team-battle');
  const jqClassicBtn = document.getElementById('jq-classic-btn');
  const jqTeamBtn = document.getElementById('jq-team-btn');

  if (btnJoinQuiz) {
    btnJoinQuiz.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.maintenanceModeActive) {
        showToast('Playra is currently undergoing maintenance. Joining quizzes is temporarily disabled.', 'error');
        return;
      }
      openModal('overlay-join-quiz');
    });
  }

  // Team Battle button — opens join quiz modal (team mode is selected inside)
  if (btnTeamBattle) {
    btnTeamBattle.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.maintenanceModeActive) {
        showToast('Playra is currently undergoing maintenance. Team battles are temporarily disabled.', 'error');
        return;
      }
      openModal('overlay-join-quiz');
    });
  }

  const closeJoinQuiz = document.getElementById('close-join-quiz');
  if (closeJoinQuiz) closeJoinQuiz.addEventListener('click', () => closeModal('overlay-join-quiz'));

  const jqScanBtn = document.getElementById('jq-scan-btn');
  if (jqScanBtn) {
    jqScanBtn.addEventListener('click', () => {
      showToast('📷 QR Scanner coming soon! Enter the code manually for now.', 'error');
    });
  }

  async function handleJoinSubmit(e, mode) {
    e.preventDefault();
    const name = document.getElementById('jq-name').value.trim();
    const code = document.getElementById('jq-code').value.trim();
    const errorId = 'jq-error';
    const inputIds = ['jq-name', 'jq-code'];

    clearFormErrors(errorId, inputIds);

    if (!name) { showFormError(errorId, 'Name is required.', ['jq-name']); return; }
    if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) {
      showFormError(errorId, 'Invalid Quiz Code. Please enter a 4-digit code.', ['jq-code']);
      return;
    }

    // Team mode validation — quiz must be in team mode
    if (mode === 'team') {
      // Team selection happens in the lobby after joining
      console.log('[JoinQuiz] Joining in team mode');
    }

    const btn = mode === 'team' ? jqTeamBtn : jqClassicBtn;
    const original = btn.innerHTML;
    btn.classList.add('loading');
    btn.innerHTML = '<span></span> Joining…';

    try {
      const quiz = await findLiveQuizByCode(code);
      if (!quiz) {
        btn.classList.remove('loading');
        btn.innerHTML = original;
        showFormError(errorId, 'Quiz not found or not live. Please check your code.', ['jq-code']);
        return;
      }

      const participantId = await joinQuiz(quiz.id, name);

      sessionStorage.setItem('playra_lobby_quizId', quiz.id);
      sessionStorage.setItem('playra_lobby_name', name);
      sessionStorage.setItem('playra_lobby_role', 'player');
      sessionStorage.setItem('playra_lobby_participantId', participantId);
      sessionStorage.setItem('playra_lobby_mode', mode);

      btn.classList.remove('loading');
      btn.innerHTML = original;
      closeAllModals();
      showToast(`Joined quiz ${code} as ${name}!`);
      window.location.href = `/pages/lobby.html?quizId=${quiz.id}&name=${encodeURIComponent(name)}&role=player&mode=${mode}`;
    } catch (err) {
      btn.classList.remove('loading');
      btn.innerHTML = original;
      showFormError(errorId, err.message || 'Failed to join quiz. Please try again.', []);
    }
  }

  if (jqClassicBtn) jqClassicBtn.addEventListener('click', (e) => handleJoinSubmit(e, 'classic'));
  if (jqTeamBtn) jqTeamBtn.addEventListener('click', (e) => handleJoinSubmit(e, 'team'));

  const formJoinQuiz = document.getElementById('form-join-quiz');
  if (formJoinQuiz) formJoinQuiz.addEventListener('submit', (e) => e.preventDefault());

  // Auto-clear join quiz errors on focus
  document.querySelectorAll('#form-join-quiz input').forEach(input => {
    input.addEventListener('focus', () => {
      const errorDiv = document.getElementById('jq-error');
      if (errorDiv) { errorDiv.textContent = ''; errorDiv.classList.remove('visible'); }
      document.querySelectorAll('#form-join-quiz .input-error').forEach(w => w.classList.remove('input-error'));
    });
  });
}
