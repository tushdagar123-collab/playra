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
  // Initialize the quiz editor (wires up all sidebar link view-switching)
  initQuizEditor();

  showToast('Welcome to your dashboard!');
  setupAccountPlanListener();

  // ─── Mobile Sidebar Toggle ───
  const sidebar  = document.getElementById('dashboard-sidebar');
  const toggleBtn = document.getElementById('dashboard-sidebar-toggle');
  const closeBtn  = document.getElementById('dashboard-sidebar-close');
  const overlay   = document.getElementById('dashboard-sidebar-overlay');

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  }

  // Hamburger button opens sidebar
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebar?.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  // Close (×) button inside sidebar
  closeBtn?.addEventListener('click', closeSidebar);

  // Tapping the backdrop overlay closes sidebar
  overlay?.addEventListener('click', closeSidebar);

  // Close sidebar when any nav link is clicked on mobile
  sidebar?.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Keyboard: Escape key closes sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar?.classList.contains('open')) {
      closeSidebar();
    }
  });
});