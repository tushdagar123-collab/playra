/* ══════════════════════════════════════════
   PLAYRA — LOBBY PAGE (Firebase Real-Time)
   State-driven: UI depends only on Firebase.
   ══════════════════════════════════════════ */

import '../css/global.css';
import '../css/navbar.css';
import '../css/lobby.css';
import '../css/team-battle.css';
import '../css/responsive.css';
import '../css/premium.css';

import { showToast } from './utils.js';
import {
  listenToParticipants,
  listenToQuizStatus,
  getQuiz,
  startGameFromLobby,
  showAnswerForQuestion,
  nextQuestion,
  submitAnswer,
  removeParticipant,
  showLeaderboard
} from './quiz-service.js';
import { buildTeamLeaderboard, getTeamCounts } from './team-battle-service.js';
import { renderTeamSelection } from './team-select.js';
import { openResultsModal, closeResultsModal, downloadResultsPDF } from './quiz-results.js';
import { canUseFeature, checkParticipantLimit, openUpgradeModal, isPremium, initPremium, applyPremiumBadge, initUpgradeModalBindings, onPlanChange } from './premium-service.js';
import { auth } from './firebase-config.js';

const AVATAR_COLORS = [
  '#635bff', '#00d4aa', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1'
];

function getAvatarColor(n) {
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(n) {
  return n.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize premium upgrade modal bindings (close, overlay click, ESC)
  initUpgradeModalBindings();

  const params = new URLSearchParams(window.location.search);
  const quizId = params.get('quizId') || sessionStorage.getItem('playra_lobby_quizId');
  const role = params.get('role') || sessionStorage.getItem('playra_lobby_role') || 'player';
  const playerName = params.get('name') || sessionStorage.getItem('playra_lobby_name') || 'Player';
  const participantId = sessionStorage.getItem('playra_lobby_participantId') || null;

  // ── DOM References ──
  const lobbyCode = document.getElementById('lobby-code');
  const lobbyPlayerName = document.getElementById('lobby-player-name');
  const lobbyMode = document.getElementById('lobby-mode');
  const lobbyTitle = document.getElementById('lobby-quiz-title');
  const lobbyStatus = document.getElementById('lobby-status');
  const list = document.getElementById('lobby-participants-list');
  const countEl = document.getElementById('lobby-count');
  const hostControls = document.getElementById('lobby-host-controls');
  
  // Host Buttons
  const btnStartGame = document.getElementById('btn-start-game');
  const btnShowAnswer = document.getElementById('btn-show-answer');
  const btnShowLeaderboard = document.getElementById('btn-show-leaderboard');
  const btnNextQuestion = document.getElementById('btn-next-question');
  
  const waitingState = document.getElementById('lobby-waiting-state');

  // Screens
  const screenWaiting = document.getElementById('screen-waiting');
  const screenPlay = document.getElementById('screen-play');
  const screenLeaderboard = document.getElementById('screen-leaderboard');
  const screenEnded = document.getElementById('screen-ended');
  const screenTeamSelect = document.getElementById('screen-team-select');
  const screenTeamLeaderboard = document.getElementById('screen-team-leaderboard');
  const screenTeamEnded = document.getElementById('screen-team-ended');

  // Player Controls
  const btnSubmitAnswer = document.getElementById('btn-submit-answer');

  // Track local state
  let currentParticipants = [];
  let hasSubmittedAnswer = false;
  let selectedOptionIndex = null;
  let isTimeUp = false;
  let currentQIndex = -1;
  let questionInterval = null;
  let lastQuizData = null;
  let currentTeamId = sessionStorage.getItem('playra_lobby_teamId') || null;
  let isTeamMode = false;

  if (!quizId) {
    showToast('No quiz ID found. Redirecting…', 'error');
    setTimeout(() => window.location.href = '/', 1500);
    return;
  }

  // ─── Role-based initial setup ───
  if (role === 'host') {
    if (hostControls) hostControls.style.display = '';
    if (waitingState) waitingState.style.display = 'none';
    if (lobbyPlayerName) lobbyPlayerName.textContent = 'Host';

    // Show the premium badge slot and load host's premium plan
    const lobbyBadgeSlot = document.getElementById('lobby-premium-badge');
    const resultsBadgeSlot = document.getElementById('results-premium-badge');
    if (lobbyBadgeSlot) lobbyBadgeSlot.style.display = '';
    if (resultsBadgeSlot) resultsBadgeSlot.style.display = '';

    // Wait for Firebase auth to resolve the current host user, then init premium
    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      unsubAuth(); // one-shot: unsubscribe immediately
      if (user) {
        await initPremium(user.uid);
        applyPremiumBadge();
      }
    });
  } else {
    if (hostControls) hostControls.style.display = 'none';
    if (waitingState) waitingState.style.display = '';
    if (lobbyPlayerName) lobbyPlayerName.textContent = playerName;
  }

  // ─── Load quiz info ───
  try {
    const quiz = await getQuiz(quizId);
    if (quiz) {
      if (lobbyCode) lobbyCode.textContent = quiz.quizCode || '----';
      if (lobbyTitle) lobbyTitle.textContent = quiz.title || 'Quiz';
      if (lobbyMode) lobbyMode.textContent = '🎯 Live Quiz';
    }
  } catch (err) {
    console.error('Failed to load quiz:', err);
  }

  // ══════════════════════════════════════════
  //  TIMER LOGIC
  // ══════════════════════════════════════════

  function startTimer(startTimeMillis, durationSecs, onComplete) {
    clearInterval(questionInterval);
    const gameTimerEl = document.getElementById('game-timer');
    
    function update() {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeMillis) / 1000);
      let remaining = durationSecs - elapsed;
      if (remaining < 0) remaining = 0;
      
      if (gameTimerEl) gameTimerEl.textContent = `${remaining}s`;
      
      if (remaining <= 0) {
        clearInterval(questionInterval);
        onComplete();
      }
    }
    
    update();
    questionInterval = setInterval(update, 1000);
  }

  // ══════════════════════════════════════════
  //  SCREEN SWITCHING
  // ══════════════════════════════════════════

  function showScreen(screenId) {
    [screenWaiting, screenPlay, screenLeaderboard, screenEnded, screenTeamSelect, screenTeamLeaderboard, screenTeamEnded].forEach(s => {
      if (s) s.style.display = 'none';
    });
    const screen = document.getElementById(screenId);
    if (screen) screen.style.display = '';
  }

  // ══════════════════════════════════════════
  //  HOST CONTROL BUTTON VISIBILITY
  // ══════════════════════════════════════════

  function updateHostButtons(gameStatus) {
    if (role !== 'host') return;
    if (!hostControls) return;

    hostControls.style.display = '';
    btnStartGame.style.display = 'none';
    btnShowAnswer.style.display = 'none';
    if (btnShowLeaderboard) btnShowLeaderboard.style.display = 'none';
    btnNextQuestion.style.display = 'none';

    switch (gameStatus) {
      case 'waiting':
        btnStartGame.style.display = '';
        // In team mode, disable Start until all players have a team
        if (isTeamMode && currentParticipants.length > 0) {
          const unassigned = currentParticipants.filter(p => !p.teamId);
          btnStartGame.disabled = unassigned.length > 0;
          btnStartGame.title = unassigned.length > 0
            ? `${unassigned.length} player(s) haven't joined a team yet`
            : 'Start the team battle!';
        } else {
          btnStartGame.disabled = false;
          btnStartGame.title = '';
        }
        break;
      case 'question':
        btnShowAnswer.style.display = '';
        btnNextQuestion.style.display = '';
        btnNextQuestion.disabled = false; // Host can choose to skip directly
        break;
      case 'results':
        if (btnShowLeaderboard) btnShowLeaderboard.style.display = '';
        btnNextQuestion.style.display = '';
        btnNextQuestion.disabled = false;
        break;
      case 'leaderboard':
        btnNextQuestion.style.display = '';
        btnNextQuestion.disabled = false;
        break;
      case 'ended':
        hostControls.style.display = 'none';
        break;
    }
  }

  // ══════════════════════════════════════════
  //  RENDER: PLAY SCREEN (Question & Results)
  // ══════════════════════════════════════════

  function renderPlay(quizData) {
    const isResults = quizData.gameStatus === 'results';
    const index = quizData.currentQuestionIndex || 0;
    const questions = quizData.questions || [];
    const question = questions[index];
    if (!question) return;

    const qNumber = document.getElementById('game-q-number');
    const qOf = document.getElementById('game-q-of');
    const qText = document.getElementById('game-question-text');
    const optionsContainer = document.getElementById('game-options');
    const submitContainer = document.getElementById('game-submit-container');
    const answerStatus = document.getElementById('game-answer-status');
    const statsContainer = document.getElementById('game-results-stats');

    if (qNumber) qNumber.textContent = `Q${index + 1}`;
    if (qOf) qOf.textContent = `of ${questions.length}`;
    if (qText) qText.textContent = question.question;

    const answers = quizData.answers || {};
    
    // Check if new question
    if (quizData.currentQuestionIndex !== currentQIndex) {
      currentQIndex = quizData.currentQuestionIndex;
      selectedOptionIndex = null;
      hasSubmittedAnswer = false;
      isTimeUp = false;
    }

    // Check Firebase for participant's answer
    const myAnswerObj = answers[participantId];
    if (role === 'player' && myAnswerObj !== undefined) {
      hasSubmittedAnswer = true;
      selectedOptionIndex = myAnswerObj.selectedOption; // server truth
    }

    // Timer Logic
    if (!isResults && !isTimeUp) {
      const startTime = quizData.questionStartTime;
      let startMillis = Date.now();
      if (startTime && startTime.toMillis) {
        startMillis = startTime.toMillis();
      } else if (typeof startTime === 'number') {
        startMillis = startTime;
      }
      
      const duration = quizData.questionTime || 20;
      
      // Start only if not already running for this question
      if (!questionInterval) {
        startTimer(startMillis, duration, () => {
          isTimeUp = true;
          renderPlay(lastQuizData); // re-render to lock options
        });
      }
    } else {
      clearInterval(questionInterval);
      questionInterval = null;
      if (isResults) {
        const gameTimerEl = document.getElementById('game-timer');
        if (gameTimerEl) gameTimerEl.textContent = '0s';
      }
    }

    // Update host buttons in case isTimeUp changed
    updateHostButtons(quizData.gameStatus);

    // Render Options
    const letters = ['A', 'B', 'C', 'D'];
    const correctIdx = question.correctAnswer;
    
    if (optionsContainer) {
      optionsContainer.innerHTML = '';
      question.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'game-option-btn';
        if (role === 'host') btn.classList.add('game-option-host');

        if (isResults) {
          if (i === correctIdx) {
            btn.classList.add('game-option-correct');
          } else {
            btn.classList.add('game-option-wrong');
            if (role === 'player' && selectedOptionIndex !== i) {
              btn.classList.add('game-option-faded');
            } else if (role === 'host') {
              btn.classList.add('game-option-faded');
            }
          }
        } else {
          if (selectedOptionIndex === i) {
            btn.classList.add('game-option-selected');
          }
          if (role === 'player' && !hasSubmittedAnswer && !isTimeUp) {
            btn.addEventListener('click', () => {
              selectedOptionIndex = i;
              renderPlay(lastQuizData);
            });
          }
        }

        btn.innerHTML = `<span class="game-option-letter">${letters[i]}</span><span class="game-option-text">${opt}</span>`;
        optionsContainer.appendChild(btn);
      });
    }

    // Submit Button logic
    if (role === 'player') {
      if (isResults) {
        if (submitContainer) submitContainer.style.display = 'none';
      } else {
        if (submitContainer) {
          submitContainer.style.display = 'flex';
          btnSubmitAnswer.disabled = (selectedOptionIndex === null || hasSubmittedAnswer || isTimeUp);
          if (hasSubmittedAnswer) {
            btnSubmitAnswer.textContent = 'Submitted';
          } else {
            btnSubmitAnswer.textContent = 'Submit Answer';
          }
        }
      }
    }

    // Feedback & Stats
    if (isResults) {
      if (answerStatus) answerStatus.style.display = 'none';
      if (statsContainer) {
        statsContainer.style.display = '';
        const counts = [0, 0, 0, 0];
        const total = Object.keys(answers).length || 1;
        for (const ansObj of Object.values(answers)) {
          if (ansObj.selectedOption >= 0 && ansObj.selectedOption < 4) counts[ansObj.selectedOption]++;
        }
        statsContainer.innerHTML = counts.map((c, i) => {
          const pct = Math.round((c / total) * 100);
          const isCorrect = i === correctIdx;
          return `<div class="game-results-stat ${isCorrect ? 'game-results-stat--correct' : ''}">
            <span class="game-results-stat-letter">${letters[i]}</span>
            <div class="game-results-stat-bar"><div class="game-results-stat-fill" style="width:${pct}%"></div></div>
            <span class="game-results-stat-count">${c}</span>
          </div>`;
        }).join('');
      }
    } else {
      if (statsContainer) statsContainer.style.display = 'none';
      
      if (role === 'host') {
        const answerCount = Object.keys(answers).length;
        const totalPlayers = currentParticipants.length;
        if (answerStatus) {
          answerStatus.style.display = '';
          const icon = answerStatus.querySelector('.game-answer-icon');
          const msg = answerStatus.querySelector('.game-answer-msg');
          if (icon) icon.textContent = '📊';
          if (msg) msg.textContent = `${answerCount} / ${totalPlayers} answered`;
        }
      } else if (hasSubmittedAnswer) {
        if (answerStatus) {
          answerStatus.style.display = '';
          const icon = answerStatus.querySelector('.game-answer-icon');
          const msg = answerStatus.querySelector('.game-answer-msg');
          if (icon) icon.textContent = '✓';
          if (msg) msg.textContent = 'Answer submitted!';
        }
      } else {
        if (answerStatus) answerStatus.style.display = 'none';
      }
    }
  }

  // ══════════════════════════════════════════
  //  RENDER: LEADERBOARD CHART
  // ══════════════════════════════════════════

  function renderLeaderboard(quizData) {
    const leaderboard = document.getElementById('game-leaderboard-chart');
    if (!leaderboard) return;
    
    const scores = quizData.scores || {};
    let entries = currentParticipants.map(p => ({
        name: p.name,
        score: scores[p.id] || 0
    }));
    
    // Sort descending
    entries.sort((a, b) => b.score - a.score);
    
    // Take top 5 for bar chart
    const topEntries = entries.slice(0, 5);
    const maxScore = Math.max(...topEntries.map(e => e.score), 10); // avoid div by 0
    
    if (topEntries.length === 0) {
      leaderboard.innerHTML = '<p style="color:var(--color-text-secondary); align-self:center;">No participants yet.</p>';
      return;
    }

    leaderboard.innerHTML = topEntries.map((e, i) => {
        const heightPct = Math.max((e.score / maxScore) * 100, 5); // min 5% height
        const color = getAvatarColor(e.name);
        return `
        <div class="game-lb-bar-container">
            <div class="game-lb-bar" style="height: ${heightPct}%; background: ${color};">
                <span class="game-lb-bar-score">${e.score}</span>
            </div>
            <span class="game-lb-bar-name" title="${e.name}">${e.name}</span>
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════
  //  RENDER: ENDED SCREEN
  // ══════════════════════════════════════════

  function renderEnded(quizData) {
    // If team mode, use team ended screen
    if (quizData.gameMode === 'team') {
      renderTeamEnded(quizData);
      return;
    }

    const leaderboard = document.getElementById('game-leaderboard');
    if (leaderboard) {
      const scores = quizData.scores || {};
      const entries = currentParticipants.map(p => ({
        name: p.name,
        score: scores[p.id] || 0
      }));
      entries.sort((a, b) => b.score - a.score);

      if (entries.length === 0) {
        leaderboard.innerHTML = '<p class="game-leaderboard-empty">No participants to show.</p>';
      } else {
        leaderboard.innerHTML = entries.map((e, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
          const color = getAvatarColor(e.name);
          const initials = getInitials(e.name);
          return `<div class="game-leaderboard-row ${i < 3 ? 'game-leaderboard-row--top' : ''}">
            <span class="game-leaderboard-rank">${medal}</span>
            <div class="lobby-participant-avatar" style="background:${color};">${initials}</div>
            <span class="game-leaderboard-name">${e.name}</span>
            <span class="game-leaderboard-score">${e.score} pts</span>
          </div>`;
        }).join('');
      }
    }
  }

  // ══════════════════════════════════════════
  //  RENDER: TEAM LEADERBOARD
  // ══════════════════════════════════════════

  function renderTeamLeaderboard(quizData) {
    const chartEl = document.getElementById('team-lb-chart');
    const detailsEl = document.getElementById('team-lb-details');
    if (!chartEl) return;

    const teamLB = buildTeamLeaderboard(currentParticipants, quizData.scores || {}, quizData.teamConfig);
    const maxScore = Math.max(...teamLB.map(t => t.totalScore), 10);

    chartEl.innerHTML = teamLB.map(t => {
      const heightPct = Math.max((t.totalScore / maxScore) * 100, 5);
      return `
        <div class="game-lb-bar-container">
          <div class="game-lb-bar" style="height: ${heightPct}%; background: ${t.color};">
            <span class="game-lb-bar-score">${t.totalScore}</span>
          </div>
          <span class="game-lb-bar-name" title="${t.name}">${t.emoji} ${t.name}</span>
        </div>`;
    }).join('');

    if (detailsEl) {
      detailsEl.innerHTML = teamLB.map(t => {
        const topPlayer = t.members[0];
        if (!topPlayer) return '';
        return `
          <div class="team-lb-detail-row">
            <span class="team-lb-detail-color" style="background: ${t.color};"></span>
            <span class="team-lb-detail-name">${t.name}</span>
            <span class="team-lb-detail-mvp">⭐ ${topPlayer.name} (${topPlayer.score} pts)</span>
          </div>`;
      }).join('');
    }
  }

  // ══════════════════════════════════════════
  //  RENDER: TEAM ENDED (Winner + standings)
  // ══════════════════════════════════════════

  function renderTeamEnded(quizData) {
    const teamLB = buildTeamLeaderboard(currentParticipants, quizData.scores || {}, quizData.teamConfig);

    // Winner banner
    const bannerEl = document.getElementById('team-winner-banner');
    if (bannerEl && teamLB.length > 0) {
      const winner = teamLB[0];
      bannerEl.innerHTML = `
        <div class="team-winner-card" style="--team-color: ${winner.color};">
          <div class="team-winner-emoji">${winner.emoji}</div>
          <h3 class="team-winner-name">${winner.name}</h3>
          <div class="team-winner-score">${winner.totalScore} pts</div>
          <div class="team-winner-label">🏆 WINNER!</div>
        </div>`;
    }

    // Final standings
    const standingsEl = document.getElementById('team-final-standings');
    if (standingsEl) {
      standingsEl.innerHTML = teamLB.map((t, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const membersHtml = t.members.slice(0, 3).map(m => 
          `<span class="team-final-player">${m.name}: ${m.score} pts</span>`
        ).join('');

        return `
          <div class="team-final-row ${i === 0 ? 'team-final-row--winner' : ''}">
            <span class="game-leaderboard-rank">${medal}</span>
            <div class="team-final-info">
              <div class="team-final-header">
                <span class="team-final-color" style="background: ${t.color};"></span>
                <span class="team-final-team-name">${t.emoji} ${t.name}</span>
                <span class="game-leaderboard-score">${t.totalScore} pts</span>
              </div>
              <div class="team-final-players">${membersHtml}</div>
            </div>
          </div>`;
      }).join('');
    }
  }

  // ══════════════════════════════════════════
  //  ANSWER SUBMISSION (Player)
  // ══════════════════════════════════════════

  if (btnSubmitAnswer) {
    btnSubmitAnswer.addEventListener('click', () => {
      if (selectedOptionIndex === null || hasSubmittedAnswer || isTimeUp) return;
      hasSubmittedAnswer = true;
      btnSubmitAnswer.textContent = 'Submitted';
      btnSubmitAnswer.disabled = true;
      
      const answerStatus = document.getElementById('game-answer-status');
      if (answerStatus) {
        answerStatus.style.display = '';
        const icon = answerStatus.querySelector('.game-answer-icon');
        const msg = answerStatus.querySelector('.game-answer-msg');
        if (icon) icon.textContent = '✓';
        if (msg) msg.textContent = 'Answer submitted!';
      }
      renderPlay(lastQuizData);

      submitAnswer(quizId, participantId, selectedOptionIndex, currentTeamId).catch(err => {
        console.error('Answer submit failed:', err);
        if (!err?.message?.includes('already submitted')) {
          showToast(err.message || 'Submission failed', 'error');
          hasSubmittedAnswer = false; // allow retry
          renderPlay(lastQuizData);
        }
      });
    });
  }

  // ══════════════════════════════════════════
  //  PARTICIPANTS LIST (Real-time)
  // ══════════════════════════════════════════

  const unsubParticipants = listenToParticipants(quizId, (participants) => {
    currentParticipants = participants;
    if (countEl) countEl.textContent = participants.length;

    // ── Participant limit check for free hosts ──
    if (role === 'host' && !checkParticipantLimit(participants.length)) {
      showToast('You have reached the free participant limit (30). Upgrade to Premium to continue.', 'error');
    }

    if (!list) return;
    list.innerHTML = '';
    participants.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'lobby-participant';
      li.style.animationDelay = `${i * 0.08}s`;
      const color = getAvatarColor(p.name);
      const initials = getInitials(p.name);
      const isYou = (p.name === playerName && role === 'player');
      let tagHTML = isYou ? '<span class="lobby-participant-tag lobby-participant-tag--you">You</span>' : '';

      let removeHTML = '';
      if (role === 'host') {
        removeHTML = `<button class="lobby-participant-remove" data-pid="${p.id}" title="Remove player">✕</button>`;
      }

      li.innerHTML = `
        <div class="lobby-participant-avatar" style="background: ${color};">${initials}</div>
        <span class="lobby-participant-name">${p.name}</span>
        ${tagHTML}
        ${removeHTML}`;
      list.appendChild(li);
    });

    if (role === 'host') {
      list.querySelectorAll('.lobby-participant-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const pid = btn.dataset.pid;
          try {
            await removeParticipant(quizId, pid);
            showToast('Player removed.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }

    // Re-render components that depend on participants
    if (lastQuizData) {
      if (lastQuizData.gameStatus === 'question' || lastQuizData.gameStatus === 'results') renderPlay(lastQuizData);
      if (lastQuizData.gameStatus === 'leaderboard') {
        if (isTeamMode) renderTeamLeaderboard(lastQuizData);
        else renderLeaderboard(lastQuizData);
      }
      if (lastQuizData.gameStatus === 'ended') renderEnded(lastQuizData);

      // Re-render team selection if in waiting and team mode
      if (isTeamMode && lastQuizData.gameStatus === 'waiting' && role === 'player' && !currentTeamId) {
        renderTeamSelection('team-select-grid', lastQuizData.teamConfig, currentParticipants, quizId, participantId, (teamId) => {
          currentTeamId = teamId;
          showScreen('screen-waiting');
          // Update lobby team badge
          const lobbyTeamWrap = document.getElementById('lobby-team-wrap');
          const lobbyTeam = document.getElementById('lobby-team');
          if (lobbyTeamWrap) lobbyTeamWrap.style.display = '';
          if (lobbyTeam && lastQuizData.teamConfig?.teams?.[teamId]) {
            lobbyTeam.textContent = lastQuizData.teamConfig.teams[teamId].emoji + ' ' + lastQuizData.teamConfig.teams[teamId].name;
          }
        });
      }
    }

    // Render participants grouped by team in team mode
    if (isTeamMode && lastQuizData?.teamConfig) {
      renderTeamGroupedParticipants(participants, lastQuizData.teamConfig);
    }
  });

  // ══════════════════════════════════════════
  //  MAIN STATE LISTENER
  // ══════════════════════════════════════════

  const unsubStatus = listenToQuizStatus(quizId, (quizData) => {
    lastQuizData = quizData;
    const gameStatus = quizData.gameStatus || 'waiting';
    isTeamMode = quizData.gameMode === 'team';

    // Restore teamId from participant data if reconnecting
    if (isTeamMode && role === 'player' && !currentTeamId && participantId) {
      const myParticipant = currentParticipants.find(p => p.id === participantId);
      if (myParticipant?.teamId) {
        currentTeamId = myParticipant.teamId;
        sessionStorage.setItem('playra_lobby_teamId', currentTeamId);
      }
    }

    if (lobbyCode) lobbyCode.textContent = quizData.quizCode || '----';

    // Show team badge if in team mode
    if (isTeamMode) {
      if (lobbyMode) lobbyMode.textContent = '⚔️ Team Battle';
      const lobbyTeamWrap = document.getElementById('lobby-team-wrap');
      const lobbyTeam = document.getElementById('lobby-team');
      if (currentTeamId && quizData.teamConfig?.teams?.[currentTeamId]) {
        if (lobbyTeamWrap) lobbyTeamWrap.style.display = '';
        if (lobbyTeam) lobbyTeam.textContent = quizData.teamConfig.teams[currentTeamId].emoji + ' ' + quizData.teamConfig.teams[currentTeamId].name;
      }
    }

    if (lobbyStatus) {
      switch (gameStatus) {
        case 'waiting':
          lobbyStatus.innerHTML = '<span class="lobby-pulse"></span> Waiting for host to start…';
          break;
        case 'question':
          lobbyStatus.innerHTML = '<span class="lobby-pulse" style="background:#635bff;"></span> Question in progress…';
          break;
        case 'results':
          lobbyStatus.innerHTML = '<span class="lobby-pulse" style="background:#f59e0b;"></span> Showing results…';
          break;
        case 'leaderboard':
          lobbyStatus.innerHTML = '<span class="lobby-pulse" style="background:#8b5cf6;"></span> Leaderboard';
          break;
        case 'ended':
          lobbyStatus.innerHTML = '<span class="lobby-pulse" style="background:#ef4444;"></span> Quiz has ended';
          break;
      }
    }

    switch (gameStatus) {
      case 'waiting':
        // In team mode, players without a team see the team selection screen
        if (isTeamMode && role === 'player' && !currentTeamId) {
          showScreen('screen-team-select');
          renderTeamSelection('team-select-grid', quizData.teamConfig, currentParticipants, quizId, participantId, (teamId) => {
            currentTeamId = teamId;
            showScreen('screen-waiting');
            const lobbyTeamWrap = document.getElementById('lobby-team-wrap');
            const lobbyTeam = document.getElementById('lobby-team');
            if (lobbyTeamWrap) lobbyTeamWrap.style.display = '';
            if (lobbyTeam && quizData.teamConfig?.teams?.[teamId]) {
              lobbyTeam.textContent = quizData.teamConfig.teams[teamId].emoji + ' ' + quizData.teamConfig.teams[teamId].name;
            }
          });
        } else {
          showScreen('screen-waiting');
        }
        break;
      case 'question':
      case 'results':
        showScreen('screen-play');
        renderPlay(quizData);
        break;
      case 'leaderboard':
        if (isTeamMode) {
          showScreen('screen-team-leaderboard');
          renderTeamLeaderboard(quizData);
        } else {
          showScreen('screen-leaderboard');
          renderLeaderboard(quizData);
        }
        break;
      case 'ended':
        if (isTeamMode) {
          showScreen('screen-team-ended');
          renderTeamEnded(quizData);
        } else {
          showScreen('screen-ended');
          renderEnded(quizData);
        }
        break;
    }

    updateHostButtons(gameStatus);
  });

  // ══════════════════════════════════════════
  //  HOST BUTTON HANDLERS
  // ══════════════════════════════════════════

  if (btnStartGame) {
    btnStartGame.addEventListener('click', async () => {
      try {
        await startGameFromLobby(quizId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (btnShowAnswer) {
    btnShowAnswer.addEventListener('click', async () => {
      try {
        await showAnswerForQuestion(quizId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (btnShowLeaderboard) {
    btnShowLeaderboard.addEventListener('click', async () => {
      try {
        await showLeaderboard(quizId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (btnNextQuestion) {
    btnNextQuestion.addEventListener('click', async () => {
      try {
        await nextQuestion(quizId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ══════════════════════════════════════════
  //  RESULTS & PDF BUTTONS (Host only)
  // ══════════════════════════════════════════

  function bindResultsButtons() {
    if (role !== 'host') return;

    // Classic mode buttons
    const btnViewResults = document.getElementById('btn-view-results');
    const btnDownloadPDF = document.getElementById('btn-download-pdf');
    // Team mode buttons
    const btnViewResultsTeam = document.getElementById('btn-view-results-team');
    const btnDownloadPDFTeam = document.getElementById('btn-download-pdf-team');

    // Show all host-only buttons
    [btnViewResults, btnDownloadPDF, btnViewResultsTeam, btnDownloadPDFTeam].forEach(btn => {
      if (btn) btn.style.display = '';
    });

    // ── Apply visual lock on Download PDF for free users ──
    const isFreeUser = !canUseFeature('exportResults');
    [btnDownloadPDF, btnDownloadPDFTeam].forEach(btn => {
      if (!btn) return;
      // Remove any old lock state first
      btn.classList.remove('premium-locked-btn', 'premium-pdf-locked');
      const oldTag = btn.querySelector('.premium-lock-tag');
      if (oldTag) oldTag.remove();
      const oldBadge = btn.querySelector('.premium-lock-badge');
      if (oldBadge) oldBadge.remove();
      btn.style.opacity = '';
      btn.style.position = '';

      if (isFreeUser) {
        btn.classList.add('premium-locked-btn');
        // Ensure button text is clean (no duplicated badges)
        btn.textContent = '📄 Download PDF';
        // Add floating lock tag above corner
        const tag = document.createElement('span');
        tag.className = 'premium-lock-tag';
        tag.textContent = '🔒 Premium';
        btn.appendChild(tag);
      }
    });

    // View Results handlers — FREE for all users
    if (btnViewResults) {
      btnViewResults.onclick = () => {
        openResultsModal(lastQuizData, currentParticipants);
      };
    }
    if (btnViewResultsTeam) {
      btnViewResultsTeam.onclick = () => {
        openResultsModal(lastQuizData, currentParticipants);
      };
    }

    // Download PDF handlers
    if (btnDownloadPDF) {
      btnDownloadPDF.onclick = async () => {
        if (!canUseFeature('exportResults')) {
          openUpgradeModal('export');
          return;
        }
        btnDownloadPDF.disabled = true;
        btnDownloadPDF.textContent = '⏳ Generating…';
        try {
          await downloadResultsPDF(lastQuizData, currentParticipants);
          showToast('PDF downloaded!');
        } catch (err) {
          console.error('PDF generation failed:', err);
          showToast('PDF download failed', 'error');
        } finally {
          btnDownloadPDF.disabled = false;
          btnDownloadPDF.textContent = '📄 Download PDF';
        }
      };
    }
    if (btnDownloadPDFTeam) {
      btnDownloadPDFTeam.onclick = async () => {
        if (!canUseFeature('exportResults')) {
          openUpgradeModal('export');
          return;
        }
        btnDownloadPDFTeam.disabled = true;
        btnDownloadPDFTeam.textContent = '⏳ Generating…';
        try {
          await downloadResultsPDF(lastQuizData, currentParticipants);
          showToast('PDF downloaded!');
        } catch (err) {
          console.error('PDF generation failed:', err);
          showToast('PDF download failed', 'error');
        } finally {
          btnDownloadPDFTeam.disabled = false;
          btnDownloadPDFTeam.textContent = '📄 Download PDF';
        }
      };
    }

    // Close modal handlers
    const btnCloseResults = document.getElementById('btn-close-results');
    const btnCloseResultsBottom = document.getElementById('btn-close-results-bottom');
    if (btnCloseResults) btnCloseResults.onclick = closeResultsModal;
    if (btnCloseResultsBottom) btnCloseResultsBottom.onclick = closeResultsModal;

    // Close on overlay click
    const modalOverlay = document.getElementById('results-modal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeResultsModal();
      });
    }
  }

  bindResultsButtons();
  // Re-apply lock state when premium plan loads asynchronously
  onPlanChange(() => bindResultsButtons());

  // ══════════════════════════════════════════
  //  LEAVE LOBBY
  // ══════════════════════════════════════════

  const btnLobbyLeave = document.getElementById('btn-lobby-leave');
  const lobbyLogo = document.getElementById('lobby-logo');

  function leaveLobby() {
    unsubParticipants();
    unsubStatus();
    clearInterval(questionInterval);
    sessionStorage.removeItem('playra_lobby_quizId');
    sessionStorage.removeItem('playra_lobby_role');
    sessionStorage.removeItem('playra_lobby_name');
    sessionStorage.removeItem('playra_lobby_participantId');
    sessionStorage.removeItem('playra_lobby_teamId');
    sessionStorage.removeItem('playra_lobby_mode');
    showToast('You left the quiz lobby.');
    window.location.href = '/';
  }

  if (btnLobbyLeave) btnLobbyLeave.addEventListener('click', leaveLobby);
  if (lobbyLogo) lobbyLogo.addEventListener('click', (e) => { e.preventDefault(); leaveLobby(); });

  showToast(role === 'host' ? 'Lobby is ready! Share the code.' : `Joined as ${playerName}!`);

  // ══════════════════════════════════════════
  //  TEAM-GROUPED PARTICIPANTS LIST
  // ══════════════════════════════════════════

  function renderTeamGroupedParticipants(participants, teamConfig) {
    if (!list || !teamConfig?.teams) return;
    list.innerHTML = '';

    const teams = teamConfig.teams;
    const grouped = {};
    const unassigned = [];

    // Initialize groups
    for (const teamId of Object.keys(teams)) {
      grouped[teamId] = [];
    }

    // Sort participants into teams
    participants.forEach(p => {
      if (p.teamId && grouped[p.teamId]) {
        grouped[p.teamId].push(p);
      } else {
        unassigned.push(p);
      }
    });

    // Render each team group
    for (const [teamId, teamInfo] of Object.entries(teams)) {
      const members = grouped[teamId] || [];
      const header = document.createElement('li');
      header.className = 'team-group-header';
      header.innerHTML = `
        <span class="team-group-color" style="background: ${teamInfo.color};"></span>
        <span class="team-group-name">${teamInfo.emoji || '⚔️'} ${teamInfo.name}</span>
        <span class="team-group-count">${members.length}/${teamConfig.maxPerTeam}</span>`;
      list.appendChild(header);

      if (members.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'team-group-empty';
        empty.textContent = 'No players yet';
        list.appendChild(empty);
      } else {
        members.forEach((p, i) => {
          const li = document.createElement('li');
          li.className = 'lobby-participant';
          li.style.animationDelay = `${i * 0.06}s`;
          const color = getAvatarColor(p.name);
          const initials = getInitials(p.name);
          const isYou = (p.name === playerName && role === 'player');
          let tagHTML = isYou ? '<span class="lobby-participant-tag lobby-participant-tag--you">You</span>' : '';
          let removeHTML = '';
          if (role === 'host') {
            removeHTML = `<button class="lobby-participant-remove" data-pid="${p.id}" title="Remove player">✕</button>`;
          }
          li.innerHTML = `
            <div class="lobby-participant-avatar" style="background: ${color};">${initials}</div>
            <span class="lobby-participant-name">${p.name}</span>
            ${tagHTML}
            ${removeHTML}`;
          list.appendChild(li);
        });
      }
    }

    // Unassigned players
    if (unassigned.length > 0) {
      const header = document.createElement('li');
      header.className = 'team-group-header team-group-header--unassigned';
      header.innerHTML = `
        <span class="team-group-color" style="background: #9ca3af;"></span>
        <span class="team-group-name">🔄 Unassigned</span>
        <span class="team-group-count">${unassigned.length}</span>`;
      list.appendChild(header);

      unassigned.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'lobby-participant';
        const color = getAvatarColor(p.name);
        const initials = getInitials(p.name);
        li.innerHTML = `
          <div class="lobby-participant-avatar" style="background: ${color};">${initials}</div>
          <span class="lobby-participant-name">${p.name}</span>`;
        list.appendChild(li);
      });
    }

    // Bind remove buttons for host
    if (role === 'host') {
      list.querySelectorAll('.lobby-participant-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await removeParticipant(quizId, btn.dataset.pid);
            showToast('Player removed.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }
  }
});
