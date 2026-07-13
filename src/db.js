// Database layer — Postgres via pg. Schema auto-initializes on boot.
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Render external hostnames need SSL; internal ones don't.
const ssl = /render\.com/.test(url) ? { rejectUnauthorized: false } : false;
const pool = new Pool({ connectionString: url, ssl, max: 5 });

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      jobber_account_id TEXT UNIQUE NOT NULL,
      name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reports (
      id UUID PRIMARY KEY,
      account_id INT REFERENCES accounts(id),
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      narrative JSONB,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;
  `);
}

async function upsertAccount({ jobberAccountId, name, accessToken, refreshToken }) {
  const r = await pool.query(
    `INSERT INTO accounts (jobber_account_id, name, access_token, refresh_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (jobber_account_id)
     DO UPDATE SET name = $2, access_token = $3, refresh_token = $4, updated_at = now()
     RETURNING *`,
    [jobberAccountId, name, accessToken, refreshToken]
  );
  return r.rows[0];
}

async function saveTokens(accountId, accessToken, refreshToken) {
  await pool.query(
    `UPDATE accounts SET access_token = $2, refresh_token = $3, updated_at = now() WHERE id = $1`,
    [accountId, accessToken, refreshToken]
  );
}

async function getAccount(id) {
  const r = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [id]);
  return r.rows[0];
}

async function createReport(id, accountId) {
  await pool.query(`INSERT INTO reports (id, account_id) VALUES ($1, $2)`, [id, accountId]);
}

async function finishReport(id, payload, narrative) {
  await pool.query(
    `UPDATE reports SET status = 'ready', payload = $2, narrative = $3, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(payload), JSON.stringify(narrative)]
  );
}

async function failReport(id, error) {
  await pool.query(
    `UPDATE reports SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
    [id, String(error).slice(0, 2000)]
  );
}

async function getReport(id) {
  const r = await pool.query(
    `SELECT reports.*, accounts.name AS account_name, accounts.subscription_status, accounts.plan AS account_plan FROM reports
     LEFT JOIN accounts ON accounts.id = reports.account_id WHERE reports.id = $1`,
    [id]
  );
  return r.rows[0];
}

async function setSubscription(accountId, { customerId, subscriptionId, status, plan }) {
  await pool.query(
    `UPDATE accounts SET stripe_customer_id = COALESCE($2, stripe_customer_id),
       stripe_subscription_id = COALESCE($3, stripe_subscription_id),
       subscription_status = $4, plan = COALESCE($5, plan), updated_at = now()
     WHERE id = $1`,
    [accountId, customerId, subscriptionId, status, plan]
  );
}

async function setEmail(accountId, email) {
  if (!email) return;
  await pool.query('UPDATE accounts SET email = $2, updated_at = now() WHERE id = $1', [accountId, email]);
}

async function activeSubscribers() {
  const r = await pool.query("SELECT * FROM accounts WHERE subscription_status = 'active'");
  return r.rows;
}

async function markDigestSent(accountId) {
  await pool.query('UPDATE accounts SET last_digest_at = now() WHERE id = $1', [accountId]);
}

async function setSubscriptionByCustomer(customerId, status) {
  await pool.query(
    `UPDATE accounts SET subscription_status = $2, updated_at = now() WHERE stripe_customer_id = $1`,
    [customerId, status]
  );
}

async function createState(state) {
  await pool.query(`INSERT INTO oauth_states (state) VALUES ($1)`, [state]);
}

async function consumeState(state) {
  const r = await pool.query(
    `DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '30 minutes' RETURNING state`,
    [state]
  );
  return r.rowCount === 1;
}

module.exports = { pool, init, upsertAccount, saveTokens, getAccount, createReport, finishReport, failReport, getReport, createState, consumeState, setSubscription, setSubscriptionByCustomer, setEmail, activeSubscribers, markDigestSent };
