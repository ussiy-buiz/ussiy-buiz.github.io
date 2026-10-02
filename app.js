'use strict';
const KEY = 'cyphonic-usage-v1';
const $ = id => document.getElementById(id);
const empty = () => ({version:1, entries:[]});
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 50000) throw new Error('対応するバックアップではありません。');
  const entries = data.entries.map(e => {
    if (!e || !validDate(e.at) || !validDate(e.fiveReset) || !validDate(e.weekReset) || !['usage','five-reset','week-reset'].includes(e.kind) || ![e.five,e.week].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error('データの形式または値が不正です。');
    return {at:e.at,five:e.five,week:e.week,fiveReset:e.fiveReset,weekReset:e.weekReset,kind:e.kind};
  }).sort((a,b) => Date.parse(a.at)-Date.parse(b.at));
  return {version:1,entries};
}
let state = empty();
let storageBroken = false;
try { const raw = localStorage.getItem(KEY); if (raw) state = validate(JSON.parse(raw)); }
catch { storageBroken = true; $('storage-status').textContent = '保存データを読み込めません。元データ保護のため保存を停止しています。JSON復元で復旧できます。'; }
function save(next, restoring = false) {
  if (storageBroken && !restoring) { alert('保存データを読み込めないため保存できません。JSONバックアップから復元してください。'); return false; }
  try { localStorage.setItem(KEY,JSON.stringify(next)); state=next; storageBroken=false; $('storage-status').textContent='端末に保存しました'; render(); return true; }
  catch { alert('保存できませんでした。端末の空き容量やSafariの設定を確認してください。'); return false; }
}
const format = value => new Date(value).toLocaleString('ja-JP');
const localDate = value => { const d = new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
function rate(entries) {
  if (!entries.length) return null;
  let start=0;
  for (let i=1;i<entries.length;i++) if (entries[i].kind==='week-reset' || entries[i].week>entries[i-1].week || entries[i].weekReset!==entries[i-1].weekReset) start=i;
  const first=entries[start],last=entries.at(-1),hours=(Date.parse(last.at)-Date.parse(first.at))/3600000;
  return hours>0 && first.week>last.week ? (first.week-last.week)/hours : null;
}
function render(updateInputs = true) {
  const entries=state.entries,last=entries.at(-1),now=Date.now();
  for (const key of ['five','week']) {
    $(key+'-value').textContent=last ? last[key]+'%' : '—'; $(key+'-bar').value=last ? last[key] : 0;
    const reset=last && last[key+'Reset'];
    $(key+'-reset').textContent=reset ? 'リセット予定：'+format(reset)+(Date.parse(reset)<=now?'（予定時刻経過・再確認してください）':'') : 'リセット予定：未設定';
    $(key+'-count').textContent=entries.filter(e=>e.kind===key+'-reset').length;
    if(last && updateInputs){ $(key+'-input').value=last[key]; $(key+'-date').value=localDate(reset); }
  }
  const speed=rate(entries),exhaust=last && speed ? Date.parse(last.at)+last.week/speed*3600000 : null;
  $('forecast').textContent=last && last.week===0 ? '週間枠の枯渇予測：記録時点で枯渇' : exhaust ? '週間枠の枯渇予測：'+format(exhaust)+(exhaust<=now?'（予測時刻経過）':'')+' · '+speed.toFixed(2)+'% / 時間' : '週間枠の枯渇予測：消費速度を計算できる記録が不足しています';
  let decision='記録待ち',reason='残量とリセット予定を入力してください。';
  if(last){
    const stale=now-Date.parse(last.at)>5*3600000 || Date.parse(last.fiveReset)<=now || Date.parse(last.weekReset)<=now;
    const danger=last.five<=15 || last.week<=15 || (exhaust && exhaust<Date.parse(last.weekReset));
    decision=stale?'計画運用':danger?'温存':last.five>=50 && last.week>=50?'GO':'計画運用';
    reason=stale?'記録が5時間以上前、またはリセット予定時刻を経過しています。最新の残量を確認してください。':danger?'残量が15%以下、または現在の消費速度では週間リセット前に枯渇する見込みです。':'両枠50%以上ならGO、それ以外は計画運用。重い研究作業の実行判断を補助する目安です。';
  }
  $('decision').textContent=decision; $('reason').textContent=reason;
  $('history').replaceChildren();
  for(const e of entries.slice(-100).reverse()) { const tr=document.createElement('tr'); for(const value of [format(e.at),e.five+'%',e.week+'%',{'usage':'使用量','five-reset':'5時間リセット','week-reset':'週間リセット'}[e.kind]]) {const td=document.createElement('td');td.textContent=value;tr.append(td);} $('history').append(tr); }
  $('history-count').textContent='全'+entries.length+'件（最新100件を表示）';
  drawChart(entries,now);
}
function drawChart(entries,now) {
  const svg=$('chart');svg.replaceChildren();
  const add=(tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(text!==undefined)node.textContent=text;svg.append(node);};
  const start=now-7*86400000;
  for(const n of [0,50,100]){const y=180-n*1.5;add('line',{x1:40,y1:y,x2:625,y2:y,stroke:'#33445b'});add('text',{x:2,y:y+5,fill:'#a9b8cd','font-size':12},n);}
  add('text',{x:40,y:210,fill:'#a9b8cd','font-size':12},new Date(start).toLocaleDateString('ja-JP'));add('text',{x:625,y:210,fill:'#a9b8cd','text-anchor':'end','font-size':12},'現在');
  let previous=null;
  for(const e of entries.filter(e=>Date.parse(e.at)>=start && Date.parse(e.at)<=now)) {
    const x=40+(Date.parse(e.at)-start)/(now-start)*585,y=180-e.week*1.5;
    if(previous && e.week<=previous.e.week && e.kind!=='week-reset' && e.weekReset===previous.e.weekReset)add('line',{x1:previous.x,y1:previous.y,x2:x,y2:y,stroke:'#64ded0','stroke-width':3});
    add('circle',{cx:x,cy:y,r:4,fill:'#64ded0'});previous={e,x,y};
  }
  if(!previous)add('text',{x:320,y:105,'text-anchor':'middle',fill:'#a9b8cd','font-size':16},'使用量を保存するとグラフを表示します');
}
$('entry-form').addEventListener('submit',event=>{
  event.preventDefault();
  const e={at:new Date().toISOString(),five:Number($('five-input').value),week:Number($('week-input').value),fiveReset:new Date($('five-date').value).toISOString(),weekReset:new Date($('week-date').value).toISOString(),kind:'usage'};
  if(Date.parse(e.fiveReset)<=Date.now() || Date.parse(e.weekReset)<=Date.now()){alert('次回リセットには未来の日時を指定してください。');return;}
  save(validate({version:1,entries:[...state.entries,e]}));
});
document.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',()=>{
  const last=state.entries.at(-1),key=button.dataset.reset;
  if(!last){alert('先に使用量を保存してください。');return;}
  const input=$(key+'-date');
  if(!input.value || !Number.isFinite(new Date(input.value).getTime()) || new Date(input.value).getTime()<=Date.now()){alert('入力欄で次回リセットを未来の日時に更新してください。');input.focus();return;}
  if(!confirm('実際にリセットされたことを確認しましたか？ '+(key==='five'?'5時間':'週間')+'枠を100%にしてリセット回数を1回増やします。'))return;
  const e={...last,at:new Date().toISOString(),[key]:100,[key+'Reset']:new Date(input.value).toISOString(),kind:key+'-reset'};
  save(validate({version:1,entries:[...state.entries,e]}));
}));
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('backup').addEventListener('click',()=>download(JSON.stringify(state,null,2),'application/json','cyphonic-backup-'+new Date().toISOString().slice(0,10)+'.json'));
$('csv').addEventListener('click',()=>{
  const rows=[['recorded_at','five_remaining_percent','week_remaining_percent','five_reset_at','week_reset_at','kind'],...state.entries.map(e=>[e.at,e.five,e.week,e.fiveReset,e.weekReset,e.kind])];
  download('\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8','cyphonic-usage.csv');
});
$('restore').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>20*1024*1024)throw new Error('ファイルは20MB以下にしてください。');const next=validate(JSON.parse(await file.text()));if(confirm(next.entries.length+'件の記録で現在のデータを置き換えますか？'))save(next,true);}
  catch(error){alert('復元できませんでした：'+error.message);}finally{event.target.value='';}
});
render();setInterval(()=>render(false),60000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{$('storage-status').textContent='オフライン対応を有効にできませんでした。オンラインで再度開いてください。';});
