/* ══════════════════════════════════════════
   PLAYRA — VERCEL SERVERLESS: HEALTH CHECK
   ══════════════════════════════════════════ */

export default function handler(req, res) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    razorpay_key_configured: !!keyId,
    razorpay_secret_configured: !!keySecret,
    razorpay_key_hint: keyId ? `***${keyId.slice(-6)}` : 'NOT SET',
    environment: process.env.VERCEL_ENV || 'unknown',
  });
}
