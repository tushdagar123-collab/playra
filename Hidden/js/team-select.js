/* ══════════════════════════════════════════
   PLAYRA — TEAM SELECTION UI
   Renders team cards in the lobby for players
   to choose which team to join.
   ══════════════════════════════════════════ */

import { joinTeam, getTeamCounts } from './team-battle-service.js';
import { showToast } from './utils.js';

/**
 * Render team selection cards into the target container.
 * @param {string} containerId - DOM element ID to render into
 * @param {object} teamConfig - The quiz's teamConfig
 * @param {Array} participants - Current participants array (for counting)
 * @param {string} quizId - Current quiz ID
 * @param {string} participantId - Current player's participant ID
 * @param {function} onTeamJoined - Callback after successfully joining a team
 */
export function renderTeamSelection(containerId, teamConfig, participants, quizId, participantId, onTeamJoined) {
  const container = document.getElementById(containerId);
  if (!container || !teamConfig?.teams) return;

  const counts = getTeamCounts(participants, teamConfig);
  const maxPerTeam = teamConfig.maxPerTeam || 5;

  container.innerHTML = '';

  for (const [teamId, info] of Object.entries(teamConfig.teams)) {
    const count = counts[teamId] || 0;
    const isFull = count >= maxPerTeam;

    const card = document.createElement('div');
    card.className = `team-select-card-item${isFull ? ' team-select-card-item--full' : ''}`;
    card.style.setProperty('--team-color', info.color);

    card.innerHTML = `
      <div class="team-select-stripe" style="background: ${info.color};"></div>
      <div class="team-select-body">
        <div class="team-select-emoji">${info.emoji || '⚔️'}</div>
        <h3 class="team-select-name">${info.name}</h3>
        <div class="team-select-count">
          <span class="team-select-count-num">${count}</span>
          <span class="team-select-count-sep">/</span>
          <span class="team-select-count-max">${maxPerTeam}</span>
          <span class="team-select-count-label">players</span>
        </div>
        <button class="btn btn--sm team-select-join-btn" ${isFull ? 'disabled' : ''} data-team-id="${teamId}" style="background: ${info.color}; color: #fff; box-shadow: 0 4px 12px ${info.color}40;">
          ${isFull ? '🔒 Team Full' : '⚔️ Join Team'}
        </button>
      </div>`;

    container.appendChild(card);
  }

  // Bind join buttons
  container.querySelectorAll('.team-select-join-btn').forEach(btn => {
    if (btn.disabled) return;

    btn.addEventListener('click', async () => {
      const teamId = btn.dataset.teamId;
      const originalText = btn.innerHTML;
      btn.innerHTML = '⏳ Joining…';
      btn.disabled = true;

      try {
        await joinTeam(quizId, participantId, teamId);
        // Store in session for reconnect
        sessionStorage.setItem('playra_lobby_teamId', teamId);
        showToast(`Joined ${teamConfig.teams[teamId].name}! ⚔️`);
        if (onTeamJoined) onTeamJoined(teamId);
      } catch (err) {
        console.error('[TeamSelect] Join failed:', err);
        showToast(err.message || 'Failed to join team.', 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  });
}
