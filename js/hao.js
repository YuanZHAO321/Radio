// 加密体系
//
//   明码  汉字 → 标准四码
//   密本  四码经保密代码本替代（0000–9999 的置换），可选
//   加乱  与乱数本中的乱数组逐位相加，不进位（mod 10）
//   指标  报首一组 PPRC：乱数本 PP 页 R 行 C 列起用；指标组再经指标乱数遮盖
//   校验  报尾一组：全部明码逐位相加（不进位），再加乱
//   一次一密  每组乱数只用一次，本机记录已用位置
//
// 乱数本：100 页 × 10 行 × 10 列 = 10000 组四位乱数，
// 由共同密钥经 PBKDF2-SHA256 派生主钥，再以 HMAC-SHA256 展开。
// 双方持有同一密钥即可离线生成同一部乱数本。

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
export const GROUPS_PER_PAGE = 100;
export const PAGES = 100;
export const PAD_SIZE = GROUPS_PER_PAGE * PAGES;

// ---- 不进位加减 ----
export function addNC(a, b) {
  let r = 0;
  for (let p = 1000; p >= 1; p /= 10) r += ((Math.floor(a / p) % 10 + Math.floor(b / p) % 10) % 10) * p;
  return r;
}
export function subNC(a, b) {
  let r = 0;
  for (let p = 1000; p >= 1; p /= 10) r += ((Math.floor(a / p) % 10 - Math.floor(b / p) % 10 + 10) % 10) * p;
  return r;
}

// ---- 位置 ⇄ 指标组 ----
export const posToIndicator = (pos) => pos % PAD_SIZE; // PPRC 恰好等于位置序号
export const describePos = (pos) => {
  const p = Math.floor(pos / 100), r = Math.floor(pos / 10) % 10, c = pos % 10;
  return `第${String(p).padStart(2, '0')}页 ${r}行 ${c}列`;
};

// ---- 密钥 ----
async function hmacBytes(key, label, counter) {
  const msg = te.encode(`${label}|${counter}`);
  return new Uint8Array(await subtle.sign('HMAC', key, msg));
}

class DigitStream {
  constructor(key, label) { this.key = key; this.label = label; this.ctr = 0; this.buf = []; }
  async digit() {
    while (!this.buf.length) {
      const bytes = await hmacBytes(this.key, this.label, this.ctr++);
      for (const b of bytes) if (b < 250) this.buf.push(b % 10);
    }
    return this.buf.shift();
  }
  async group() {
    return (await this.digit()) * 1000 + (await this.digit()) * 100 + (await this.digit()) * 10 + (await this.digit());
  }
  async u32() {
    while (this.buf.length < 4) {
      const bytes = await hmacBytes(this.key, this.label, this.ctr++);
      this.buf.push(...bytes);
    }
    const [a, b, c, d] = this.buf.splice(0, 4);
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
  async below(n) { // 无偏随机整数 [0, n)
    const lim = Math.floor(0x100000000 / n) * n;
    for (;;) { const x = await this.u32(); if (x < lim) return x % n; }
  }
}

export class HaoKey {
  static async create(secret) {
    const norm = secret.normalize('NFKC').replace(/\s+/g, '');
    if (!norm) throw new Error('密钥不能为空');
    const base = await subtle.importKey('raw', te.encode(norm), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('HAOMI-PAD-v1'), iterations: 150000 }, base, 256);
    const key = await subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const k = new HaoKey(key);
    const fp = await hmacBytes(key, 'FINGERPRINT', 0);
    k.fingerprint = [...fp.slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    k.indicatorMask = await new DigitStream(key, 'INDICATOR').group();
    return k;
  }
  constructor(key) { this.key = key; this.pages = new Map(); this.book = null; }

  async page(p) {
    if (!this.pages.has(p)) {
      const s = new DigitStream(this.key, `PAD-PAGE-${p}`);
      const g = new Array(GROUPS_PER_PAGE);
      for (let i = 0; i < GROUPS_PER_PAGE; i++) g[i] = await s.group();
      this.pages.set(p, g);
    }
    return this.pages.get(p);
  }
  async padGroup(pos) {
    pos %= PAD_SIZE;
    return (await this.page(Math.floor(pos / 100)))[pos % 100];
  }
  async codebook() { // 保密代码本：Fisher–Yates 置换 0..9999
    if (!this.book) {
      const s = new DigitStream(this.key, 'CODEBOOK');
      const fwd = Uint16Array.from({ length: 10000 }, (_, i) => i);
      for (let i = 9999; i > 0; i--) {
        const j = await s.below(i + 1);
        [fwd[i], fwd[j]] = [fwd[j], fwd[i]];
      }
      const inv = new Uint16Array(10000);
      fwd.forEach((v, i) => { inv[v] = i; });
      this.book = { fwd, inv };
    }
    return this.book;
  }
}

/** 随机生成一条共享密钥：8 组四位数字（约 106 位熵） */
export function randomSecret() {
  const out = [];
  const buf = new Uint8Array(1);
  while (out.length < 32) { globalThis.crypto.getRandomValues(buf); if (buf[0] < 250) out.push(buf[0] % 10); }
  return out.join('').match(/.{4}/g).join(' ');
}

export function randomPos() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % PAD_SIZE;
}

const checksum = (codes) => codes.reduce((s, c) => addNC(s, c), 0);

/**
 * 加密。codes: 明码数组；start: 乱数起用位置（0–9999）
 * 返回 { groups: [指标, 密文..., 校验], used: [start, start+n+1) , trace }
 */
export async function encrypt(key, codes, start, { useCodebook = true } = {}) {
  const book = useCodebook ? await key.codebook() : null;
  const trace = [];
  const out = [addNC(posToIndicator(start), key.indicatorMask)];
  for (let i = 0; i < codes.length; i++) {
    const plain = codes[i];
    const sub = book ? book.fwd[plain] : plain;
    const k = await key.padGroup(start + i);
    const c = addNC(sub, k);
    trace.push({ plain, sub, k, c });
    out.push(c);
  }
  const ck = await key.padGroup(start + codes.length);
  out.push(addNC(checksum(codes), ck));
  return { groups: out, start, length: codes.length + 1, trace };
}

/** 解密。groups 含指标组与校验组 */
export async function decrypt(key, groups, { useCodebook = true } = {}) {
  if (groups.length < 2) throw new Error('电文过短：至少需要指标组与校验组');
  const book = useCodebook ? await key.codebook() : null;
  const start = subNC(groups[0], key.indicatorMask);
  const body = groups.slice(1, -1);
  const codes = [], trace = [];
  for (let i = 0; i < body.length; i++) {
    const k = await key.padGroup(start + i);
    const sub = subNC(body[i], k);
    const plain = book ? book.inv[sub] : sub;
    trace.push({ c: body[i], k, sub, plain });
    codes.push(plain);
  }
  const ck = await key.padGroup(start + body.length);
  const ok = subNC(groups[groups.length - 1], ck) === checksum(codes);
  return { codes, start, length: body.length + 1, checksumOk: ok, trace };
}
