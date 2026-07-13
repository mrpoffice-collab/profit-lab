// Daily job — run by Render Cron. For every active subscriber:
//  - Mondays: generate a fresh report and email the weekly digest link.
// Safe to run any day; it only acts when due, and never sends twice in one week.
const crypto = require('crypto');
const db = require('../src/db');
const { runAnalysis } = require('../src/analysis');
const { buildNarrative } = require('../src/advice');
const email = require('../src/email');

const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  await db.init();
  const isMonday = new Date().getUTCDay() === 1;
  const force = process.argv.includes('--force'); // manual test runs
  if (!isMonday && !force) {
    console.log('not digest day; nothing to do');
    await db.pool.end();
    return;
  }

  const subs = await db.activeSubscribers();
  console.log(`${subs.length} active subscriber(s)`);
  for (const account of subs) {
    try {
      if (!force && account.last_digest_at && (Date.now() - new Date(account.last_digest_at)) < 6 * DAY_MS) {
        console.log(`${account.name}: digest already sent this week`);
        continue;
      }
      console.log(`${account.name}: generating fresh report...`);
      const reportId = crypto.randomUUID();
      await db.createReport(reportId, account.id);
      const analysis = await runAnalysis(account);
      const narrative = await buildNarrative(analysis, account.name || 'this business');
      await db.finishReport(reportId, analysis, narrative);

      if (account.email) {
        await email.weeklyDigest({
          to: account.email,
          accountName: account.name,
          reportId,
          headline: narrative.headline,
          topFinding: narrative.findings?.[0],
        });
      } else {
        console.log(`${account.name}: no email on file — report generated, not sent`);
      }
      await db.markDigestSent(account.id);
    } catch (e) {
      console.error(`${account.name}: digest failed —`, e.message);
    }
  }
  await db.pool.end();
  console.log('daily job complete');
})().catch(e => { console.error('daily job crashed:', e.message); process.exit(1); });
