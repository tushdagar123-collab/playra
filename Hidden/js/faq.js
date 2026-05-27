/* ══════════════════════════════════════════
   PLAYRA — FAQ PAGE ENTRY POINT
   ══════════════════════════════════════════ */

// CSS imports (Vite handles these)
import '../css/global.css';
import '../css/navbar.css';
import '../css/footer.css';
import '../css/auth.css';
import '../css/faq.css';
import '../css/responsive.css';

document.addEventListener('DOMContentLoaded', () => {
  // ─── Mobile Navigation ───
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('nav-menu');

  if (toggle && menu) {
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
  }

  // ─── Navbar scroll effect ───
  const navbar = document.getElementById('navbar');
  if (navbar) {
    const onScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── Admin Login nav link ───
  const adminNavLink = document.getElementById('faq-nav-admin-login');
  if (adminNavLink) {
    adminNavLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Redirect back to index with admin modal trigger
      window.location.href = '../index.html#admin-login';
    });
  }

  // ─── Reveal on scroll ───
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

  // ─── FAQ Items stagger-in on scroll ───
  const faqItems = document.querySelectorAll('.faq-item');
  const itemObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Stagger each item
          const allItems = Array.from(faqItems);
          const idx = allItems.indexOf(entry.target);
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, idx * 60);
          itemObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
  );
  faqItems.forEach(item => itemObserver.observe(item));

  // ─── Accordion Logic ───
  faqItems.forEach(item => {
    const btn = item.querySelector('.faq-question');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      // Close all other items
      faqItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('open');
          const otherBtn = other.querySelector('.faq-question');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current
      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // ─── Search Logic ───
  const searchInput = document.getElementById('faq-search');
  const clearBtn = document.getElementById('faq-search-clear');
  const noResults = document.getElementById('faq-no-results');

  function highlightText(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark class="faq-highlight">$1</mark>');
  }

  function doSearch(query) {
    const q = query.trim().toLowerCase();
    let visibleCount = 0;

    faqItems.forEach(item => {
      const questionEl = item.querySelector('.faq-question-text');
      const answerEl = item.querySelector('.faq-answer');
      if (!questionEl || !answerEl) return;

      const originalQuestion = item.dataset.question || questionEl.textContent;
      const originalAnswer = answerEl.dataset.originalText || answerEl.textContent;

      // Store original text once
      if (!answerEl.dataset.originalText) {
        answerEl.dataset.originalText = answerEl.textContent;
      }
      if (!item.dataset.question) {
        item.dataset.question = questionEl.textContent;
      }

      if (!q) {
        // Reset to original
        item.classList.remove('hidden-search');
        questionEl.textContent = originalQuestion;
        answerEl.innerHTML = originalAnswer;
        visibleCount++;
      } else {
        const matchQ = originalQuestion.toLowerCase().includes(q);
        const matchA = originalAnswer.toLowerCase().includes(q);

        if (matchQ || matchA) {
          item.classList.remove('hidden-search');
          questionEl.innerHTML = highlightText(originalQuestion, query.trim());
          answerEl.innerHTML = highlightText(originalAnswer, query.trim());

          // Auto-open matching items when searching
          if (!item.classList.contains('open')) {
            item.classList.add('open');
            const btn = item.querySelector('.faq-question');
            if (btn) btn.setAttribute('aria-expanded', 'true');
          }
          visibleCount++;
        } else {
          item.classList.add('hidden-search');
          item.classList.remove('open');
          const btn = item.querySelector('.faq-question');
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // No results
    if (noResults) {
      noResults.classList.toggle('visible', visibleCount === 0 && q.length > 0);
    }

    // Clear button
    if (clearBtn) {
      clearBtn.classList.toggle('visible', q.length > 0);
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      doSearch(e.target.value);
    });

    // Clear 'x' on search native clear (type="search")
    searchInput.addEventListener('search', (e) => {
      if (!e.target.value) doSearch('');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
        doSearch('');
      }
    });
  }
});
