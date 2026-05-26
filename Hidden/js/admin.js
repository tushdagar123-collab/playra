/* ══════════════════════════════════════════
   PLAYRA — ADMIN PAGE ENTRY POINT
   ══════════════════════════════════════════ */

import '../css/global.css';
import '../css/navbar.css';
import '../css/dashboard.css';
import '../css/admin.css';
import '../css/responsive.css';

import { initAdminController } from './admin-controller.js';

document.addEventListener('DOMContentLoaded', () => {
  initAdminController(false);
});
