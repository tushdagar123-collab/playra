/* ══════════════════════════════════════════
   PLAYRA — AUTH SYSTEM (Firebase Auth)
   ══════════════════════════════════════════ */

import { auth, db } from './firebase-config.js';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { initPremium, resetPremium, applyPremiumBadge } from './premium-service.js';
import { initAccountView } from './account-service.js';
import { checkOnboarding } from './onboarding.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';

import {
  showToast, openModal, closeModal, closeAllModals,
  showDashboard, hideDashboard, simulateLoading,
  showFormError, clearFormErrors
} from './utils.js';

// ─── Google Auth Provider ───
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ─── Current user state ───
let _currentUser = null;

export function getCurrentUser() {
  return _currentUser;
}

/**
 * Shared Google Sign-In handler.
 * @param {'host'|'admin'|'signup'} context - Which modal triggered sign-in.
 * @param {function} setLoggedInNav - Callback to update nav visibility.
 * @param {string}   errorId         - ID of the error container element.
 */
async function handleGoogleSignIn(context, setLoggedInNav, errorId) {
  const btn = document.getElementById(
    context === 'host'   ? 'btn-google-host'
  : context === 'admin'  ? 'btn-google-admin'
  :                        'btn-google-signup'
  );

  if (!btn) return;

  // Loading state
  const originalLabel = btn.innerHTML;
  btn.classList.add('loading');
  btn.innerHTML = '<span></span> Signing in…';

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user   = result.user;

    // ── Firestore: create or fetch user doc ──
    const userDocRef = doc(db, 'users', user.uid);
    const userSnap   = await getDoc(userDocRef);

    if (userSnap.exists()) {
      // Existing user — check block status
      const data = userSnap.data();
      if (data.status === 'blocked') {
        await signOut(auth);
        throw { code: 'auth/user-blocked', message: 'Your account has been blocked by the administrator.' };
      }

      // Admin context: enforce role
      if (context === 'admin' && data.role !== 'admin') {
        await signOut(auth);
        throw { code: 'auth/unauthorized', message: 'Access denied: You do not have administrator permissions.' };
      }
    } else {
      // New user — determine role and write doc
      const isAdmin = (context === 'admin' && user.email === 'admin@playra.com');

      if (context === 'admin' && !isAdmin) {
        await signOut(auth);
        throw { code: 'auth/unauthorized', message: 'Access denied: You do not have administrator permissions.' };
      }

      await setDoc(userDocRef, {
        uid:          user.uid,
        displayName:  user.displayName || user.email.split('@')[0],
        email:        user.email,
        photoURL:     user.photoURL || null,
        role:         isAdmin ? 'admin' : 'user',
        status:       'active',
        authProvider: 'google',
        createdAt:    serverTimestamp(),
        userPlan:     'free',
        planExpiresAt: null,
        teamBattleCount: 0
      });
    }

    // ── Success: update state & route ──
    _currentUser = user;
    btn.classList.remove('loading');
    btn.innerHTML = originalLabel;
    closeAllModals();
    setLoggedInNav(true);

    if (context === 'admin') {
      showDashboard('overlay-admin-panel');
      if (window.checkOverlayAdminPermissions) window.checkOverlayAdminPermissions();
      showToast('Admin access granted. Welcome to the Admin Panel.');
    } else {
      const dashUser = document.getElementById('dashboard-user');
      if (dashUser) {
        dashUser.textContent = `👋 Welcome, ${user.displayName || user.email}!`;
        applyPremiumBadge();
      }
      showDashboard('overlay-quiz-dashboard');
      // Initialize premium state after dashboard is shown
      initPremium(user.uid);
      initAccountView();
      showToast(context === 'signup'
        ? 'Account created with Google! Welcome to Playra.'
        : 'Signed in with Google! Welcome back.'
      );
      // Show onboarding wizard for new users
      checkOnboarding(user);
    }

  } catch (err) {
    btn.classList.remove('loading');
    btn.innerHTML = originalLabel;

    const code = err.code || '';
    // Silently ignore user-dismissed popups
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;

    let message;
    if (code === 'auth/user-blocked' || code === 'auth/unauthorized') {
      message = err.message;
    } else if (code === 'auth/account-exists-with-different-credential') {
      message = 'An account already exists with this email using a different sign-in method. Please use your email and password.';
    } else if (code === 'auth/popup-blocked') {
      message = 'Pop-up was blocked by your browser. Please allow pop-ups for this site and try again.';
    } else if (code === 'auth/network-request-failed') {
      message = 'Network error. Please check your connection and try again.';
    } else {
      message = err.message || 'Google sign-in failed. Please try again.';
    }
    showFormError(errorId, message, []);
  }
}

export function initAuth() {
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('nav-menu');

  // ─── Nav link visibility manager ───
  const navAdminLogin = document.getElementById('nav-admin-login');
  const navSignup = document.getElementById('nav-signup');
  const navLogout = document.getElementById('nav-logout');

  function setLoggedInNav(show) {
    if (navAdminLogin) navAdminLogin.parentElement.style.display = show ? 'none' : '';
    if (navSignup) navSignup.parentElement.style.display = show ? 'none' : '';
    if (navLogout) navLogout.style.display = show ? '' : 'none';
  }

  // ─── Firebase Auth State Listener ───
  onAuthStateChanged(auth, (user) => {
    _currentUser = user;
    if (user) {
      setLoggedInNav(true);
      // Ensure premium state is always loaded on page load/refresh,
      // not only after an explicit login action.
      initPremium(user.uid);
      initAccountView();
    } else {
      setLoggedInNav(false);
    }
  });

  // ─── HOST QUIZ (Hero button → Login Modal → Dashboard) ───
  const btnHostQuiz = document.getElementById('btn-host-quiz');
  if (btnHostQuiz) {
    btnHostQuiz.addEventListener('click', (e) => {
      e.preventDefault();

      const isUserAdmin = _currentUser && _currentUser.email === 'admin@playra.com';
      if (window.maintenanceModeActive && !isUserAdmin) {
        showToast('Playra is currently undergoing maintenance. Hosting quizzes is temporarily disabled.', 'error');
        return;
      }

      // If already logged in, go straight to dashboard
      if (_currentUser) {
        const dashUser = document.getElementById('dashboard-user');
        if (dashUser) {
          dashUser.textContent = `👋 Welcome, ${_currentUser.displayName || _currentUser.email}!`;
          applyPremiumBadge();
        }
        showDashboard('overlay-quiz-dashboard');
        return;
      }
      openModal('overlay-host-login');
    });
  }

  // Host login form submission
  const formHostLogin = document.getElementById('form-host-login');
  if (formHostLogin) {
    formHostLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('host-email').value.trim();
      const password = document.getElementById('host-password').value;
      const btn = document.getElementById('btn-host-login-submit');
      const errorId = 'host-login-error';
      const inputIds = ['host-email', 'host-password'];

      clearFormErrors(errorId, inputIds);

      if (!email || !password) {
        showFormError(errorId, 'Please fill in all fields.', inputIds);
        return;
      }

      const original = btn.innerHTML;
      btn.classList.add('loading');
      btn.innerHTML = '<span></span> Please wait…';

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Check block status and sync user record in Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.status === 'blocked') {
            await signOut(auth);
            throw { code: 'auth/user-blocked', message: 'Your account has been blocked by the administrator.' };
          }
        } else {
          // Sync missing user record
          await setDoc(userDocRef, {
            uid: user.uid,
            displayName: user.displayName || user.email.split('@')[0],
            email: user.email,
            role: user.email === 'admin@playra.com' ? 'admin' : 'user',
            status: 'active',
            createdAt: serverTimestamp(),
            userPlan: 'free',
            planExpiresAt: null,
            teamBattleCount: 0
          });
        }

        _currentUser = user;
        btn.classList.remove('loading');
        btn.innerHTML = original;
        closeAllModals();
        const dashUser = document.getElementById('dashboard-user');
        if (dashUser) {
          dashUser.textContent = `👋 Welcome, ${user.displayName || user.email}!`;
          applyPremiumBadge();
        }
        showDashboard('overlay-quiz-dashboard');
        setLoggedInNav(true);
        initPremium(user.uid);
        initAccountView();
        showToast('Logged in successfully! Welcome to your dashboard.');
        // Show onboarding wizard for new users
        checkOnboarding(user);
      } catch (err) {
        btn.classList.remove('loading');
        btn.innerHTML = original;
        const code = err.code || '';
        if (code === 'auth/user-blocked') {
          showFormError(errorId, err.message || 'Your account has been blocked.', []);
        } else if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          showFormError(errorId, 'Account not found. Please sign up first.', ['host-email']);
        } else if (code === 'auth/wrong-password') {
          showFormError(errorId, 'Incorrect password. Please try again.', ['host-password']);
        } else if (code === 'auth/invalid-email') {
          showFormError(errorId, 'Invalid email format.', ['host-email']);
        } else if (code === 'auth/too-many-requests') {
          showFormError(errorId, 'Too many attempts. Please try again later.', []);
        } else {
          showFormError(errorId, err.message || 'Login failed. Please try again.', []);
        }
      }
    });
  }

  // Close host login modal
  const closeHostLogin = document.getElementById('close-host-login');
  if (closeHostLogin) {
    closeHostLogin.addEventListener('click', () => closeModal('overlay-host-login'));
  }

  // "Don't have an account?" → Switch to Sign Up
  const hostToSignup = document.getElementById('host-to-signup');
  if (hostToSignup) {
    hostToSignup.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllModals();
      setTimeout(() => openModal('overlay-signup'), 200);
    });
  }

  // ─── ADMIN LOGIN (Nav → Modal → Admin Panel) ───
  if (navAdminLogin) {
    navAdminLogin.addEventListener('click', (e) => {
      e.preventDefault();
      if (menu) menu.classList.remove('open');
      if (toggle) toggle.classList.remove('active');
      openModal('overlay-admin-login');
    });
  }

  const formAdminLogin = document.getElementById('form-admin-login');
  if (formAdminLogin) {
    formAdminLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('admin-email').value.trim();
      const password = document.getElementById('admin-password').value;
      const btn = document.getElementById('btn-admin-login-submit');
      const errorId = 'admin-login-error';
      const inputIds = ['admin-email', 'admin-password'];

      clearFormErrors(errorId, inputIds);

      if (!email || !password) {
        showFormError(errorId, 'Please fill in all fields.', inputIds);
        return;
      }

      const original = btn.innerHTML;
      btn.classList.add('loading');
      btn.innerHTML = '<span></span> Please wait…';

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Verify if user is admin in Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);
        let isAdmin = false;

        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.status === 'blocked') {
            await signOut(auth);
            throw { code: 'auth/user-blocked', message: 'Your account has been blocked by the administrator.' };
          }
          isAdmin = (userData.role === 'admin');
        } else {
          // Default role checking
          isAdmin = (user.email === 'admin@playra.com');
          // Create user doc
          await setDoc(userDocRef, {
            uid: user.uid,
            displayName: user.displayName || 'Administrator',
            email: user.email,
            role: isAdmin ? 'admin' : 'user',
            status: 'active',
            createdAt: serverTimestamp(),
            userPlan: 'free',
            planExpiresAt: null,
            teamBattleCount: 0
          });
        }

        if (!isAdmin) {
          await signOut(auth);
          throw { code: 'auth/unauthorized', message: 'Access denied: You do not have administrator permissions.' };
        }

        _currentUser = user;
        btn.classList.remove('loading');
        btn.innerHTML = original;
        closeAllModals();
        showDashboard('overlay-admin-panel');
        if (window.checkOverlayAdminPermissions) {
          window.checkOverlayAdminPermissions();
        }
        setLoggedInNav(true);
        showToast('Admin access granted. Welcome to the Admin Panel.');
      } catch (err) {
        btn.classList.remove('loading');
        btn.innerHTML = original;
        const code = err.code || '';
        if (code === 'auth/user-blocked' || code === 'auth/unauthorized') {
          showFormError(errorId, err.message, []);
        } else if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          showFormError(errorId, 'Account not found. Please sign up first.', ['admin-email']);
        } else if (code === 'auth/wrong-password') {
          showFormError(errorId, 'Incorrect password. Please try again.', ['admin-password']);
        } else {
          showFormError(errorId, err.message || 'Login failed.', []);
        }
      }
    });
  }

  const closeAdminLogin = document.getElementById('close-admin-login');
  if (closeAdminLogin) {
    closeAdminLogin.addEventListener('click', () => closeModal('overlay-admin-login'));
  }

  // ─── SIGN UP ───
  if (navSignup) {
    navSignup.addEventListener('click', (e) => {
      e.preventDefault();
      if (menu) menu.classList.remove('open');
      if (toggle) toggle.classList.remove('active');
      openModal('overlay-signup');
    });
  }

  const formSignup = document.getElementById('form-signup');
  if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const btn = document.getElementById('btn-signup-submit');
      const errorId = 'signup-error';
      const inputIds = ['signup-name', 'signup-email', 'signup-password'];

      clearFormErrors(errorId, inputIds);

      if (!name || !email || !password) {
        showFormError(errorId, 'Please fill in all fields.', inputIds);
        return;
      }
      if (password.length < 8) {
        showFormError(errorId, 'Password must be at least 8 characters.', ['signup-password']);
        return;
      }

      const original = btn.innerHTML;
      btn.classList.add('loading');
      btn.innerHTML = '<span></span> Please wait…';

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });

        // Write user document to Firestore users collection
        const userDocRef = doc(db, 'users', userCredential.user.uid);
        await setDoc(userDocRef, {
          uid: userCredential.user.uid,
          displayName: name,
          email: email,
          role: email === 'admin@playra.com' ? 'admin' : 'user',
          status: 'active',
          createdAt: serverTimestamp(),
          userPlan: 'free',
          planExpiresAt: null,
          teamBattleCount: 0
        });

        _currentUser = userCredential.user;

        btn.classList.remove('loading');
        btn.innerHTML = original;
        closeAllModals();
        showToast('Account created successfully! You can now log in.', 'success');
        // Auto-log them in and show dashboard
        setTimeout(() => {
          const dashUser = document.getElementById('dashboard-user');
          if (dashUser) {
            dashUser.textContent = `👋 Welcome, ${name}!`;
            applyPremiumBadge();
          }
          showDashboard('overlay-quiz-dashboard');
          setLoggedInNav(true);
          initPremium(userCredential.user.uid);
          initAccountView();
          // Show onboarding wizard for new users
          checkOnboarding(userCredential.user);
        }, 300);
      } catch (err) {
        btn.classList.remove('loading');
        btn.innerHTML = original;
        const code = err.code || '';
        if (code === 'auth/email-already-in-use') {
          showFormError(errorId, 'An account with this email already exists. Please log in.', ['signup-email']);
        } else if (code === 'auth/invalid-email') {
          showFormError(errorId, 'Invalid email format.', ['signup-email']);
        } else if (code === 'auth/weak-password') {
          showFormError(errorId, 'Password is too weak. Use at least 8 characters.', ['signup-password']);
        } else {
          showFormError(errorId, err.message || 'Sign up failed. Please try again.', []);
        }
      }
    });
  }

  const closeSignup = document.getElementById('close-signup');
  if (closeSignup) {
    closeSignup.addEventListener('click', () => closeModal('overlay-signup'));
  }

  // "Already have an account?" → Switch to Host Login
  const signupToLogin = document.getElementById('signup-to-login');
  if (signupToLogin) {
    signupToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllModals();
      setTimeout(() => openModal('overlay-host-login'), 200);
    });
  }

  // "Don't have an account?" on Admin Login
  const adminToSignup = document.getElementById('admin-to-signup');
  if (adminToSignup) {
    adminToSignup.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllModals();
      setTimeout(() => openModal('overlay-signup'), 200);
    });
  }

  // ─── CLOSE MODALS on overlay background click ───
  document.querySelectorAll('.auth-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // ─── CLOSE MODALS on Escape key ───
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // ─── Auto-clear errors on input focus ───
  document.querySelectorAll('.auth-form input').forEach(input => {
    input.addEventListener('focus', () => {
      const form = input.closest('.auth-form');
      if (form) {
        const errorDiv = form.querySelector('.auth-error');
        if (errorDiv) { errorDiv.textContent = ''; errorDiv.classList.remove('visible'); }
        form.querySelectorAll('.input-error').forEach(w => w.classList.remove('input-error'));
      }
    });
  });

  // ─── DASHBOARD LOGOUT HANDLERS ───
  const btnDashboardLogout = document.getElementById('btn-dashboard-logout');
  if (btnDashboardLogout) {
    btnDashboardLogout.addEventListener('click', async () => {
      await signOut(auth);
      _currentUser = null;
      resetPremium();
      hideDashboard('overlay-quiz-dashboard');
      setLoggedInNav(false);
      showToast('You have been logged out.');
    });
  }

  const btnAdminLogout = document.getElementById('btn-admin-logout');
  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', async () => {
      await signOut(auth);
      _currentUser = null;
      resetPremium();
      hideDashboard('overlay-admin-panel');
      setLoggedInNav(false);
      showToast('Admin session ended.');
    });
  }

  // Nav logout button
  if (navLogout) {
    navLogout.addEventListener('click', async (e) => {
      e.preventDefault();
      if (menu) menu.classList.remove('open');
      if (toggle) toggle.classList.remove('active');
      await signOut(auth);
      _currentUser = null;
      resetPremium();
      hideDashboard('overlay-quiz-dashboard');
      hideDashboard('overlay-admin-panel');
      setLoggedInNav(false);
      showToast('You have been logged out.');
    });
  }

  // Dashboard logo clicks → go back to main page
  const dashboardLogo = document.getElementById('dashboard-logo');
  if (dashboardLogo) {
    dashboardLogo.addEventListener('click', (e) => {
      e.preventDefault();
      hideDashboard('overlay-quiz-dashboard');
      setLoggedInNav(false);
    });
  }

  const adminLogo = document.getElementById('admin-logo');
  if (adminLogo) {
    adminLogo.addEventListener('click', (e) => {
      e.preventDefault();
      hideDashboard('overlay-admin-panel');
      setLoggedInNav(false);
    });
  }

  // ─── GOOGLE SIGN-IN BUTTONS ───
  const btnGoogleHost = document.getElementById('btn-google-host');
  if (btnGoogleHost) {
    btnGoogleHost.addEventListener('click', () =>
      handleGoogleSignIn('host', setLoggedInNav, 'host-login-error')
    );
  }

  const btnGoogleAdmin = document.getElementById('btn-google-admin');
  if (btnGoogleAdmin) {
    btnGoogleAdmin.addEventListener('click', () =>
      handleGoogleSignIn('admin', setLoggedInNav, 'admin-login-error')
    );
  }

  const btnGoogleSignup = document.getElementById('btn-google-signup');
  if (btnGoogleSignup) {
    btnGoogleSignup.addEventListener('click', () =>
      handleGoogleSignIn('signup', setLoggedInNav, 'signup-error')
    );
  }
}
