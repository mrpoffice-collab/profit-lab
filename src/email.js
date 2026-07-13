// Email — Resend REST API, zero dependencies.
// Until the sending domain is verified, FROM falls back to Resend's onboarding
// sender (which can only reach the Resend account owner — fine for testing).
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Profit Lab <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:4700';

async function send({ to, subject, html }) {
  if (!KEY) {
    console.log(`[email disabled] would send "${subject}" to ${to}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  console.log(`email sent to ${to}: ${subject}`);
  return data;
}

const wrap = (inner) => `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:20px;font-weight:700;color:#16324f;margin-bottom:18px;">Profit<span style="color:#0e7a4e;"> Lab</span></div>
    ${inner}
    <div style="border-top:1px solid #d8dee6;margin-top:28px;padding-top:14px;font-family:Arial,sans-serif;font-size:12px;color:#333d4d;">
      Profit Lab — a Code63 Labs product. You're receiving this because your Jobber account is connected to Profit Lab.
    </div>
  </div>`;

function reportReady({ to, accountName, reportId, headline }) {
  return send({
    to,
    subject: `Your Profit Truth Report is ready — ${accountName}`,
    html: wrap(`
      <h1 style="font-size:24px;color:#16324f;margin:0 0 12px;">Your numbers have spoken.</h1>
      <p style="font-family:Arial,sans-serif;color:#141a24;line-height:1.6;">${headline || 'Your Profit Truth Report is ready to read.'}</p>
      <a href="${APP_URL}/r/${reportId}" style="display:inline-block;background:#0e7a4e;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:6px;font-family:Arial,sans-serif;margin-top:8px;">Read your full report</a>
      <p style="font-family:Arial,sans-serif;color:#333d4d;font-size:13px;margin-top:16px;">Keep this email — the link above is your private report.</p>
    `),
  });
}

function weeklyDigest({ to, accountName, reportId, headline, topFinding }) {
  return send({
    to,
    subject: `This week's profit truth — ${accountName}`,
    html: wrap(`
      <h1 style="font-size:24px;color:#16324f;margin:0 0 12px;">This week's truth.</h1>
      <p style="font-family:Arial,sans-serif;color:#141a24;line-height:1.6;">${headline}</p>
      ${topFinding ? `<div style="border-left:4px solid #0e7a4e;background:#e8f4ee;padding:12px 16px;margin:14px 0;font-family:Arial,sans-serif;color:#141a24;"><strong>${topFinding.title}</strong><br>${topFinding.action || ''}</div>` : ''}
      <a href="${APP_URL}/r/${reportId}" style="display:inline-block;background:#0e7a4e;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:6px;font-family:Arial,sans-serif;margin-top:8px;">See the full report</a>
    `),
  });
}

module.exports = { send, reportReady, weeklyDigest };
