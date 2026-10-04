'use strict';

const $ = id => document.getElementById(id);
const SETTINGS = 'cyphonic-cloud-usage-v3';
const CACHE = 'cyphonic-cloud-usage-cache-v3';
const STATE_BASE = 'https://raw.githubusercontent.com/ussiy-buiz/ussiy-buiz.github.io/usage-cloud-state';
const DATA_URL = `${STATE_BASE}/usage-data.enc`;
const BOOTSTRAP_URL = `${STATE_BASE}/bootstrap.enc`;
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
    const response = await fetch(`${BOOTSTRAP_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (response.status === 404) {
      panel.hidden = true;
      return false;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pending = await decryptEnvelope(await response.text(), secret, 'usage-bootstrap');
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
    return false;
  }
}

async function sync() {
  const secret = settings().viewKey || '';
  if (!secret) {
    $('sync-badge').textContent = '要設定';
    $('sync-status').textContent = '表示キーを保存すると、PCなしのクラウド同期データを読めます。';
    return;
  }

  await refreshBootstrapState(secret);

  try {
    $('sync-status').textContent = 'クラウドデータ確認中…';
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (response.status === 404) {
      $('sync-badge').textContent = '認証待ち';
      $('sync-status').textContent = '初回認証中です。認証コードが表示されている場合はChatGPTで承認してください。';
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await decryptEnvelope(await response.text(), secret);
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
  saveSettings({ viewKey });
  $('sync-status').textContent = '表示キーをこの端末に保存しました。';
  sync();
};
$('sync-now').onclick = sync;
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
try { entries = JSON.parse(localStorage.getItem(CACHE) || '[]'); } catch { entries = []; }
render();
sync();
setInterval(sync, 60_000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
