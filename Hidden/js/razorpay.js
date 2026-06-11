/* ══════════════════════════════════════════
   PLAYRA — RAZORPAY CHECKOUT MODULE
   ══════════════════════════════════════════ */

import { showToast } from './utils.js';
import { auth } from './firebase-config.js';
import { activatePremium, closeUpgradeModal, initUpgradeModalBindings } from './premium-service.js';
import { storePaymentRecord } from './account-service.js';

// ─── Load Razorpay Checkout Script ───
let razorpayScriptLoaded = false;

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (razorpayScriptLoaded || window.Razorpay) {
      razorpayScriptLoaded = true;
      return resolve();
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      razorpayScriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
    document.head.appendChild(script);
  });
}

// ─── Plan Configuration ───
const PLAN_CONFIG = {
  monthly: {
    label:         'Monthly Premium',
    displayAmount: '₹99/month',
  },
  premiumpass: {
    label:         'Premium Pass',
    displayAmount: '₹39 one-time',
  },
};

// ─── Set Premium UI State ───
function setPremiumState(plan) {
  // Store in sessionStorage (temporary, clears on browser close)
  sessionStorage.setItem('playra_premium', JSON.stringify({
    active: true,
    plan,
    activatedAt: new Date().toISOString(),
  }));

  // Update pricing cards to show "Active" state
  const cardMap = {
    monthly:     '#pricing-monthly',
    premiumpass: '#pricing-premiumpass',
  };

  const activeCard = document.querySelector(cardMap[plan]);
  if (activeCard) {
    activeCard.classList.add('pricing-card--active');

    // Swap CTA button to "Active" badge
    const btn = activeCard.querySelector('.btn[data-plan]');
    if (btn) {
      btn.classList.add('btn--premium-active');
      btn.innerHTML = '<span class="premium-check-icon">✓</span> Plan Active';
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
    }
  }
}

// ─── Check & Restore Premium UI ───
function restorePremiumState() {
  try {
    const data = JSON.parse(sessionStorage.getItem('playra_premium'));
    if (data?.active) {
      setPremiumState(data.plan);
    }
  } catch { /* ignore */ }
}

// ─── Handle Payment Flow ───
async function handlePayment(plan, btn) {
  if (!PLAN_CONFIG[plan]) {
    showToast('Unknown plan selected.', 'error');
    return;
  }

  // Save original button state
  const originalHTML = btn.innerHTML;
  const originalDisabled = btn.disabled;

  try {
    // Show loading state on button
    btn.disabled = true;
    btn.classList.add('btn--loading');
    btn.innerHTML = '<span class="btn-spinner"></span> Processing…';

    // Load Razorpay SDK if not already loaded
    await loadRazorpayScript();

    // Create order on backend
    const orderRes = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });

    if (!orderRes.ok) {
      const errData = await orderRes.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create order');
    }

    const orderData = await orderRes.json();

    // Reset button before opening popup
    btn.disabled = originalDisabled;
    btn.classList.remove('btn--loading');
    btn.innerHTML = originalHTML;

    // Get user email for prefill (if logged in via Firebase)
    const userEmail = auth.currentUser?.email || '';
    const userName = auth.currentUser?.displayName || '';

    // Open Razorpay Checkout
    const options = {
      key: orderData.key_id,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'Playra',
      description: orderData.plan_description,
      order_id: orderData.order_id,
      image: '',  // Can add Playra logo URL here
      prefill: {
        name: userName,
        email: userEmail,
      },
      theme: {
        color: '#635bff',
        backdrop_color: 'rgba(26, 26, 46, 0.85)',
      },
      modal: {
        ondismiss: () => {
          showToast('Payment cancelled.', 'error');
        },
      },
      handler: async (response) => {
        // Payment successful on Razorpay's end — verify on our backend
        try {
          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });

          const verifyData = await verifyRes.json();

          if (verifyData.verified) {
            showToast(`🎉 Payment successful! ${PLAN_CONFIG[plan].label} is now active.`, 'success');
            setPremiumState(plan);

            // Map Razorpay plan key → Firestore plan name
            const firestorePlan = plan === 'premiumpass' ? 'premiumPass' : 'monthly';
            await activatePremium(firestorePlan);

            // Store payment record in Firestore for billing history
            if (auth.currentUser) {
              storePaymentRecord({
                userId: auth.currentUser.uid,
                paymentId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                plan: firestorePlan,
                amount: orderData.amount,
                currency: orderData.currency,
              });
            }

            closeUpgradeModal();
          } else {
            showToast('Payment verification failed. Contact support.', 'error');
          }
        } catch (verifyErr) {
          console.error('[Razorpay] Verification request failed:', verifyErr);
          showToast('Could not verify payment. Contact support.', 'error');
        }
      },
    };

    const rzp = new window.Razorpay(options);

    // Handle payment failure
    rzp.on('payment.failed', (failResponse) => {
      console.error('[Razorpay] Payment failed:', failResponse.error);
      showToast(`Payment failed: ${failResponse.error.description}`, 'error');
    });

    rzp.open();
  } catch (err) {
    console.error('[Razorpay] Error:', err);
    showToast(err.message || 'Something went wrong. Please try again.', 'error');

    // Restore button
    btn.disabled = originalDisabled;
    btn.classList.remove('btn--loading');
    btn.innerHTML = originalHTML;
  }
}

// ─── Initialize Razorpay Bindings ───
export function initRazorpay() {
  // Bind click handlers to pricing CTA buttons
  const paymentButtons = document.querySelectorAll('[data-plan]');

  paymentButtons.forEach((btn) => {
    const plan = btn.dataset.plan;
    if (!plan || !PLAN_CONFIG[plan]) return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handlePayment(plan, btn);
    });
  });

  // Restore premium state from sessionStorage (if user already paid this session)
  restorePremiumState();

  // Initialize upgrade modal event listeners
  initUpgradeModalBindings();

  // Wire upgrade modal plan buttons to handlePayment
  const premiumBtnMonthly = document.getElementById('premium-btn-monthly');


  if (premiumBtnMonthly) {
    premiumBtnMonthly.addEventListener('click', (e) => {
      e.preventDefault();
      handlePayment('monthly', premiumBtnMonthly);
    });
  }

  const premiumBtnPremiumPass = document.getElementById('premium-btn-premiumpass');
  if (premiumBtnPremiumPass) {
    premiumBtnPremiumPass.addEventListener('click', (e) => {
      e.preventDefault();
      handlePayment('premiumpass', premiumBtnPremiumPass);
    });
  }

  // Preload Razorpay script when user hovers over pricing section
  const pricingSection = document.getElementById('pricing');
  if (pricingSection) {
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadRazorpayScript().catch(() => {});
          preloadObserver.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    preloadObserver.observe(pricingSection);
  }
}
