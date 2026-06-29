// Client helper: POST a notification to the /api/notify serverless function,
// which emails CONTACT_EMAIL via Resend. Fails silently so the app keeps
// working even if email is down or running on a host without the function.
export async function notify(type, data = {}) {
  try {
    const r = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...data }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
