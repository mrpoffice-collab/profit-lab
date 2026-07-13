// End-to-end test: seed the Camdenton sandbox account into the real DB,
// run the full pipeline (pull -> analyze -> Claude narrative -> store), print report id.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, '../../engine/tokens.json'), 'utf8'));

const db = require('../src/db');
const { runAnalysis } = require('../src/analysis');
const { buildNarrative } = require('../src/advice');

(async () => {
  await db.init();
  console.log('schema ok');

  const account = await db.upsertAccount({
    jobberAccountId: 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjUwNDIxNw==',
    name: 'Camdenton Lawn Care',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
  console.log('account seeded, id', account.id);

  const reportId = crypto.randomUUID();
  await db.createReport(reportId, account.id);

  console.log('pulling + analyzing...');
  const analysis = await runAnalysis(account);
  console.log(`analysis: ${analysis.jobCount} jobs, ${Math.round(analysis.totals.laborHours)} hours, $${Math.round(analysis.totals.revenue)} revenue`);

  console.log('asking Opus 4.8 for the narrative...');
  const narrative = await buildNarrative(analysis, account.name);
  console.log('headline:', narrative.headline.slice(0, 120) + '...');
  console.log('findings:', narrative.findings.length);

  await db.finishReport(reportId, analysis, narrative);
  console.log('REPORT_ID=' + reportId);
  await db.pool.end();
})().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
