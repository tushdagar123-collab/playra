/* ══════════════════════════════════════════
   PLAYRA — SHARED UTILITIES
   ══════════════════════════════════════════ */

// ─── Toast Notifications ───
export function showToast(message, type = 'success') {
  const existing = document.querySelector('.auth-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `auth-toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${message}`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ─── Modal Helpers ───
export function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  const form = overlay.querySelector('form');
  if (form) form.reset();
}

export function closeAllModals() {
  document.querySelectorAll('.auth-overlay').forEach(o => {
    o.classList.remove('active');
  });
  document.body.style.overflow = '';
}

// ─── Dashboard Helpers ───
export function showDashboard(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.style.display = '';
    document.body.style.overflow = 'hidden';
  }
}

export function hideDashboard(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// ─── Loading Simulation ───
export function simulateLoading(btn, callback, duration = 1200) {
  const original = btn.innerHTML;
  btn.classList.add('loading');
  btn.innerHTML = '<span></span> Please wait…';
  setTimeout(() => {
    btn.classList.remove('loading');
    btn.innerHTML = original;
    callback();
  }, duration);
}

// ─── Form Error Helpers ───
export function showFormError(errorId, message, inputIds = []) {
  const el = document.getElementById(errorId);
  if (el) {
    el.textContent = message;
    el.classList.add('visible');
  }
  inputIds.forEach(id => {
    const wrap = document.getElementById(id)?.closest('.auth-input-wrap');
    if (wrap) wrap.classList.add('input-error');
  });
}

export function clearFormErrors(errorId, inputIds = []) {
  const el = document.getElementById(errorId);
  if (el) {
    el.textContent = '';
    el.classList.remove('visible');
  }
  inputIds.forEach(id => {
    const wrap = document.getElementById(id)?.closest('.auth-input-wrap');
    if (wrap) wrap.classList.remove('input-error');
  });
}
