/* ══════════════════════════════════════════
   PLAYRA — DASHBOARD PAGE ENTRY POINT
   ══════════════════════════════════════════ */

import '../css/global.css';
import '../css/navbar.css';
import '../css/dashboard.css';
import '../css/quiz-editor.css';
import '../css/lobby.css';
import '../css/team-battle.css';
import '../css/premium.css';
import '../css/account.css';
import '../css/onboarding.css';
import '../css/auth.css';
import '../css/responsive.css';

import { initQuizEditor } from './quiz-editor.js';
import { showToast } from './utils.js';
import { setupAccountPlanListener } from './account-service.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize the quiz editor
  initQuizEditor();

  showToast('Welcome to your dashboard!');
  setupAccountPlanListener();

  // ─── Mobile Sidebar Toggle ───
  const sidebar = document.getElementById('dashboard-sidebar');
  const toggleBtn = document.getElementById('dashboard-sidebar-toggle');
  const closeBtn = document.getElementById('dashboard-sidebar-close');

  // On mobile: move sidebar to <body> so overflow:hidden on .dashboard-page
  // doesn't clip the position:fixed sidebar
  function setupSidebarForMobile() {
    if (window.innerWidth <= 768 && sidebar && sidebar.parentElement !== document.body) {
      document.body.appendChild(sidebar);
    }
  }

  setupSidebarForMobile();
  window.addEventListener('resize', setupSidebarForMobile);

  function openSidebar() {
    sidebar?.classList.add('open');
    document.body.classList.add('sidebar-overlay-active');
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    document.body.classList.remove('sidebar-overlay-active');
  }

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSidebar();
  });

  closeBtn?.addEventListener('click', closeSidebar);

  // Close sidebar when a nav link is clicked (mobile)
  sidebar?.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Close sidebar when clicking outside (backdrop)
  document.addEventListener('click', (e) => {
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !toggleBtn?.contains(e.target)
    ) {
      closeSidebar();
    }
  });
});