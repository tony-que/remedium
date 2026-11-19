// Plain-text email through Resend's HTTP API, for admin alerts. Uses the same
// key and sender as the magic-link sign-in (AUTH_RESEND_KEY, EMAIL_FROM).

export const emailConfigured = () => Boolean(process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM);

export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: boolean; reason?: string }> {
  if (to.length === 0) return { sent: false, reason: "no recipients" };
  if (!emailConfigured()) {
    console.warn(`Email not configured (AUTH_RESEND_KEY, EMAIL_FROM); would have sent "${subject}" to ${to.join(", ")}`);
    return { sent: false, reason: "email not configured" };
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) {
    const reason = `Resend HTTP ${res.status}`;
    console.error(`Email "${subject}" failed: ${reason}`);
    return { sent: false, reason };
  }
  return { sent: true };
}
