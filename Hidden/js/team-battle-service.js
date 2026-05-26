/* ══════════════════════════════════════════
   PLAYRA — TEAM BATTLE SERVICE
   Team-specific logic: config, join, scoring
   ══════════════════════════════════════════ */

import { db } from './firebase-config.js';
import {
  doc,
  getDoc,
  updateDoc,
  runTransaction,
  collection,
  getDocs
} from 'firebase/firestore';

// ══════════════════════════════════════════
//  TEAM PRESETS
// ══════════════════════════════════════════

export const TEAM_PRESETS = [
  { id: 'team_0', name: 'Red Rockets',     color: '#ef4444', emoji: '🚀' },
  { id: 'team_1', name: 'Blue Bolts',      color: '#3b82f6', emoji: '⚡' },
  { id: 'team_2', name: 'Green Gators',    color: '#10b981', emoji: '🐊' },
  { id: 'team_3', name: 'Purple Panthers', color: '#8b5cf6', emoji: '🐆' },
  { id: 'team_4', name: 'Orange Owls',     color: '#f97316', emoji: '🦉' },
  { id: 'team_5', name: 'Cyan Sharks',     color: '#06b6d4', emoji: '🦈' },
];

// ══════════════════════════════════════════
//  BUILD TEAM CONFIG
// ══════════════════════════════════════════

/**
 * Generate a team configuration object.
 * @param {number} numTeams - Number of teams (2-6)
 * @param {number} maxPerTeam - Max members per team
 * @param {object|null} customNames - Optional { team_0: 'Name', … }
 * @returns {object} teamConfig with numTeams, maxPerTeam, and teams map
 */
export function buildTeamConfig(numTeams, maxPerTeam, customNames = null) {
  const teams = {};
  for (let i = 0; i < numTeams; i++) {
    const preset = TEAM_PRESETS[i];
    teams[preset.id] = {
      name: customNames?.[preset.id] || preset.name,
      color: preset.color,
      emoji: preset.emoji,
    };
  }
  return { numTeams, maxPerTeam, teams };
}

// ══════════════════════════════════════════
//  JOIN TEAM (Transaction-safe)
// ══════════════════════════════════════════

/**
 * Assign a player to a team. Uses a transaction to prevent
 * exceeding the max members per team (race-condition safe).
 * @param {string} quizId
 * @param {string} participantId
 * @param {string} teamId - e.g. 'team_0'
 * @throws if team is full or doesn't exist
 */
export async function joinTeam(quizId, participantId, teamId) {
  console.log('[TeamBattle] joinTeam:', { quizId, participantId, teamId });

  const quizRef = doc(db, 'quizzes', quizId);
  const participantRef = doc(db, 'quizzes', quizId, 'participants', participantId);

  await runTransaction(db, async (transaction) => {
    const quizDoc = await transaction.get(quizRef);
    if (!quizDoc.exists()) throw new Error('Quiz not found.');

    const data = quizDoc.data();
    const teamConfig = data.teamConfig;
    if (!teamConfig) throw new Error('This quiz does not have team mode enabled.');

    const teamInfo = teamConfig.teams?.[teamId];
    if (!teamInfo) throw new Error('Team does not exist.');

    // Count current members of this team
    const participantsRef = collection(db, 'quizzes', quizId, 'participants');
    const participantsSnap = await getDocs(participantsRef);
    let teamCount = 0;
    participantsSnap.docs.forEach(d => {
      if (d.data().teamId === teamId) teamCount++;
    });

    if (teamCount >= teamConfig.maxPerTeam) {
      throw new Error(`Team "${teamInfo.name}" is full! (${teamCount}/${teamConfig.maxPerTeam})`);
    }

    // Assign team
    transaction.update(participantRef, { teamId });
  });

  console.log('[TeamBattle] Player joined team:', teamId);
}

// ══════════════════════════════════════════
//  HOST: UPDATE TEAM NAME
// ══════════════════════════════════════════

/**
 * Update a team's display name (host only, before game starts).
 * @param {string} quizId
 * @param {string} teamId
 * @param {string} newName
 */
export async function updateTeamName(quizId, teamId, newName) {
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, {
    [`teamConfig.teams.${teamId}.name`]: newName.trim() || 'Unnamed Team',
  });
}

// ══════════════════════════════════════════
//  HOST: DELETE TEAM (before game starts)
// ══════════════════════════════════════════

/**
 * Remove a team from the config. Only allowed before game starts.
 * Unassigns any players who were on that team.
 * @param {string} quizId
 * @param {string} teamId
 */
export async function deleteTeam(quizId, teamId) {
  const quizRef = doc(db, 'quizzes', quizId);

  await runTransaction(db, async (transaction) => {
    const quizDoc = await transaction.get(quizRef);
    if (!quizDoc.exists()) throw new Error('Quiz not found.');

    const data = quizDoc.data();
    if (data.gameStatus !== 'waiting') {
      throw new Error('Cannot delete teams after the game has started.');
    }

    const teamConfig = { ...data.teamConfig };
    const teams = { ...teamConfig.teams };
    delete teams[teamId];
    teamConfig.teams = teams;
    teamConfig.numTeams = Object.keys(teams).length;

    if (teamConfig.numTeams < 2) {
      throw new Error('You must have at least 2 teams.');
    }

    transaction.update(quizRef, { teamConfig });

    // Unassign players from deleted team
    const participantsRef = collection(db, 'quizzes', quizId, 'participants');
    const participantsSnap = await getDocs(participantsRef);
    participantsSnap.docs.forEach(d => {
      if (d.data().teamId === teamId) {
        transaction.update(d.ref, { teamId: null });
      }
    });
  });
}

// ══════════════════════════════════════════
//  TEAM MEMBER COUNTS
// ══════════════════════════════════════════

/**
 * Get the member count per team from a participants array.
 * @param {Array} participants - Array of participant objects (with teamId)
 * @param {object} teamConfig - The quiz's teamConfig
 * @returns {object} { team_0: 3, team_1: 2, … }
 */
export function getTeamCounts(participants, teamConfig) {
  const counts = {};
  if (!teamConfig?.teams) return counts;

  // Initialize all teams to 0
  for (const teamId of Object.keys(teamConfig.teams)) {
    counts[teamId] = 0;
  }

  // Count assigned participants
  participants.forEach(p => {
    if (p.teamId && counts[p.teamId] !== undefined) {
      counts[p.teamId]++;
    }
  });

  return counts;
}

// ══════════════════════════════════════════
//  TEAM LEADERBOARD
// ══════════════════════════════════════════

/**
 * Build a sorted team leaderboard with individual player details.
 * @param {Array} participants - Participant objects with id, name, teamId
 * @param {object} scores - { participantId: score, … }
 * @param {object} teamConfig - The quiz's teamConfig
 * @returns {Array} Sorted array of team entries:
 *   [{ teamId, name, color, emoji, totalScore, members: [{ name, score }] }]
 */
export function buildTeamLeaderboard(participants, scores, teamConfig) {
  if (!teamConfig?.teams) return [];

  const teamMap = {};

  // Initialize teams
  for (const [teamId, info] of Object.entries(teamConfig.teams)) {
    teamMap[teamId] = {
      teamId,
      name: info.name,
      color: info.color,
      emoji: info.emoji || '⚔️',
      totalScore: 0,
      members: [],
    };
  }

  // Assign participants to teams with scores
  participants.forEach(p => {
    if (p.teamId && teamMap[p.teamId]) {
      const playerScore = scores[p.id] || 0;
      teamMap[p.teamId].totalScore += playerScore;
      teamMap[p.teamId].members.push({
        id: p.id,
        name: p.name,
        score: playerScore,
      });
    }
  });

  // Sort members within each team (descending by score)
  for (const team of Object.values(teamMap)) {
    team.members.sort((a, b) => b.score - a.score);
  }

  // Sort teams descending by total score
  const sorted = Object.values(teamMap).sort((a, b) => b.totalScore - a.totalScore);
  return sorted;
}
