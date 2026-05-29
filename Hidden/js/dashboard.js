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

  // ─── Mobile Sidebar Toggle ───
  const sidebar = document.getElementById('dashboard-sidebar');
  const toggleBtn = document.getElementById('dashboard-sidebar-toggle');
  const closeBtn = document.getElementById('dashboard-sidebar-close');

  function openSidebar() {
    sidebar?.classList.add('open');
    document.body.classList.add('sidebar-overlay-active');
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    document.body.classList.remove('sidebar-overlay-active');
  }

  toggleBtn?.addEventListener('click', openSidebar);
  closeBtn?.addEventListener('click', closeSidebar);

  // Close sidebar when a nav link is clicked (mobile)
  sidebar?.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Close sidebar when clicking the backdrop
  document.addEventListener('click', (e) => {
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== toggleBtn &&
      !toggleBtn?.contains(e.target)
    ) {
      closeSidebar();
    }
  });
});