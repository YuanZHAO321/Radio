// 莫尔斯拍发（数字），WebAudio 合成
const DIGITS = ['-----', '.----', '..---', '...--', '....-', '.....', '-....', '--...', '---..', '----.'];

let ctx = null;
let stopFlag = null;

export const isPlaying = () => stopFlag !== null;
export function stop() { if (stopFlag) stopFlag.stopped = true; }

/**
 * 拍发四码组。onGroup(i) 在第 i 组开始时回调，onKey(on) 驱动指示灯。
 */
export async function play(groups, { wpm = 16, tone = 700, onGroup, onKey } = {}) {
  stop();
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const flag = { stopped: false };
  stopFlag = flag;
  const unit = 1.2 / wpm;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = tone;
  osc.connect(gain);
  let t = ctx.currentTime + 0.08;
  const t0 = t;
  const timeline = []; // [time, type, payload]
  groups.forEach((g, gi) => {
    timeline.push([t, 'group', gi]);
    const s = String(g).padStart(4, '0');
    [...s].forEach((d, di) => {
      [...DIGITS[+d]].forEach((sym, si) => {
        const len = sym === '.' ? unit : unit * 3;
        gain.gain.setTargetAtTime(0.35, t, 0.004);
        gain.gain.setTargetAtTime(0, t + len, 0.004);
        timeline.push([t, 'on'], [t + len, 'off']);
        t += len + unit;
      });
      t += unit * 2; // 字符间隔 3 单位
    });
    t += unit * 4; // 组间隔 7 单位
  });
  osc.start(t0);
  osc.stop(t + 0.05);

  let i = 0;
  await new Promise((resolve) => {
    const tick = () => {
      if (flag.stopped) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        try { osc.stop(); } catch { /* already stopped */ }
        return resolve();
      }
      const now = ctx.currentTime;
      while (i < timeline.length && timeline[i][0] <= now) {
        const [, type, payload] = timeline[i++];
        if (type === 'group') onGroup?.(payload);
        else onKey?.(type === 'on');
      }
      if (now > t) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  onKey?.(false);
  onGroup?.(-1);
  if (stopFlag === flag) stopFlag = null;
}
