/* ══════════════════════════════════════════
   PLAYRA — VERCEL SERVERLESS: VERIFY PAYMENT
   ══════════════════════════════════════════ */

import crypto from 'crypto';

export default function handler(req, res) {
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

  // ─── Validate Razorpay Secret ───
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) {
    console.error('[Razorpay] Missing env var: RAZORPAY_KEY_SECRET');
    return res.status(500).json({ verified: false, error: 'Payment service not configured.' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ verified: false, error: 'Missing payment details.' });
  }

  try {
    // HMAC SHA256 of "order_id|payment_id" using secret key
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const verified = expectedSignature === razorpay_signature;

    if (verified) {
      console.log(`[Razorpay] Payment verified: ${razorpay_payment_id}`);
      return res.status(200).json({ verified: true, payment_id: razorpay_payment_id });
    } else {
      console.warn(`[Razorpay] Signature mismatch for order: ${razorpay_order_id}`);
      return res.status(400).json({ verified: false, error: 'Payment verification failed.' });
    }
  } catch (err) {
    console.error('[Razorpay] Verification error:', err.message);
    return res.status(500).json({ verified: false, error: 'Server error during verification.' });
  }
}
