/* ══════════════════════════════════════════
   PLAYRA — VERCEL SERVERLESS: CREATE ORDER
   ══════════════════════════════════════════ */

import Razorpay from 'razorpay';

// ─── Plan Definitions ───
const PLANS = {
  monthly: {
    amount: 9900,        // ₹99 in paise
    currency: 'INR',
    name: 'Playra Monthly',
    description: 'Premium plan — 1 month',
  },
  premiumpass: {
    amount: 3900,        // ₹39 in paise
    currency: 'INR',
    name: 'Playra Premium Pass',
    description: 'Premium Pass — credit-based',
  },
};

export default async function handler(req, res) {
  // ─── CORS Headers ───
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ─── Validate Razorpay Keys ───
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error('[Razorpay] Missing env vars: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
    return res.status(500).json({ error: 'Payment service not configured. Contact support.' });
  }

  // ─── Validate Plan ───
  const { plan } = req.body || {};

  if (!plan || !PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Use "monthly" or "premiumpass".' });
  }

  const planInfo = PLANS[plan];

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await razorpay.orders.create({
      amount: planInfo.amount,
      currency: planInfo.currency,
      receipt: `playra_${plan}_${Date.now()}`,
      notes: {
        plan_type: plan,
        plan_name: planInfo.name,
      },
    });

    console.log(`[Razorpay] Order created: ${order.id} (plan: ${plan})`);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId,
      plan_name: planInfo.name,
      plan_description: planInfo.description,
    });
  } catch (err) {
    console.error('[Razorpay] Order creation failed:', err.message, err.statusCode);
    return res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
}
