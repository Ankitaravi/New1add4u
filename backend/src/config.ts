/** Fail fast at boot when a production deployment is missing required settings. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['DATABASE_URL', 'RAZORPAY_KEY_ID', 'RAZORPAY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
