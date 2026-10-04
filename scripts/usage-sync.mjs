import crypto from 'node:crypto';
import fs from 'node:fs';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE = 'https://auth.openai.com';
const USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const AUTH_FILE = 'private-auth.enc';
const DATA_FILE = 'usage-data.enc';
const MAX_ENTRIES = 4032; // 14 days at five-minute cadence.

const mode = process.argv[2] || 'sync';
const authSecret = (process.env.USAGE_AUTH_KEY || '').trim();
const viewSecret = (process.env.USAGE_VIEW_KEY || '').trim();

function requireSecrets() {
  if (authSecret.length < 32 || viewSecret.length < 32) {
    throw new Error('USAGE_AUTH_KEY / USAGE_VIEW_KEY must both be configured as repository Actions secrets (32+ characters).');
  }
}

function keyFrom(secret, purpose) {
  return crypto.createHash('sha256').update(`${purpose}\0${secret}`, 'utf8').digest();
}

function encryptJson(value, secret, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret, purpose), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: ciphertext.toString('base64url'),
  });
}

function decryptJson(raw, secret, purpose) {
  const envelope = JSON.parse(raw);
  if (envelope?.v !== 1 || envelope?.alg !== 'A256GCM') throw new Error('Unsupported encrypted state format.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', keyFrom(secret, purpose), Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return {};
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}

function accountIdFromIdToken(idToken) {
  const claims = decodeJwt(idToken);
  return claims?.['https://api.openai.com/auth']?.chatgpt_account_id || null;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${new URL(url).pathname} did not return JSON`); }
}

async function refreshTokens(refreshToken) {
  const payload = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!payload.access_token) throw new Error('Token refresh did not return an access token.');
  return payload;
}

async function fetchUsage(accessToken, accountId) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    'user-agent': 'ussiy-usage-dashboard/1.0',
  };
  if (accountId) headers['chatgpt-account-id'] = accountId;
  return requestJson(USAGE_URL, { headers });
}

function normalizeUsage(payload) {
  const rate = payload?.rate_limit || payload?.rate_limits?.rate_limit || payload?.rate_limits;
  const primary = rate?.primary_window;
  const secondary = rate?.secondary_window;
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const pUsed = number(primary?.used_percent);
  const sUsed = number(secondary?.used_percent);
  const pReset = number(primary?.reset_at);
  const sReset = number(secondary?.reset_at);
  if (pUsed == null || sUsed == null) throw new Error('Usage response did not contain primary/secondary used_percent.');
  const toIso = seconds => seconds ? new Date(seconds * 1000).toISOString() : null;
  return {
    capturedAt: new Date().toISOString(),
    fiveRemaining: Math.max(0, Math.min(100, 100 - pUsed)),
    weekRemaining: Math.max(0, Math.min(100, 100 - sUsed)),
    fiveResetAt: toIso(pReset),
    weekResetAt: toIso(sReset),
    confidence: 1,
    source: 'cloud-codex-usage',
  };
}

function loadEntries() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const data = decryptJson(fs.readFileSync(DATA_FILE, 'utf8'), viewSecret, 'usage-view');
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    throw new Error('Could not decrypt usage-data.enc. Check USAGE_VIEW_KEY.');
  }
}

function saveState(auth, entry) {
  const entries = [...loadEntries(), entry].slice(-MAX_ENTRIES);
  fs.writeFileSync(AUTH_FILE, encryptJson(auth, authSecret, 'usage-auth') + '\n');
  fs.writeFileSync(DATA_FILE, encryptJson({ version: 3, entries }, viewSecret, 'usage-view') + '\n');
  console.log(`Saved cloud usage snapshot: five=${entry.fiveRemaining}% week=${entry.weekRemaining}%`);
}

async function bootstrap() {
  requireSecrets();
  const userCode = await requestJson(USER_CODE_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  const deviceAuthId = userCode.device_auth_id;
  const code = userCode.user_code || userCode.usercode;
  const interval = Math.max(1, Number(userCode.interval) || 5);
  if (!deviceAuthId || !code) throw new Error('Device login did not return a usable code.');

  const summary = process.env.GITHUB_STEP_SUMMARY;
  const message = [
    '## ChatGPT Usage cloud login', '',
    '1. Open **https://auth.openai.com/codex/device** on your phone.',
    `2. Enter this one-time code: **${code}**`,
    '3. Approve the login. This Actions run will continue automatically.', '',
    '> The code expires in about 15 minutes. Do not share it.',
  ].join('\n');
  if (summary) fs.appendFileSync(summary, message + '\n');
  console.log('Device authorization requested. Open the workflow Summary to get the one-time code.');

  const deadline = Date.now() + 15 * 60 * 1000;
  let approved;
  while (Date.now() < deadline) {
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: code }),
    });
    if (response.ok) { approved = await response.json(); break; }
    if (![403, 404].includes(response.status)) throw new Error(`Device authorization returned HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
  }
  if (!approved) throw new Error('Device authorization timed out. Run bootstrap again.');

  const form = new URLSearchParams({
    grant_type: 'authorization_code', client_id: CLIENT_ID,
    code: approved.authorization_code,
    redirect_uri: `${AUTH_BASE}/deviceauth/callback`,
    code_verifier: approved.code_verifier,
  });
  const tokens = await requestJson(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  });
  if (!tokens.access_token || !tokens.refresh_token) throw new Error('Login token exchange was incomplete.');
  const accountId = accountIdFromIdToken(tokens.id_token);
  const usage = normalizeUsage(await fetchUsage(tokens.access_token, accountId));
  saveState({ refreshToken: tokens.refresh_token, accountId, updatedAt: new Date().toISOString() }, usage);
}

async function sync() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.log('Cloud sync is not bootstrapped yet; skipping scheduled run.');
    return;
  }
  requireSecrets();
  let auth;
  try { auth = decryptJson(fs.readFileSync(AUTH_FILE, 'utf8'), authSecret, 'usage-auth'); }
  catch { throw new Error('Could not decrypt private-auth.enc. Check USAGE_AUTH_KEY.'); }
  if (!auth?.refreshToken) throw new Error('Encrypted auth state is missing a refresh token.');

  const tokens = await refreshTokens(auth.refreshToken);
  const refreshToken = tokens.refresh_token || auth.refreshToken;
  const accountId = accountIdFromIdToken(tokens.id_token) || auth.accountId || null;
  const usage = normalizeUsage(await fetchUsage(tokens.access_token, accountId));
  saveState({ refreshToken, accountId, updatedAt: new Date().toISOString() }, usage);
}

try {
  if (mode === 'bootstrap') await bootstrap();
  else if (mode === 'sync') await sync();
  else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  console.error(`Usage sync failed: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
}
