// Profit Lab — web server: public site, Connect Jobber flow, free scan, reports.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('./src/db');
const jobber = require('./src/jobber');
const { runAnalysis } = require('./src/analysis');
const { buildNarrative } = require('./src/advice');
const { renderReport, renderPending, renderError } = require('./src/report');

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
  } catch (e) {
    console.error(`report ${reportId} failed:`, e.message);
    await db.failReport(reportId, e.message).catch(() => {});
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, service: 'profit-lab' }));

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
