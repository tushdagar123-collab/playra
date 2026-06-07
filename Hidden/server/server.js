/* ══════════════════════════════════════════
   PLAYRA — RAZORPAY PAYMENT SERVER
   ══════════════════════════════════════════ */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent directory (Hidden/.env)
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───
app.use(cors({ origin: true }));
app.use(express.json());

// ─── Razorpay Instance ───
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Plan Definitions ───
const PLANS = {
  monthly: {
    amount: 9900,       // ₹99 in paise
    currency: 'INR',
    name: 'Playra Monthly',
    description: 'Premium plan — 1 month',
  },
  premiumpass: {
    amount: 3900,       // ₹39 in paise
    currency: 'INR',
    name: 'Playra Premium Pass',
    description: 'Premium Pass — credit-based',
  },
};

// ─── POST /api/create-order ───
app.post('/api/create-order', async (req, res) => {
  try {
    const { plan } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({
        error: 'Invalid plan. Use "monthly" or "premiumpass".',
      });
    }

    const planInfo = PLANS[plan];

    const order = await razorpay.orders.create({
      amount: planInfo.amount,
      currency: planInfo.currency,
      receipt: `playra_${plan}_${Date.now()}`,
      notes: {
        plan_type: plan,
        plan_name: planInfo.name,
      },
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      plan_name: planInfo.name,
      plan_description: planInfo.description,
    });
  } catch (err) {
    console.error('[Razorpay] Order creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

// ─── POST /api/verify-payment ───
app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing payment details.' });
    }

    // Verify signature: HMAC SHA256 of "order_id|payment_id" using secret key
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const verified = expectedSignature === razorpay_signature;

    if (verified) {
      console.log(`[Razorpay] Payment verified: ${razorpay_payment_id}`);
      res.json({ verified: true, payment_id: razorpay_payment_id });
    } else {
      console.warn(`[Razorpay] Signature mismatch for order: ${razorpay_order_id}`);
      res.status(400).json({ verified: false, error: 'Payment verification failed.' });
    }
  } catch (err) {
    console.error('[Razorpay] Verification error:', err.message);
    res.status(500).json({ verified: false, error: 'Server error during verification.' });
  }
});

// ─── Health Check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start Server ───
app.listen(PORT, () => {
  console.log(`\n  ✓ Playra Payment Server running on http://localhost:${PORT}`);
  console.log(`  ✓ Razorpay Key ID: ${process.env.RAZORPAY_KEY_ID ? '***' + process.env.RAZORPAY_KEY_ID.slice(-6) : '⚠ NOT SET'}`);
  console.log(`  ✓ Razorpay Secret: ${process.env.RAZORPAY_KEY_SECRET ? '***configured' : '⚠ NOT SET'}\n`);
});
