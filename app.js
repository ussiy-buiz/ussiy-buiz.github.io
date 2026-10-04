'use strict';

const $ = id => document.getElementById(id);
const SETTINGS = 'cyphonic-cloud-usage-v3';
const CACHE = 'cyphonic-cloud-usage-cache-v3';
const STATE_BASE = 'https://raw.githubusercontent.com/ussiy-buiz/ussiy-buiz.github.io/usage-cloud-state';
const DATA_URL = `${STATE_BASE}/usage-data.enc`;
const BOOTSTRAP_URL = `${STATE_BASE}/bootstrap.enc`;
const BOOTSTRAP_API = 'https://api.github.com/repos/ussiy-buiz/ussiy-buiz.github.io/contents/bootstrap.enc?ref=usage-cloud-state';
const USAGE_API = 'https://api.github.com/repos/ussiy-buiz/ussiy-buiz.github.io/contents/usage-data.enc?ref=usage-cloud-state';
const WORKFLOW_DISPATCH_API = 'https://api.github.com/repos/ussiy-buiz/ussiy-buiz.github.io/actions/workflows/usage-sync.yml/dispatches';
let entries = [];

const settings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS) || '{}'); } catch { return {}; } };
const saveSettings = value => localStorage.setItem(SETTINGS, JSON.stringify(value));
const fmt = value => value ? new Date(value).toLocaleString('ja-JP') : '不明';
const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));

function rate(arr) {
  if (arr.length < 2) return null;
  let start = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].weekRemaining > arr[i - 1].weekRemaining + 1 || arr[i].weekResetAt !== arr[i - 1].weekResetAt) start = i;
  }
  const a = arr[start], b = arr.at(-1);
  const hours = (Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) / 36e5;
  return hours > 0 && a.weekRemaining > b.weekRemaining ? (a.weekRemaining - b.weekRemaining) / hours : null;
}

function burn24(arr) {
  const cutoff = Date.now() - 864e5;
  const recent = arr.filter(x => Date.parse(x.capturedAt) >= cutoff);
  if (recent.length < 2) return null;
  return Math.max(0, recent[0].weekRemaining - recent.at(-1).weekRemaining);
}

function dataAgeLabel(last) {
  if (!last) return '未取得';
  const ms = Math.max(0, Date.now() - Date.parse(last.capturedAt));
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '1分未満前';
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
}

function render() {
  const last = entries.at(-1);
  $('five-value').textContent = last ? `${Math.round(last.fiveRemaining)}%` : '—';
  $('week-value').textContent = last ? `${Math.round(last.weekRemaining)}%` : '—';
  $('five-bar').value = last ? clamp(last.fiveRemaining) : 0;
  $('week-bar').value = last ? clamp(last.weekRemaining) : 0;
  $('five-reset').textContent = `リセット：${fmt(last?.fiveResetAt)}`;
  $('week-reset').textContent = `リセット：${fmt(last?.weekResetAt)}`;
  $('confidence').textContent = last ? '100%' : '—';
  $('last-captured').textContent = last ? `${fmt(last.capturedAt)}（${dataAgeLabel(last)}）` : '—';

  const r = rate(entries), b24 = burn24(entries);
  $('burnRate').textContent = r ? `${r.toFixed(2)}%/h` : '—';
  $('burn24').textContent = b24 != null ? `${b24.toFixed(1)}%` : '—';
  const exhaust = last && r ? Date.parse(last.capturedAt) + last.weekRemaining / r * 36e5 : null;
  $('forecast').textContent = exhaust ? `週間枠の枯渇予測：${fmt(exhaust)}` : '枯渇予測：記録不足';

  let decision = 'データ待ち', reason = 'クラウド同期の初期設定を行ってください。';
  if (last) {
    const stale = Date.now() - Date.parse(last.capturedAt) > 20 * 60 * 1000;
    const danger = last.fiveRemaining <= 15 || last.weekRemaining <= 15 || (exhaust && last.weekResetAt && exhaust < Date.parse(last.weekResetAt));
    decision = stale ? '更新確認' : danger ? '温存' : last.fiveRemaining >= 50 && last.weekRemaining >= 50 ? 'GO' : '計画運用';
    reason = stale ? 'クラウドの最終取得が20分以上前です。Actionsの状態を確認してください。' : danger ? '残量が少ない、または週間リセット前に枯渇するペースです。' : 'PCなしで取得した最新の利用枠から判定しています。';
  }
  $('decision').textContent = decision;
  $('reason').textContent = reason;

  $('history').replaceChildren();
  entries.slice(-100).reverse().forEach(entry => {
    const tr = document.createElement('tr');
    [fmt(entry.capturedAt), `${Math.round(entry.fiveRemaining)}%`, `${Math.round(entry.weekRemaining)}%`, 'Cloud'].forEach(value => {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    });
    $('history').append(tr);
  });
  drawChart();
}

function drawChart() {
  const svg = $('chart'); svg.replaceChildren();
  const add = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text != null) node.textContent = text;
    svg.append(node);
  };
  const now = Date.now(), start = now - 7 * 864e5;
  [0, 50, 100].forEach(n => {
    const y = 180 - n * 1.5;
    add('line', { x1: 40, y1: y, x2: 625, y2: y, stroke: '#30445f' });
    add('text', { x: 6, y: y + 4, fill: '#91a5be', 'font-size': 12 }, n);
  });
  let prev = null;
  entries.filter(e => Date.parse(e.capturedAt) >= start).forEach(e => {
    const x = 40 + (Date.parse(e.capturedAt) - start) / (now - start) * 585;
    const y = 180 - e.weekRemaining * 1.5;
    if (prev && e.weekRemaining <= prev.e.weekRemaining + 1) add('line', { x1: prev.x, y1: prev.y, x2: x, y2: y, stroke: '#64ded0', 'stroke-width': 3 });
    add('circle', { cx: x, cy: y, r: 4, fill: '#64ded0' });
    prev = { e, x, y };
  });
  if (!prev) add('text', { x: 320, y: 110, 'text-anchor': 'middle', fill: '#91a5be' }, 'クラウド同期後に履歴を表示します');
}

function b64urlBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function fetchStateText(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.trim() ? text : null;
}

async function fetchGitHubContentText(url) {
  const response = await fetch(`${url}&t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.content) return null;
  const normalized = payload.content.replace(/\s+/g, '');
  return new TextDecoder().decode(b64urlBytes(normalized.replace(/\+/g, '-').replace(/\//g, '_')));
}

async function fetchBootstrapText() {
  return fetchGitHubContentText(BOOTSTRAP_API);
}

async function decryptEnvelope(raw, secret, purpose = 'usage-view') {
  const envelope = JSON.parse(raw);
  if (envelope?.v !== 1 || envelope?.alg !== 'A256GCM') throw new Error('未対応の暗号データです');
  const material = new TextEncoder().encode(`${purpose}\0${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
  const data = b64urlBytes(envelope.data), tag = b64urlBytes(envelope.tag);
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data); combined.set(tag, data.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlBytes(envelope.iv), tagLength: 128 }, key, combined);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function refreshBootstrapState(secret) {
  const panel = $('bootstrap-status');
  const code = $('bootstrap-code');
  const link = $('bootstrap-link');
  try {
    const raw = await fetchBootstrapText();
    if (!raw) {
      panel.hidden = true;
      return false;
    }
    let pending;
    try {
      pending = await decryptEnvelope(raw, secret, 'usage-bootstrap');
    } catch {
      throw new Error('表示キーがbootstrap作成時のUSAGE_VIEW_KEYと一致していません');
    }
    const expires = Date.parse(pending.expiresAt || '');
    if (!pending.userCode || !pending.verificationUrl || !Number.isFinite(expires)) {
      throw new Error('認証データが不完全です');
    }
    code.textContent = pending.userCode;
    link.href = pending.verificationUrl;
    $('bootstrap-expiry').textContent = new Date(expires).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    panel.hidden = false;
    return true;
  } catch (error) {
    panel.hidden = false;
    code.textContent = '取得失敗';
    $('bootstrap-expiry').textContent = '—';
    link.removeAttribute('href');
    const detail = $('bootstrap-error');
    if (detail) detail.textContent = error.message;
    return false;
  }
}

async function readCloudState() {
  const secret = settings().viewKey || '';
  if (!secret) {
    $('sync-badge').textContent = '要設定';
    $('sync-status').textContent = '表示キーを保存すると、PCなしのクラウド同期データを読めます。';
    return;
  }

  await refreshBootstrapState(secret);

  try {
    $('sync-status').textContent = 'クラウドデータ確認中…';
    const raw = await fetchGitHubContentText(USAGE_API);
    if (!raw) {
      $('sync-badge').textContent = '認証待ち';
      $('sync-status').textContent = 'まだUsageデータはありません。初回ChatGPT認証を完了してください。';
      return;
    }
    const data = await decryptEnvelope(raw, secret);
    entries = Array.isArray(data.entries) ? data.entries : [];
    localStorage.setItem(CACHE, JSON.stringify(entries));
    $('sync-badge').textContent = 'クラウド同期';
    $('sync-status').textContent = `最新データを取得しました：${new Date().toLocaleString('ja-JP')}`;
    render();
  } catch (error) {
    $('sync-badge').textContent = '同期確認';
    $('sync-status').textContent = `取得できません：${error.message}`;
    try { entries = JSON.parse(localStorage.getItem(CACHE) || '[]'); render(); } catch { /* ignore cache errors */ }
  }
}

function randomKey() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

$('save-key').onclick = () => {
  const viewKey = $('view-key').value.trim();
  if (viewKey.length < 32) { $('sync-status').textContent = '表示キーは32文字以上にしてください。'; return; }
  saveSettings({ ...settings(), viewKey });
  $('sync-status').textContent = '表示キーをこの端末に保存しました。';
  readCloudState();
};
let refreshPromise = null;

async function dispatchUsageSync() {
  const token = settings().githubToken || '';
  if (!token) throw new Error('GitHub Actionsトークンを保存してください');
  const response = await fetch(WORKFLOW_DISPATCH_API, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { mode: 'sync' } }),
  });
  if (response.status !== 204) {
    let detail = '';
    try { detail = (await response.json())?.message || ''; } catch {}
    throw new Error(`Actions起動失敗 HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}

function latestCapturedMs() {
  const value = entries.at(-1)?.capturedAt;
  return value ? Date.parse(value) : 0;
}

async function refreshUsage(source = 'manual') {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const before = latestCapturedMs();
    $('sync-badge').textContent = '更新中';
    $('sync-status').textContent = source === 'open' ? 'アプリ起動：最新Usageを取得中…' : '最新Usageを取得中…';
    await dispatchUsageSync();

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      await readCloudState();
      const after = latestCapturedMs();
      if (after > before) {
        $('sync-badge').textContent = '最新';
        $('sync-status').textContent = `更新完了：${new Date().toLocaleString('ja-JP')}`;
        return true;
      }
    }
    $('sync-badge').textContent = '処理中';
    $('sync-status').textContent = 'Actionsは起動済みです。少し待ってからもう一度更新してください。';
    return false;
  })().catch(error => {
    $('sync-badge').textContent = '更新失敗';
    $('sync-status').textContent = error.message;
    return false;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

$('sync-now').onclick = () => refreshUsage('manual');
$('save-github-token').onclick = () => {
  const githubToken = $('github-token').value.trim();
  if (githubToken.length < 20) {
    $('sync-status').textContent = 'GitHub Actionsトークンを入力してください。';
    return;
  }
  saveSettings({ ...settings(), githubToken });
  $('sync-status').textContent = 'ActionsトークンをこのiPhoneに保存しました。';
};

$('generate-setup').onclick = () => {
  const authKey = randomKey(), viewKey = randomKey();
  $('generated-auth-key').value = authKey;
  $('generated-view-key').value = viewKey;
  $('view-key').value = viewKey;
  saveSettings({ viewKey });
  $('setup-result').hidden = false;
};
for (const button of document.querySelectorAll('[data-copy]')) {
  button.onclick = async () => {
    const input = $(button.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    button.textContent = 'コピー済み';
    setTimeout(() => { button.textContent = 'コピー'; }, 1200);
  };
}

const current = settings();
$('view-key').value = current.viewKey || '';
$('github-token').value = current.githubToken || '';
try { entries = JSON.parse(localStorage.getItem(CACHE) || '[]'); } catch { entries = []; }
render();
readCloudState().then(() => {
  if (settings().viewKey && settings().githubToken) refreshUsage('open');
});
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else if (hiddenAt && Date.now() - hiddenAt > 60_000 && settings().viewKey && settings().githubToken) {
    refreshUsage('open');
  }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
