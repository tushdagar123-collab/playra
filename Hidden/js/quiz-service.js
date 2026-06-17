/* ══════════════════════════════════════════
   PLAYRA — QUIZ SERVICE
   Firestore CRUD + Real-time for Quiz Lifecycle
   ══════════════════════════════════════════ */

import { db } from './firebase-config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';

// ══════════════════════════════════════════
//  QUIZ CODE GENERATION
// ══════════════════════════════════════════

/**
 * Generate a random 4-digit numeric code.
 * Simple approach: no Firestore query needed (avoids composite index issues).
 * Collision risk is negligible for small-scale usage.
 */
export function generateQuizCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Timeout wrapper for Firestore operations.
 * Prevents buttons from staying 'stuck' if Firestore is not initialized or unreachable.
 */
async function withTimeout(promise, timeoutMs = 10000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Firestore operation timed out. Please ensure your database is created and rules are deployed.')), timeoutMs);
  });
  const result = await Promise.race([promise, timeoutPromise]);
  clearTimeout(timeoutId);
  return result;
}

// ══════════════════════════════════════════
//  QUIZ CRUD
// ══════════════════════════════════════════

/**
 * Save a quiz to Firestore as a draft.
 * @param {string} hostId - The Firebase Auth UID of the host
 * @param {object} quizData - { title, questions, timer }
 * @param {string|null} existingQuizId - If updating an existing quiz
 * @returns {string} The quiz document ID
 */
export async function saveQuizToFirestore(hostId, quizData, existingQuizId = null) {
  console.log('[QuizService] saveQuizToFirestore called', { hostId, existingQuizId, title: quizData.title });

  const docData = {
    title: quizData.title || 'Untitled Quiz',
    questions: quizData.questions || [],
    timer: quizData.timer || 20,
    hostId: hostId,
    status: 'draft',
    quizCode: null,
    updatedAt: serverTimestamp()
  };

  try {
    if (existingQuizId) {
      console.log('[QuizService] Updating existing quiz:', existingQuizId);
      const quizRef = doc(db, 'quizzes', existingQuizId);
      await withTimeout(updateDoc(quizRef, docData));
      console.log('[QuizService] Quiz updated successfully:', existingQuizId);
      return existingQuizId;
    } else {
      docData.createdAt = serverTimestamp();
      console.log('[QuizService] Creating new quiz doc...');
      const docRef = await withTimeout(addDoc(collection(db, 'quizzes'), docData));
      console.log('[QuizService] Quiz created with ID:', docRef.id);
      return docRef.id;
    }
  } catch (err) {
    console.error('[QuizService] saveQuizToFirestore FAILED:', err);
    throw err;
  }
}

/**
 * Start a quiz — sets status to "live" and assigns a quiz code.
 * This puts the quiz in the lobby (waiting for players).
 * @param {string} quizId - The Firestore document ID
 * @param {string} gameMode - 'classic' or 'team'
 * @param {object|null} teamConfig - Team configuration (only for team mode)
 * @returns {string} The generated quiz code
 */
export async function startQuiz(quizId, gameMode = 'classic', teamConfig = null) {
  console.log('[QuizService] startQuiz called with quizId:', quizId, 'mode:', gameMode);

  if (!quizId) {
    throw new Error('Cannot start quiz: quizId is undefined.');
  }

  try {
    const quizRef = doc(db, 'quizzes', quizId);
    const quizSnap = await withTimeout(getDoc(quizRef));

    if (!quizSnap.exists()) {
      throw new Error('Quiz not found in Firestore.');
    }

    const data = quizSnap.data();
    console.log('[QuizService] Current quiz status:', data.status, 'code:', data.quizCode);

    // If already live with a code, return the existing code
    if (data.status === 'live' && data.quizCode) {
      console.log('[QuizService] Quiz already live, returning existing code:', data.quizCode);
      return data.quizCode;
    }

    const quizCode = generateQuizCode();
    console.log('[QuizService] Generated quiz code:', quizCode);

    const updateData = {
      status: 'live',
      quizCode: quizCode,
      gameStatus: 'waiting',
      gameMode: gameMode,
      currentQuestionIndex: 0,
      showAnswer: false,
      answers: {},
      scores: {},
      startedAt: serverTimestamp()
    };

    // Add team-specific fields
    if (gameMode === 'team' && teamConfig) {
      updateData.teamConfig = teamConfig;
      updateData.teamScores = {};
      // Initialize team scores to 0
      for (const teamId of Object.keys(teamConfig.teams)) {
        updateData.teamScores[teamId] = 0;
      }
    }

    await withTimeout(updateDoc(quizRef, updateData));

    console.log('[QuizService] Quiz started successfully! Code:', quizCode, 'Mode:', gameMode);
    return quizCode;
  } catch (err) {
    console.error('[QuizService] startQuiz FAILED:', err);
    throw err;
  }
}

/**
 * End a quiz — sets status to "ended"
 */
export async function endQuiz(quizId) {
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, {
    status: 'ended',
    gameStatus: 'ended',
    endedAt: serverTimestamp()
  });
}

/**
 * Get a single quiz by ID
 */
export async function getQuiz(quizId) {
  const quizRef = doc(db, 'quizzes', quizId);
  const quizSnap = await getDoc(quizRef);
  if (!quizSnap.exists()) return null;
  return { id: quizSnap.id, ...quizSnap.data() };
}

/**
 * Get all quizzes owned by a host, ordered by creation date descending.
 * @param {string} hostId
 * @returns {Array} Array of quiz objects with id
 */
export async function getMyQuizzes(hostId) {
  const q = query(
    collection(db, 'quizzes'),
    where('hostId', '==', hostId)
  );
  const snapshot = await getDocs(q);
  const quizzes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  // Sort client-side to avoid requiring a composite index
  quizzes.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.toMillis?.() || 0;
    return bTime - aTime; // descending (newest first)
  });
  return quizzes;
}

/**
 * Delete a quiz and its participants subcollection
 */
export async function deleteQuiz(quizId) {
  // Delete all participants first
  const participantsRef = collection(db, 'quizzes', quizId, 'participants');
  const participantsSnap = await getDocs(participantsRef);
  const deletePromises = participantsSnap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deletePromises);

  // Delete the quiz doc
  await deleteDoc(doc(db, 'quizzes', quizId));
}

// ══════════════════════════════════════════
//  JOIN QUIZ
// ══════════════════════════════════════════

/**
 * Find a live quiz by its 4-digit code.
 * @param {string} code - 4-digit quiz code
 * @returns {object|null} Quiz object with id, or null
 */
export async function findLiveQuizByCode(code) {
  const q = query(
    collection(db, 'quizzes'),
    where('quizCode', '==', code),
    where('status', '==', 'live')
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const d = snapshot.docs[0];
  return { id: d.id, ...d.data() };
}

/**
 * Add a participant to a quiz's participants subcollection.
 * @param {string} quizId
 * @param {string} playerName
 * @param {string|null} avatarId — Selected avatar ID (e.g. 'tech-student-m')
 * @returns {string} The participant document ID
 */
export async function joinQuiz(quizId, playerName, avatarId = null) {
  const participantData = {
    name: playerName,
    score: 0,
    joinedAt: serverTimestamp()
  };
  if (avatarId) {
    participantData.avatarId = avatarId;
  }

  const participantsRef = collection(db, 'quizzes', quizId, 'participants');
  const docRef = await addDoc(participantsRef, participantData);
  return docRef.id;
}

// ══════════════════════════════════════════
//  GAME STATE MANAGEMENT
//  All clients listen via onSnapshot; UI is
//  driven entirely by the Firebase state.
// ══════════════════════════════════════════

/**
 * HOST: Begin the quiz — transition from lobby waiting to the first question.
 * Sets gameStatus = "question", currentQuestionIndex = 0, showAnswer = false.
 */
export async function startGameFromLobby(quizId) {
  console.log('[QuizService] startGameFromLobby:', quizId);
  const quizRef = doc(db, 'quizzes', quizId);
  const quizSnap = await getDoc(quizRef);
  const data = quizSnap.data();
  const duration = data.timer || 20;

  await updateDoc(quizRef, {
    gameStatus: 'question',
    currentQuestionIndex: 0,
    showAnswer: false,
    answers: {},
    questionStartTime: serverTimestamp(),
    questionTime: duration
  });
}

/**
 * HOST: Show the correct answer for the current question.
 * Also evaluates scores for all participants.
 * In team mode, also aggregates teamScores.
 */
export async function showAnswerForQuestion(quizId) {
  console.log('[QuizService] showAnswerForQuestion:', quizId);
  const quizRef = doc(db, 'quizzes', quizId);

  await runTransaction(db, async (transaction) => {
    const quizDoc = await transaction.get(quizRef);
    if (!quizDoc.exists()) throw new Error('Quiz not found');

    const data = quizDoc.data();
    const answers = data.answers || {};
    const scores = data.scores || {};
    const isTeamMode = data.gameMode === 'team';
    const teamScores = data.teamScores || {};

    // Calculate scores for this round based on isCorrect property
    for (const [participantId, answerObj] of Object.entries(answers)) {
      if (!scores[participantId]) scores[participantId] = 0;
      if (answerObj && answerObj.isCorrect) {
        scores[participantId] += 10;

        // Aggregate team score (teamId is stored on the answer object)
        if (isTeamMode && answerObj.teamId) {
          if (!teamScores[answerObj.teamId]) teamScores[answerObj.teamId] = 0;
          teamScores[answerObj.teamId] += 10;
        }
      }
    }

    const updateData = {
      showAnswer: true,
      gameStatus: 'results',
      scores: scores
    };

    if (isTeamMode) {
      updateData.teamScores = teamScores;
    }

    transaction.update(quizRef, updateData);
  });
}

/**
 * HOST: Show leaderboard.
 */
export async function showLeaderboard(quizId) {
  console.log('[QuizService] showLeaderboard:', quizId);
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, {
    gameStatus: 'leaderboard'
  });
}

/**
 * HOST: Move to the next question, or end the quiz if no more questions.
 */
export async function nextQuestion(quizId) {
  console.log('[QuizService] nextQuestion:', quizId);
  const quizRef = doc(db, 'quizzes', quizId);
  const quizSnap = await getDoc(quizRef);
  if (!quizSnap.exists()) throw new Error('Quiz not found');

  const data = quizSnap.data();
  const nextIndex = (data.currentQuestionIndex || 0) + 1;
  const totalQuestions = (data.questions || []).length;

  if (nextIndex >= totalQuestions) {
    // End the quiz
    await updateDoc(quizRef, {
      gameStatus: 'ended',
      status: 'ended',
      showAnswer: false,
      endedAt: serverTimestamp()
    });
  } else {
    await updateDoc(quizRef, {
      gameStatus: 'question',
      currentQuestionIndex: nextIndex,
      showAnswer: false,
      answers: {},
      questionStartTime: serverTimestamp(),
      questionTime: data.timer || 20
    });
  }
}

/**
 * PLAYER: Submit an answer for the current question.
 * Uses a transaction to prevent duplicate submissions.
 * @param {string} quizId
 * @param {string} participantId
 * @param {number} selectedOption
 * @param {string|null} teamId - Player's team ID (for team mode scoring)
 */
export async function submitAnswer(quizId, participantId, selectedOption, teamId = null) {
  console.log('[QuizService] submitAnswer:', { quizId, participantId, selectedOption, teamId });
  const quizRef = doc(db, 'quizzes', quizId);

  await runTransaction(db, async (transaction) => {
    const quizDoc = await transaction.get(quizRef);
    if (!quizDoc.exists()) throw new Error('Quiz not found');

    const data = quizDoc.data();
    const answers = data.answers || {};

    if (answers[participantId] !== undefined) {
      throw new Error('Answer already submitted.');
    }

    if (data.gameStatus !== 'question') {
      throw new Error('Not accepting answers right now.');
    }

    const currentQIndex = data.currentQuestionIndex || 0;
    const question = data.questions[currentQIndex];
    const isCorrect = selectedOption === question.correctAnswer;

    const answerData = {
      selectedOption,
      isCorrect,
      submittedAt: Date.now()
    };

    // Include teamId for efficient team score aggregation
    if (teamId) {
      answerData.teamId = teamId;
    }

    transaction.update(quizRef, {
      [`answers.${participantId}`]: answerData
    });
  });
}

/**
 * HOST: Remove a participant from the quiz.
 */
export async function removeParticipant(quizId, participantId) {
  console.log('[QuizService] removeParticipant:', { quizId, participantId });
  const participantRef = doc(db, 'quizzes', quizId, 'participants', participantId);
  await deleteDoc(participantRef);
}

// ══════════════════════════════════════════
//  REAL-TIME LISTENERS
// ══════════════════════════════════════════

/**
 * Listen to the participants subcollection of a quiz in real-time.
 * @param {string} quizId
 * @param {function} callback - Called with array of participant objects
 * @returns {function} Unsubscribe function
 */
export function listenToParticipants(quizId, callback) {
  const participantsRef = collection(db, 'quizzes', quizId, 'participants');
  const q = query(participantsRef, orderBy('joinedAt', 'asc'));

  return onSnapshot(q, (snapshot) => {
    const participants = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    callback(participants);
  });
}

/**
 * Listen to a quiz document for ALL state changes (status, gameStatus, answers, etc).
 * This is the single source of truth — UI is driven entirely by this listener.
 * @param {string} quizId
 * @param {function} callback - Called with quiz data object
 * @returns {function} Unsubscribe function
 */
export function listenToQuizStatus(quizId, callback) {
  const quizRef = doc(db, 'quizzes', quizId);
  return onSnapshot(quizRef, (docSnap) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() });
    }
  });
}

/**
 * Update quiz status field
 */
export async function updateQuizStatus(quizId, status) {
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, { status });
}
