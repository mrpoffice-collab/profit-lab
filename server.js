// Profit Lab — web server: public site, Connect Jobber flow, free scan, reports.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('./src/db');
const jobber = require('./src/jobber');
const stripe = require('./src/stripe');
const { runAnalysis } = require('./src/analysis');
const { buildNarrative } = require('./src/advice');
const { renderReport, renderPending, renderError } = require('./src/report');
const email = require('./src/email');
const { runDaily } = require('./jobs/daily');

const PORT = process.env.PORT || 4700;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}
const sendHtml = (res, status, body) => send(res, status, 'text/html; charset=utf-8', body);

async function generateReport(reportId, accountId) {
  try {
    const account = await db.getAccount(accountId);
    const analysis = await runAnalysis(account);
    const narrative = await buildNarrative(analysis, account.name || 'this business');
    await db.finishReport(reportId, analysis, narrative);
    console.log(`report ${reportId} ready for account ${accountId}`);
    const fresh = await db.getAccount(accountId);
    if (fresh.email) {
      email.reportReady({ to: fresh.email, accountName: fresh.name, reportId, headline: narrative.headline }).catch(e => console.error('report email failed:', e.message));
    }
  } catch (e) {
    console.error(`report ${reportId} failed:`, e.message);
    await db.failReport(reportId, e.message).catch(() => {});
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, service: 'profit-lab' }));

  // --- Scheduled job trigger (called by GitHub Actions daily) ---
  if (p === '/jobs/daily') {
    if (!process.env.JOB_SECRET || url.searchParams.get('key') !== process.env.JOB_SECRET) {
      return send(res, 403, 'text/plain', 'forbidden');
    }
    const force = url.searchParams.get('force') === '1';
    runDaily({ force }).catch(e => console.error('daily run failed:', e.message));
    return send(res, 202, 'application/json', '{"started":true}');
  }

  // --- Connect Jobber (start OAuth) ---
  if (p === '/connect') {
    const state = crypto.randomUUID();
    await db.createState(state);
    res.writeHead(302, { Location: jobber.authUrl(state) });
    return res.end();
  }

  // --- OAuth callback from Jobber ---
  if (p === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) { res.writeHead(302, { Location: url.searchParams.get('error') === 'access_denied' ? '/' : '/connect' }); return res.end(); }
    if (state && !(await db.consumeState(state))) {
      { res.writeHead(302, { Location: '/connect' }); return res.end(); }
    }
    try {
      const tokens = await jobber.exchangeCode(code);
      const info = await jobber.rawGraphql(tokens.access_token, `query { account { id name } }`);
      const parsed = JSON.parse(info.body);
      const acct = parsed.data.account;
      const account = await db.upsertAccount({
        jobberAccountId: acct.id, name: acct.name,
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      });
      const reportId = crypto.randomUUID();
      await db.createReport(reportId, account.id);
      generateReport(reportId, account.id); // async — page polls
      res.writeHead(302, { Location: `/r/${reportId}` });
      return res.end();
    } catch (e) {
      console.error('callback failed:', e.message);
      return sendHtml(res, 500, renderError('The connection to Jobber did not complete. ' + e.message.slice(0, 120)));
    }
  }

  // --- Subscribe: create Stripe Checkout from a report ---
  if (p === '/subscribe') {
    const reportId = url.searchParams.get('report');
    const plan = url.searchParams.get('plan') === 'standard' ? 'standard' : 'founding';
    const report = reportId ? await db.getReport(reportId) : null;
    if (!report) return sendHtml(res, 404, renderError('Start with a free scan so we know which business is subscribing.'));
    try {
      const session = await stripe.createCheckoutSession({ accountId: report.account_id, reportId, plan });
      res.writeHead(302, { Location: session.url });
      return res.end();
    } catch (e) {
      console.error('subscribe failed:', e.message);
      return sendHtml(res, 500, renderError('Checkout could not start. ' + e.message.slice(0, 120)));
    }
  }

  // --- After successful checkout ---
  if (p === '/welcome') {
    const sessionId = url.searchParams.get('session_id');
    try {
      const session = await stripe.retrieveSession(sessionId);
      if (session.payment_status === 'paid' && session.metadata?.account_id) {
        await db.setSubscription(Number(session.metadata.account_id), {
          customerId: session.customer,
          subscriptionId: session.subscription,
          status: 'active',
          plan: session.metadata.plan,
        });
        await db.setEmail(Number(session.metadata.account_id), session.customer_details?.email);
      }
      const back = session.metadata?.report_id ? `/r/${session.metadata.report_id}` : '/';
      return sendHtml(res, 200, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Welcome to Profit Lab</title>
        <style>body{font-family:Georgia,serif;background:#16324f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;}
        .box{max-width:520px;padding:40px;} h1{font-size:34px;margin-bottom:14px;} p{font-family:"Segoe UI",Arial,sans-serif;color:#d7e0ea;line-height:1.6;}
        a{display:inline-block;margin-top:22px;background:#0e7a4e;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:6px;font-family:"Segoe UI",Arial,sans-serif;}</style></head>
        <body><div class="box"><h1>You're in.</h1>
        <p>Welcome to Profit Lab${session.metadata?.plan === 'founding' ? ' as a founding member — your rate is locked forever' : ''}. Right now you have full access to your Profit Truth Report, and you can reconnect for a fresh one anytime. Weekly digests and monthly deep reports are rolling out to founding members first — you will be emailed the day yours turns on.</p>
        <a href="${back}">Back to your report</a></div></body></html>`);
    } catch (e) {
      console.error('welcome failed:', e.message);
      return sendHtml(res, 500, renderError('We could not confirm the subscription. If you were charged, email us and we will fix it immediately.'));
    }
  }

  // --- Stripe webhook (renewals, cancellations) ---
  if (p === '/stripe/webhook' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      try {
        if (!stripe.verifyWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
          return send(res, 400, 'text/plain', 'bad signature');
        }
        const event = JSON.parse(raw);
        if (event.type === 'checkout.session.completed') {
          const s = event.data.object;
          if (s.metadata?.account_id) {
            await db.setSubscription(Number(s.metadata.account_id), {
              customerId: s.customer, subscriptionId: s.subscription, status: 'active', plan: s.metadata.plan,
            });
            await db.setEmail(Number(s.metadata.account_id), s.customer_details?.email);
          }
        } else if (event.type === 'customer.subscription.deleted') {
          await db.setSubscriptionByCustomer(event.data.object.customer, 'canceled');
        } else if (event.type === 'customer.subscription.updated') {
          const sub = event.data.object;
          await db.setSubscriptionByCustomer(sub.customer, sub.status === 'active' ? 'active' : sub.status);
        }
        send(res, 200, 'application/json', '{"received":true}');
      } catch (e) {
        console.error('webhook error:', e.message);
        send(res, 500, 'text/plain', 'error');
      }
    });
    return;
  }

  // --- Report pages ---
  const reportMatch = p.match(/^\/r\/([0-9a-f-]{36})$/);
  if (reportMatch) {
    const report = await db.getReport(reportMatch[1]);
    if (!report) return sendHtml(res, 404, renderError('Report not found.'));
    if (report.status === 'pending') return sendHtml(res, 200, renderPending(report.id));
    if (report.status === 'error') return sendHtml(res, 200, renderError('We could not finish reading this account: ' + (report.error || 'unknown error')));
    return sendHtml(res, 200, renderReport(report));
  }

  // --- Static site ---
  const ROUTES = { '/': 'index.html', '/demo': 'demo.html' };
  const mapped = ROUTES[p] || p.slice(1);
  const filePath = path.join(PUBLIC_DIR, mapped);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain', 'Forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) return sendHtml(res, 404, '<h1 style="font-family:sans-serif">404 — <a href="/">Profit Lab home</a></h1>');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, MIME[ext] || 'application/octet-stream', data);
  });
}

db.init().then(() => {
  http.createServer((req, res) => {
    handle(req, res).catch(e => {
      console.error('request error:', e);
      try { sendHtml(res, 500, renderError('Unexpected error.')); } catch {}
    });
  }).listen(PORT, () => console.log(`Profit Lab listening on ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
