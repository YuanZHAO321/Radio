// 中文电码（四码）转换：汉字 ⇄ 0000–9999
import { MAINLAND, TAIWAN, EXTRA } from './codes-data.js';

const ML = Array.from(MAINLAND);
const TW = Array.from(TAIWAN);
const PAD = ' ';

// 本机扩展码（非标准电码本内容，标准码本只用到 0001–9798）
export const EXT_BASE = 9900;
const EXT_CHARS = [
  ...'0123456789',                       // 9900–9909
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',       // 9910–9935
];
const EXT_PUNCT = '，。、；：？！“”‘’（）《》—…·「」';  // 9940 起
const EXT = new Map();
EXT_CHARS.forEach((c, i) => EXT.set(c, EXT_BASE + i));
Array.from(EXT_PUNCT).forEach((c, i) => EXT.set(c, 9940 + i));
EXT.set(' ', 9998);
EXT.set('\n', 9999);
const EXT_REV = new Map([...EXT].map(([c, n]) => [n, c]));

const ENC = new Map();
ML.forEach((c, i) => { if (c !== PAD) ENC.set(c, i); });
const extra = Array.from(EXTRA);
for (let i = 0; i < extra.length; i += 5) {
  ENC.set(extra[i], Number(extra.slice(i + 1, i + 5).join('')));
}

// 半角/全角、英文标点归一化
const PUNCT_MAP = { ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）', '"': '“', "'": '‘', '-': '—' };

function normalize(ch) {
  if (ch === '\r') return '';
  if (ch === '\t' || ch === '　') return ' ';
  const n = ch.normalize('NFKC').toUpperCase();
  if (PUNCT_MAP[n]) return PUNCT_MAP[n];
  return n.length === 1 ? n : ch;
}

export const pad4 = (n) => String(n).padStart(4, '0');

/** 汉字 → 电码。返回 [{ch, code|null, ext}] */
export function encodeText(text, { extensions = true } = {}) {
  const out = [];
  for (const raw of Array.from(text)) {
    const ch = normalize(raw);
    if (!ch) continue;
    if (ENC.has(ch)) out.push({ ch: raw, code: ENC.get(ch), ext: false });
    else if (extensions && EXT.has(ch)) out.push({ ch: raw, code: EXT.get(ch), ext: true });
    else if (ch === ' ' || ch === '\n') continue;
    else out.push({ ch: raw, code: null, ext: false });
  }
  return out;
}

/** 电码 → 汉字 */
export function decodeCode(n, { traditional = false } = {}) {
  if (EXT_REV.has(n)) return { ch: EXT_REV.get(n), ext: true };
  const a = traditional ? TW[n] : ML[n];
  const b = traditional ? ML[n] : TW[n];
  const ch = a !== PAD ? a : b !== PAD ? b : null;
  return { ch, ext: false };
}

/** 从任意文本中解析四码组。返回 { groups:number[], bad:string[] } */
export function parseGroups(text) {
  const tokens = text.match(/\d+/g) || [];
  const groups = [], bad = [];
  for (const t of tokens) {
    if (t.length === 4) groups.push(Number(t));
    else if (t.length % 4 === 0) for (let i = 0; i < t.length; i += 4) groups.push(Number(t.slice(i, i + 4)));
    else bad.push(t);
  }
  return { groups, bad };
}

export function lookupChar(ch) {
  const n = normalize(ch);
  return ENC.has(n) ? ENC.get(n) : EXT.has(n) ? EXT.get(n) : null;
}

export function pageEntries(page) {
  const rows = [];
  for (let i = page * 100; i < page * 100 + 100; i++) {
    const m = ML[i] !== PAD ? ML[i] : '';
    const t = TW[i] !== PAD ? TW[i] : '';
    const e = EXT_REV.get(i) ?? '';
    rows.push({ code: i, ml: m, tw: t, ext: e === '\n' ? '↵' : e === ' ' ? '␣' : e });
  }
  return rows;
}

export const stats = {
  mainland: ML.filter((c) => c !== PAD).length,
  taiwan: TW.filter((c) => c !== PAD).length,
};
