/* ══════════════════════════════════════════
   PLAYRA — MAIN ENTRY POINT (Landing Page)
   ══════════════════════════════════════════ */

// CSS imports (Vite handles these)
import '../css/global.css';
import '../css/navbar.css';
import '../css/hero.css';
import '../css/features.css';
import '../css/pricing.css';
import '../css/contact.css';
import '../css/footer.css';
import '../css/auth.css';
import '../css/dashboard.css';
import '../css/quiz-editor.css';
import '../css/lobby.css';
import '../css/team-battle.css';
import '../css/admin.css';
import '../css/faq.css';
import '../css/premium.css';
import '../css/account.css';
import '../css/responsive.css';

// Module imports
import { initAuth } from './auth.js';
import { initQuizEditor } from './quiz-editor.js';
import { initJoinQuiz } from './join-quiz.js';
import { initAdminController } from './admin-controller.js';
import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from './utils.js';
import { initRazorpay } from './razorpay.js';
import { initAccountView, setupAccountPlanListener } from './account-service.js';

document.addEventListener('DOMContentLoaded', () => {
  // ─── Mobile Navigation ───
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('nav-menu');

  toggle.addEventListener('click', () => {
    menu.classList.toggle('open');
    toggle.classList.toggle('active');
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      menu.classList.remove('open');
      toggle.classList.remove('active');
    });
  });

  // ─── Navbar scroll effect ───
  const navbar = document.getElementById('navbar');
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ─── Active nav link based on scroll ───
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const highlightNav = () => {
    const scrollY = window.scrollY + 120;
    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');
      if (scrollY >= top && scrollY < top + height) {
        navLinks.forEach(l => l.classList.remove('active'));
        const active = document.querySelector(`.nav-link[href="#${id}"]`);
        if (active) active.classList.add('active');
      }
    });
  };
  window.addEventListener('scroll', highlightNav, { passive: true });

  // ─── Reveal on scroll (Intersection Observer) ───
  const reveals = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const delay = Array.from(entry.target.parentElement.querySelectorAll('.reveal'))
            .indexOf(entry.target) * 100;
          setTimeout(() => entry.target.classList.add('visible'), delay);
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  reveals.forEach(el => revealObserver.observe(el));

  // ─── Counter animation ───
  const counters = document.querySelectorAll('.stat-number');
  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  counters.forEach(c => counterObserver.observe(c));

  function animateCounter(el) {
    const target = parseInt(el.dataset.target, 10);
    const duration = 2000;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      const current = Math.floor(eased * target);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ─── Contact form → Firestore ───
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('btn-send-message');

  if (form && submitBtn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('contact-name').value.trim();
      const email = document.getElementById('contact-email').value.trim();
      const message = document.getElementById('contact-message').value.trim();

      if (!name || !email || !message) return;

      const original = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span class="admin-loading-spinner" style="width:16px;height:16px;border-width:2px;"></span> Sending...';
      submitBtn.disabled = true;

      try {
        // Import auth to capture userId if logged in
        const { auth: firebaseAuth } = await import('./firebase-config.js');
        const currentUser = firebaseAuth.currentUser;

        await addDoc(collection(db, 'contactMessages'), {
          userId: currentUser ? currentUser.uid : null,
          name,
          email,
          message,
          createdAt: serverTimestamp(),
          status: 'Pending',
          adminReply: '',
          repliedAt: null
        });

        submitBtn.innerHTML = '✓ Message Sent!';
        submitBtn.style.background = 'var(--color-accent)';
        submitBtn.style.color = 'var(--color-secondary)';
        showToast('Your message has been sent successfully!', 'success');
        form.reset();

        setTimeout(() => {
          submitBtn.innerHTML = original;
          submitBtn.style.background = '';
          submitBtn.style.color = '';
          submitBtn.disabled = false;
        }, 3000);
      } catch (err) {
        console.error('[Contact] Failed to send message:', err);
        submitBtn.innerHTML = original;
        submitBtn.disabled = false;
        showToast('Failed to send message. Please try again.', 'error');
      }
    });
  }

  // ─── Smooth scroll for anchor links ───
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      e.preventDefault();
      const target = document.querySelector(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ─── Parallax-like tilt on feature cards ───
  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -3;
      const rotateY = ((x - centerX) / centerX) * 3;
      card.style.transform = `translateY(-8px) perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  // ─── Initialize modules ───
  initAuth();
  initQuizEditor();
  initJoinQuiz();
  initAdminController(true);
  initRazorpay();
  setupAccountPlanListener();

  // ─── FAQ Accordion ───
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const btn = item.querySelector('.faq-question');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      // Close all others
      faqItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('open');
          const ob = other.querySelector('.faq-question');
          if (ob) ob.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // ─── FAQ Search ───
  const faqSearch = document.getElementById('faq-search');
  const faqClear = document.getElementById('faq-search-clear');
  const faqNoResults = document.getElementById('faq-no-results');

  function faqDoSearch(query) {
    const q = query.trim().toLowerCase();
    let visible = 0;

    faqItems.forEach(item => {
      const qEl = item.querySelector('.faq-question-text');
      const aEl = item.querySelector('.faq-answer');
      if (!qEl || !aEl) return;

      // Cache originals once
      if (!item.dataset.question) item.dataset.question = qEl.textContent;
      if (!aEl.dataset.orig) aEl.dataset.orig = aEl.textContent;

      const origQ = item.dataset.question;
      const origA = aEl.dataset.orig;

      if (!q) {
        item.classList.remove('hidden-search');
        qEl.textContent = origQ;
        aEl.textContent = origA;
        item.classList.remove('open');
        const ib = item.querySelector('.faq-question');
        if (ib) ib.setAttribute('aria-expanded', 'false');
        visible++;
      } else {
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(${esc})`, 'gi');
        if (origQ.toLowerCase().includes(q) || origA.toLowerCase().includes(q)) {
          item.classList.remove('hidden-search');
          qEl.innerHTML = origQ.replace(re, '<mark class="faq-highlight">$1</mark>');
          aEl.innerHTML = origA.replace(re, '<mark class="faq-highlight">$1</mark>');
          // Auto-open on search
          item.classList.add('open');
          const ib = item.querySelector('.faq-question');
          if (ib) ib.setAttribute('aria-expanded', 'true');
          visible++;
        } else {
          item.classList.add('hidden-search');
          item.classList.remove('open');
          const ib = item.querySelector('.faq-question');
          if (ib) ib.setAttribute('aria-expanded', 'false');
        }
      }
    });

    if (faqNoResults) faqNoResults.classList.toggle('visible', visible === 0 && q.length > 0);
    if (faqClear) faqClear.classList.toggle('visible', q.length > 0);
  }

  if (faqSearch) {
    faqSearch.addEventListener('input', e => faqDoSearch(e.target.value));
    faqSearch.addEventListener('search', e => { if (!e.target.value) faqDoSearch(''); });
  }
  if (faqClear) {
    faqClear.addEventListener('click', () => {
      if (faqSearch) { faqSearch.value = ''; faqSearch.focus(); }
      faqDoSearch('');
    });
  }
});
