/* ══════════════════════════════════════════
   PLAYRA — DASHBOARD PAGE ENTRY POINT
   ══════════════════════════════════════════ */

import '../css/global.css';
import '../css/navbar.css';
import '../css/dashboard.css';
import '../css/quiz-editor.css';
import '../css/lobby.css';
import '../css/team-battle.css';
import '../css/auth.css';
import '../css/responsive.css';

import { initQuizEditor } from './quiz-editor.js';
import { showToast } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize the quiz editor
  initQuizEditor();

  showToast('Welcome to your dashboard!');
});