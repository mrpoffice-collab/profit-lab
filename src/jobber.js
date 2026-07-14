// Jobber API client — multi-tenant. Each connected business has its own tokens.
const db = require('./db');

const API_VERSION = '2025-01-20';
const CLIENT_ID = process.env.JOBBER_CLIENT_ID;
const CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:4700';

function authUrl(state) {
  return (
    'https://api.getjobber.com/api/oauth/authorize' +
    `?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(APP_URL + '/callback')}` +
    `&state=${state}`
  );
}

async function tokenRequest(params) {
  const res = await fetch('https://api.getjobber.com/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jobber token endpoint ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function exchangeCode(code) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: APP_URL + '/callback' });
}

function refresh(refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

async function rawGraphql(accessToken, query, variables = {}) {
  const res = await fetch('https://api.getjobber.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-JOBBER-GRAPHQL-VERSION': API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.text() };
}

// GraphQL for a connected account, with automatic token refresh + persistence.
async function graphql(account, query, variables = {}) {
  let { status, body } = await rawGraphql(account.access_token, query, variables);
  if (status === 401) {
    const fresh = await refresh(account.refresh_token);
    account.access_token = fresh.access_token;
    if (fresh.refresh_token) account.refresh_token = fresh.refresh_token;
    await db.saveTokens(account.id, account.access_token, account.refresh_token);
    ({ status, body } = await rawGraphql(account.access_token, query, variables));
  }
  if (status !== 200) throw new Error(`Jobber GraphQL HTTP ${status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  if (parsed.errors) throw new Error(`Jobber GraphQL errors: ${JSON.stringify(parsed.errors).slice(0, 500)}`);
  return parsed.data;
}

async function appDisconnect(account) {
  const d = await graphql(account, `mutation { appDisconnect { app { name } userErrors { message } } }`);
  const errs = d.appDisconnect?.userErrors;
  if (errs && errs.length) throw new Error('appDisconnect: ' + JSON.stringify(errs));
  return true;
}

module.exports = { authUrl, exchangeCode, refresh, rawGraphql, graphql, appDisconnect };
