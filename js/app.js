import { encodeText, decodeCode, parseGroups, pad4, lookupChar, pageEntries, stats } from './telecode.js';
import { HaoKey, encrypt, decrypt, randomSecret, describePos, PAD_SIZE } from './hao.js';
import * as morse from './morse.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 本机存储（可能不可用） ----
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---- 主题 ----
const THEMES = {
  spy: {
    title: '暗线 · 豪密电台', subtitle: 'CLASSIFIED · 绝密 · 阅后即焚',
    formHead: '明 码 电 报', formHead2: '绝 密 电 报', formHead3: '译 电 · 限 本 人 阅',
    stamp: '绝密', color: '#0c0e0d', other: '二战',
  },
  ww2: {
    title: '战地电报局', subtitle: 'FIELD TELEGRAPH · 1942',
    formHead: '电 报 纸', formHead2: '急 电 · 密 码', formHead3: '译 电 纸',
    stamp: '急电', color: '#3d4426', other: '谍报',
  },
};
function applyTheme(name) {
  const t = THEMES[name] ? name : 'spy';
  document.documentElement.dataset.theme = t;
  for (const el of $$('[data-t]')) el.textContent = THEMES[t][el.dataset.t];
  $('meta[name="theme-color"]').content = THEMES[t].color;
  $('#themeBtn').textContent = THEMES[t].other;
  for (const b of $$('#themeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.v === t));
  store.set('hm.theme', t);
}
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'spy' ? 'ww2' : 'spy');
for (const b of $$('#themeSeg button')) b.onclick = () => applyTheme(b.dataset.v);

// ---- 提示 ----
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ---- 视图切换 ----
function go(view) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  for (const s of $$('.view')) s.hidden = s.id !== `view-${view}`;
  store.set('hm.view', view);
  if (view === 'book') renderBook();
  if (view === 'key') renderPad();
  if (view === 'encrypt') updatePosHint();
  window.scrollTo({ top: 0 });
}
for (const b of $$('.tabs button')) b.onclick = () => go(b.dataset.view);
for (const b of $$('[data-go]')) b.onclick = () => go(b.dataset.go);

// ---- 分组排版 ----
const lines = (groups, per = 5) => {
  const out = [];
  for (let i = 0; i < groups.length; i += per) out.push(groups.slice(i, i + per).map(pad4).join(' '));
  return out.join('\n');
};

async function copy(text) {
  if (!text) return toast('没有可复制的内容');
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('已复制');
  }
}
async function share(text) {
  if (!text) return toast('没有可分享的内容');
  if (navigator.share) { try { await navigator.share({ text }); } catch { /* 取消 */ } }
  else copy(text);
}

// ---- 拍发 ----
const lamp = $('#lamp');
async function transmit(btn, groups, container) {
  if (morse.isPlaying()) { morse.stop(); return; }
  if (!groups.length) return toast('没有可拍发的电码');
  const cells = container ? [...container.querySelectorAll('[data-g]')] : [];
  btn.textContent = '■ 停止';
  try {
    await morse.play(groups, {
      wpm: +$('#wpm').value, tone: +$('#tone').value,
      onKey: (on) => lamp.classList.toggle('on', on),
      onGroup: (i) => cells.forEach((c) => c.classList.toggle('tx', +c.dataset.g === i)),
    });
  } catch { toast('无法播放声音', 'warn'); }
  btn.textContent = '▶ 拍发';
}

// ================= 明码 =================
const cv = { codes: [], text: '', mode: 'encode' };
const isCodeInput = (s) => /\d/.test(s) && !/[\p{Script=Han}A-Za-z]/u.test(s);

function convert() {
  const src = $('#cvIn').value;
  const grid = $('#cvGrid');
  const plain = $('#cvPlain');
  if (!src.trim()) { grid.innerHTML = '<p class="empty">结果将显示于此</p>'; plain.hidden = true; $('#cvStat').textContent = ''; cv.codes = []; cv.text = ''; return; }
  const trad = $('#cvTrad').checked;
  if (isCodeInput(src)) {
    cv.mode = 'decode';
    const { groups, bad } = parseGroups(src);
    const items = groups.map((g) => ({ code: g, ...decodeCode(g, { traditional: trad }) }));
    cv.codes = groups;
    cv.text = items.map((x) => x.ch ?? `[${pad4(x.code)}]`).join('');
    grid.innerHTML = items.map((x, i) => cell(x.ch, x.code, i, x.ch === null, x.ext)).join('');
    plain.hidden = false; plain.textContent = cv.text;
    $('#cvOutTitle').textContent = '译文';
    const miss = items.filter((x) => x.ch === null).length;
    $('#cvStat').textContent = `${groups.length} 组` + (miss ? ` · ${miss} 组无字` : '') + (bad.length ? ` · 残组 ${bad.join(' ')}` : '');
  } else {
    cv.mode = 'encode';
    const items = encodeText(src, { extensions: $('#cvExt').checked });
    cv.codes = items.filter((x) => x.code !== null).map((x) => x.code);
    cv.text = lines(cv.codes);
    grid.innerHTML = items.map((x, i) => cell(x.ch, x.code, i, x.code === null, x.ext)).join('');
    plain.hidden = true;
    $('#cvOutTitle').textContent = '电码';
    const miss = items.filter((x) => x.code === null);
    $('#cvStat').textContent = `${cv.codes.length} 组` + (miss.length ? ` · 无码：${[...new Set(miss.map((x) => x.ch))].join('')}` : '');
  }
}
let gIndex = 0;
function cell(ch, code, i, bad, ext) {
  const c = ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch ?? '？';
  const g = code === null ? '' : ` data-g="${gIndex++}"`;
  return `<div class="cell${bad ? ' bad' : ''}${ext ? ' ext' : ''}"${g}><b>${esc(c)}</b><span>${code === null ? '····' : pad4(code)}</span></div>`;
}
const runConvert = () => { gIndex = 0; convert(); };
$('#cvGo').onclick = runConvert;
let cvTimer;
$('#cvIn').addEventListener('input', () => { clearTimeout(cvTimer); cvTimer = setTimeout(runConvert, 250); });
$('#cvTrad').onchange = runConvert;
$('#cvExt').onchange = runConvert;
$('#cvClear').onclick = () => { $('#cvIn').value = ''; runConvert(); };
$('#cvSwap').onclick = () => { if (cv.text) { $('#cvIn').value = cv.text; runConvert(); } };
$('#cvCopy').onclick = () => copy(cv.text);
$('#cvShare').onclick = () => share(cv.text);
$('#cvPlay').onclick = (e) => transmit(e.currentTarget, cv.codes, $('#cvGrid'));

// ================= 密钥 =================
let key = null;
let keyLoading = null;

async function loadKey(secret, { quiet = false } = {}) {
  $('#keyLoad').disabled = true;
  try {
    keyLoading = HaoKey.create(secret);
    key = await keyLoading;
    if ($('#keyRemember').checked) store.set('hm.secret', secret); else store.del('hm.secret');
    updateKeyUi();
    if (!quiet) toast(`密钥已装载 · 指纹 ${key.fingerprint}`);
    key.codebook(); // 预先生成代码本
  } catch (e) { toast(e.message, 'warn'); }
  finally { keyLoading = null; $('#keyLoad').disabled = false; }
}
function updateKeyUi() {
  const chip = $('#keyChip');
  if (key) { chip.textContent = `密钥 ${key.fingerprint}`; chip.classList.add('armed'); $('#keyFp').textContent = `指纹 ${key.fingerprint}（双方核对一致）`; }
  else { chip.textContent = '未装密钥'; chip.classList.remove('armed'); $('#keyFp').textContent = '未装载'; }
  renderPad(); updateUsedInfo(); updatePosHint();
}
$('#keyLoad').onclick = () => {
  const v = $('#keyIn').value;
  if (!v.trim()) return toast('请输入密钥', 'warn');
  loadKey(v);
};
$('#keyIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#keyLoad').click(); });
$('#keyGen').onclick = () => { $('#keyIn').value = randomSecret(); $('#keyIn').type = 'text'; toast('已生成随机密钥，请抄送对方后装载'); };
$('#keyShow').onclick = () => { const i = $('#keyIn'); i.type = i.type === 'password' ? 'text' : 'password'; };
$('#keyRemember').onchange = (e) => {
  store.set('hm.remember', e.target.checked);
  if (!e.target.checked) store.del('hm.secret');
  else if (key && $('#keyIn').value) store.set('hm.secret', $('#keyIn').value);
};
$('#keyWipe').onclick = () => {
  if (!confirm('销毁本机密钥？（用迹记录保留）')) return;
  key = null; $('#keyIn').value = ''; store.del('hm.secret'); updateKeyUi(); toast('密钥已销毁');
};

async function needKey() {
  if (keyLoading) await keyLoading;
  if (!key) { toast('请先装载密钥', 'warn'); go('key'); return false; }
  return true;
}

// ---- 乱数本浏览 ----
let padPage = 0;
async function renderPad() {
  const grid = $('#padGrid');
  $('#padPageLbl').textContent = `第${String(padPage).padStart(2, '0')}页`;
  if (!key) { grid.innerHTML = '<p class="empty">装载密钥后可查看乱数本</p>'; return; }
  const k = key;
  const page = await k.page(padPage);
  if (k !== key) return;
  const occ = occupancy();
  let html = '<div class="pad-row head"><i></i>' + [...'0123456789'].map((c) => `<i>${c}</i>`).join('') + '</div>';
  for (let r = 0; r < 10; r++) {
    html += `<div class="pad-row"><i>${r}</i>`;
    for (let c = 0; c < 10; c++) {
      const pos = padPage * 100 + r * 10 + c;
      html += `<span class="${occ[pos] ? 'used' : ''}">${pad4(page[r * 10 + c])}</span>`;
    }
    html += '</div>';
  }
  grid.innerHTML = html;
}
$('#padPrev').onclick = () => { padPage = (padPage + 99) % 100; renderPad(); };
$('#padNext').onclick = () => { padPage = (padPage + 1) % 100; renderPad(); };

// ---- 一次一密：用迹 ----
const usedKey = () => `hm.used.${key.fingerprint}`;
const getUsed = () => (key ? store.get(usedKey(), []) : []);
function occupancy() {
  const occ = new Uint8Array(PAD_SIZE);
  for (const [s, n] of getUsed()) for (let i = 0; i < n; i++) occ[(s + i) % PAD_SIZE] = 1;
  return occ;
}
function segment() {
  let a = Math.min(99, Math.max(0, parseInt($('#segFrom').value, 10) || 0));
  let b = Math.min(99, Math.max(0, parseInt($('#segTo').value, 10) || 0));
  if (b < a) [a, b] = [b, a];
  return [a * 100, (b + 1) * 100];
}
const fits = (occ, p, n, [lo, hi]) => {
  if (p < lo || p + n > hi) return false;
  for (let i = 0; i < n; i++) if (occ[p + i]) return false;
  return true;
};
function nextFree(n) {
  const occ = occupancy(); const seg = segment();
  const used = getUsed().map(([s, l]) => s + l).filter((e) => e >= seg[0] && e < seg[1]);
  const after = used.length ? Math.max(...used) : seg[0];
  for (let p = after; p + n <= seg[1]; p++) if (fits(occ, p, n, seg)) return p;
  for (let p = seg[0]; p + n <= seg[1]; p++) if (fits(occ, p, n, seg)) return p;
  return null;
}
function randomFree(n) {
  const occ = occupancy(); const seg = segment();
  const span = seg[1] - seg[0] - n + 1;
  if (span <= 0) return null;
  const buf = new Uint32Array(1);
  for (let t = 0; t < 400; t++) {
    crypto.getRandomValues(buf);
    const p = seg[0] + (buf[0] % span);
    if (fits(occ, p, n, seg)) return p;
  }
  return nextFree(n);
}
function markUsed(start, n) {
  const u = getUsed(); u.push([start, n]); store.set(usedKey(), u); updateUsedInfo();
}
function updateUsedInfo() {
  if (!key) { $('#usedInfo').textContent = '未装载密钥'; return; }
  const occ = occupancy(); const [lo, hi] = segment();
  let c = 0; for (let i = lo; i < hi; i++) c += occ[i];
  $('#usedInfo').textContent = `本页段已用 ${c} / ${hi - lo} 组`;
}
$('#usedReset').onclick = () => {
  if (!key) return;
  if (!confirm('清除本机的乱数用迹？这会使已用乱数可能被再次使用。')) return;
  store.del(usedKey()); updateUsedInfo(); renderPad(); updatePosHint(); toast('用迹已清除');
};
for (const id of ['#segFrom', '#segTo']) $(id).addEventListener('change', () => {
  store.set('hm.seg', [$('#segFrom').value, $('#segTo').value]); updateUsedInfo(); updatePosHint();
});

// ================= 加密 =================
let enMode = 'next';
let enLast = null;
for (const b of $$('#enMode button')) b.onclick = () => {
  enMode = b.dataset.v;
  for (const x of $$('#enMode button')) x.setAttribute('aria-pressed', String(x === b));
  $('#enPos').hidden = enMode !== 'manual';
  updatePosHint();
};
const enItems = () => encodeText($('#enIn').value, { extensions: true });
function updatePosHint() {
  const items = enItems();
  $('#enCount').textContent = `${items.length} 字 · 合 ${items.length + 2} 组`;
  const hint = $('#enPosHint');
  if (!key) { hint.textContent = '尚未装载密钥'; return; }
  if (enMode === 'next') {
    const p = nextFree(Math.max(1, items.length) + 1);
    hint.textContent = p === null ? '本页段乱数已用尽' : `将自 ${describePos(p)} 起用`;
  } else if (enMode === 'random') hint.textContent = '将在本页段内随机择取未用乱数';
  else hint.textContent = '指标 PPRC：PP 页（00–99）R 行 C 列';
}
$('#enIn').addEventListener('input', updatePosHint);
$('#enPos').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

$('#enGo').onclick = async () => {
  if (!(await needKey())) return;
  const items = enItems();
  if (!items.length) return toast('请输入明文', 'warn');
  const miss = items.filter((x) => x.code === null);
  if (miss.length) return toast(`以下字无电码：${[...new Set(miss.map((x) => x.ch))].join('')}`, 'warn');
  const n = items.length + 1;
  let start;
  if (enMode === 'manual') {
    const v = $('#enPos').value;
    if (!/^\d{4}$/.test(v)) return toast('请填写四位指标 PPRC', 'warn');
    start = +v;
  } else start = enMode === 'random' ? randomFree(n) : nextFree(n);
  if (start === null) return toast('本页段乱数不足，请调整页段或更换密钥', 'warn');
  const occ = occupancy();
  let reuse = 0;
  for (let i = 0; i < n; i++) reuse += occ[(start + i) % PAD_SIZE];
  if (reuse && !confirm(`警告：有 ${reuse} 组乱数已用过。重用乱数将使密电可被破译。仍要继续？`)) return;

  const res = await encrypt(key, items.map((x) => x.code), start, { useCodebook: $('#enBook').checked });
  markUsed(start, res.length);
  enLast = res;
  renderTelegram(res, items);
  updatePosHint();
  renderPad();
};

function renderTelegram(res, items) {
  const now = new Date();
  const no = String(store.get('hm.serial', 0) + 1).padStart(3, '0');
  store.set('hm.serial', +no);
  const d = `${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}时`;
  const g = res.groups;
  const cells = g.map((v, i) => {
    const cls = i === 0 ? 'ind' : i === g.length - 1 ? 'chk' : '';
    const lbl = i === 0 ? '指标' : i === g.length - 1 ? '校验' : String(i).padStart(2, '0');
    return `<div class="grp ${cls}" data-g="${i}"><small>${lbl}</small>${pad4(v)}</div>`;
  }).join('');
  $('#enOut').innerHTML = `
    <div class="tg-head">
      <span>第 <b>${no}</b> 号</span><span>组数 <b>${g.length}</b></span><span>${d}</span><span>钥 <b>${key.fingerprint}</b></span>
    </div>
    <div class="groups">${cells}</div>`;
  $('#enStat').textContent = `乱数 ${describePos(res.start)} 起，共 ${res.length} 组`;
  const st = $('#enStamp'); st.hidden = false; st.classList.remove('slam'); void st.offsetWidth; st.classList.add('slam');
  $('#enTrace').innerHTML = traceTable(['字', '明码', '密本', '乱数', '密码'],
    res.trace.map((t, i) => [items[i].ch === '\n' ? '↵' : items[i].ch === ' ' ? '␣' : items[i].ch, pad4(t.plain), pad4(t.sub), pad4(t.k), pad4(t.c)]));
}
function traceTable(head, rows) {
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
$('#enCopy').onclick = () => copy(enLast ? lines(enLast.groups) : '');
$('#enShare').onclick = () => share(enLast ? lines(enLast.groups) : '');
$('#enPlay').onclick = (e) => transmit(e.currentTarget, enLast ? enLast.groups : [], $('#enOut'));
$('#enClear').onclick = () => {
  $('#enIn').value = ''; enLast = null; $('#enStamp').hidden = true; $('#enStat').textContent = '';
  $('#enOut').innerHTML = '<p class="empty">加密后的电文组将显示于此</p>'; $('#enTrace').innerHTML = ''; updatePosHint();
};

// ================= 解密 =================
let deText = '';
$('#deIn').addEventListener('input', () => { $('#deCount').textContent = `${parseGroups($('#deIn').value).groups.length} 组`; });
$('#dePaste').onclick = async () => {
  try { $('#deIn').value = await navigator.clipboard.readText(); $('#deIn').dispatchEvent(new Event('input')); }
  catch { toast('无法读取剪贴板，请长按粘贴'); }
};
$('#deGo').onclick = async () => {
  if (!(await needKey())) return;
  const { groups, bad } = parseGroups($('#deIn').value);
  if (bad.length) toast(`残组已略去：${bad.join(' ')}`, 'warn');
  let res;
  try { res = await decrypt(key, groups, { useCodebook: $('#deBook').checked }); }
  catch (e) { return toast(e.message, 'warn'); }
  const trad = $('#deTrad').checked;
  const chars = res.codes.map((c) => { const d = decodeCode(c, { traditional: trad }); return d.ch ?? `[${pad4(c)}]`; });
  deText = chars.join('');
  const v = $('#deVerdict');
  v.hidden = false;
  v.className = `verdict ${res.checksumOk ? 'ok' : 'bad'}`;
  v.textContent = res.checksumOk ? `校验相符 · 乱数自 ${describePos(res.start)} 起` : '校验不符：密钥、密本设置或抄收有误';
  const out = $('#deOut');
  out.innerHTML = chars.map((c, i) => `<span style="--i:${i}">${esc(c === '\n' ? '\n' : c)}</span>`).join('');
  out.classList.remove('reveal'); void out.offsetWidth; out.classList.add('reveal');
  $('#deStat').textContent = `${res.codes.length} 字`;
  $('#deTrace').innerHTML = traceTable(['密码', '乱数', '密本', '明码', '字'],
    res.trace.map((t, i) => [pad4(t.c), pad4(t.k), pad4(t.sub), pad4(t.plain), chars[i] === '\n' ? '↵' : chars[i]]));
};
$('#deCopy').onclick = () => copy(deText);
const clearDe = () => {
  deText = ''; $('#deIn').value = ''; $('#deCount').textContent = '0 组'; $('#deVerdict').hidden = true;
  $('#deOut').innerHTML = '<p class="empty">译出的明文将显示于此</p>'; $('#deTrace').innerHTML = ''; $('#deStat').textContent = '';
};
$('#deBurn').onclick = () => {
  const out = $('#deOut');
  out.classList.add('burn');
  setTimeout(() => { out.classList.remove('burn'); clearDe(); toast('已焚毁'); }, 900);
};
$('#deClear').onclick = clearDe;

// ================= 码本 =================
let bookPage = 0;
let bookHit = -1;
function renderBook() {
  $('#bookPage').value = String(bookPage).padStart(2, '0');
  const tw = $('#bookTrad').checked;
  $('#bookGrid').innerHTML = pageEntries(bookPage).map((e) => {
    const ch = (tw ? e.tw || e.ml : e.ml || e.tw) || e.ext;
    return `<div class="bk${ch ? '' : ' none'}${e.ext ? ' ext' : ''}${e.code === bookHit ? ' hit' : ''}"><span>${pad4(e.code)}</span><b>${esc(ch || '·')}</b></div>`;
  }).join('');
}
function searchBook() {
  const q = $('#bookQ').value.trim();
  if (!q) return;
  const res = $('#bookRes');
  if (/^\d{1,4}$/.test(q)) {
    const n = +q;
    const m = decodeCode(n), t = decodeCode(n, { traditional: true });
    res.textContent = m.ch ? `${pad4(n)} → ${m.ch}${t.ch && t.ch !== m.ch ? `（台湾码本：${t.ch}）` : ''}` : `${pad4(n)} 无字`;
    bookHit = n;
  } else {
    const parts = Array.from(q).filter((c) => c.trim()).map((c) => { const n = lookupChar(c); return `${c} ${n === null ? '无码' : pad4(n)}`; });
    res.textContent = parts.join(' · ');
    const first = lookupChar(Array.from(q)[0]);
    bookHit = first ?? -1;
  }
  if (bookHit >= 0) bookPage = Math.floor(bookHit / 100);
  renderBook();
}
$('#bookGo').onclick = searchBook;
$('#bookQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchBook(); });
$('#bookPrev').onclick = () => { bookPage = (bookPage + 99) % 100; renderBook(); };
$('#bookNext').onclick = () => { bookPage = (bookPage + 1) % 100; renderBook(); };
$('#bookPage').addEventListener('change', (e) => { bookPage = Math.min(99, Math.max(0, parseInt(e.target.value, 10) || 0)); renderBook(); });
$('#bookTrad').onchange = renderBook;
$('#bookStat').textContent = `大陆 ${stats.mainland} 字 · 台湾 ${stats.taiwan} 字`;

// ================= 电键设置 =================
const prefs = store.get('hm.prefs', { wpm: 16, tone: 700 });
$('#wpm').value = prefs.wpm; $('#tone').value = prefs.tone;
const updPrefs = () => {
  $('#wpmLbl').textContent = `${$('#wpm').value} WPM`;
  $('#toneLbl').textContent = `${$('#tone').value} Hz`;
  store.set('hm.prefs', { wpm: +$('#wpm').value, tone: +$('#tone').value });
};
$('#wpm').oninput = updPrefs; $('#tone').oninput = updPrefs; updPrefs();

// ================= 启动 =================
$('#aboutStat').textContent = `电码数据：Unicode Unihan（kMainlandTelegraph / kTaiwanTelegraph）。`;
applyTheme(store.get('hm.theme', 'spy'));
const seg = store.get('hm.seg', null);
if (seg) { $('#segFrom').value = seg[0]; $('#segTo').value = seg[1]; }
$('#keyRemember').checked = store.get('hm.remember', false);
const saved = store.get('hm.secret', null);
if (saved) { $('#keyIn').value = saved; loadKey(saved, { quiet: true }); }
updateKeyUi();
go(store.get('hm.view', 'convert'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('新版本已就绪，重新打开后生效');
      });
    });
  }).catch(() => { /* 非安全上下文 */ });
}
