/**
 * BoardDuel · 极简音效（WebAudio 实时合成，零音频文件）
 * ------------------------------------------------------------
 * 为什么不用 mp3：棋盘落子是一声短促的"啪"（clack），本质是
 * 一段噪声脉冲 + 一个低频木质共鸣，用 WebAudio 现场合成只需几行，
 * 不占 CDN、不发请求、不受打包体积影响，还能随开关即时静音。
 *
 * 用法：
 *   import { playSfx, sfxOn, setSfx } from '../../shared/sfx';
 *   playSfx('place');            // 落子
 *   setSfx(false);               // 关（写 localStorage，跨页记住）
 *
 * 浏览器策略：AudioContext 必须在用户手势后才能 resume，
 * 所以首次播放一定发生在点击之后（落子/开局/结算都由点击触发）。
 */

const LS_KEY = 'bd-sfx';

export type SfxName = 'place' | 'win' | 'lose' | 'start';

let ctx: AudioContext | null = null;
let unlockedOnce = false;
let enabled = true;

try {
  const v = localStorage.getItem(LS_KEY);
  // 只认显式的 '0' —— 缺省即为开（用户没反对过就不要自作主张关掉）
  enabled = v !== '0';
} catch (e) {
  enabled = true;
}

export function sfxOn(): boolean {
  return enabled;
}

export function setSfx(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) { /* 隐私模式 */ }
}

/**
 * 在真实用户手势里解锁音频（iOS Safari / 微信内置浏览器必需）。
 *
 * 这些浏览器要求：AudioContext 必须在手势回调里创建过、且 resume 到一个
 * "真正播过东西"的状态，之后才能出声。
 *
 * 🔴 必须"每次手势都调"，不能 once：iOS 在锁屏 / 切后台 / 来电中断后会把
 * AudioContext 重新挂起（state → suspended/interrupted），只解锁一次的话，
 * 中断之后就永久静音直到刷新——这正是"声音时有时无"的主因。
 * 本函数幂等且开销极小（多数时候只是一次 state 判断），放心常驻。
 */
export function unlockSfx(): void {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  if (c.state !== 'running') void c.resume().catch(() => {});
  unlockElements();          // 顺手把 <audio> 通道也在手势里解锁（兜底通道需要）
  if (!unlockedOnce) {
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(c.destination);
      s.start(0);
      unlockedOnce = true;   // 静音采样只需播一次把 ctx 踢进 running
    } catch (e) { /* 解锁失败不影响棋局 */ }
  }
}

/* ══════════════════════════════════════════════════════════════
 * 兜底通道：运行时合成 WAV → <audio> 元素播放（2026-10-03）
 * ------------------------------------------------------------
 * WebAudio 在部分真机（iOS 静音态 / 老版微信 X5 / 个别 Android WebView）
 * 会被挡住或输出为空。HTMLAudioElement 是另一条独立的输出通道：
 * 只要在**某个真实手势里播放过一次**，之后即使由 setTimeout 程序化调用
 * play() 也放行（iOS 的经典解锁行为）。所以两条通道并存：
 *   WebAudio 可用（state==='running'）→ 用合成音（零延迟、可叠加）
 *   否则                              → 用 <audio> 元素兜底
 * WAV 在运行时用 JS 合成 + base64 内联，不必引入任何音频文件。
 * ══════════════════════════════════════════════════════════════ */

const RATE = 22050;   // 单声道 22.05kHz 足够表达短促敲击音，体积最小

/** 把 Float32 采样编码成 WAV 的 base64 data URI */
function encodeWav(smp: Float32Array): string {
  const n = smp.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wr = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, smp[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

/** 叠加一个衰减音（起止频率可不同）到 out 里 */
function addTone(out: Float32Array, f0: number, f1: number, start: number, dur: number, amp: number): void {
  const i0 = Math.floor(start * RATE), len = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < len && i0 + i < out.length; i++) {
    const t = i / RATE;
    const f = f0 + (f1 - f0) * (t / Math.max(0.0001, dur));
    phase += (2 * Math.PI * f) / RATE;
    out[i0 + i] += Math.sin(phase) * amp * Math.exp(-t * (3.2 / Math.max(0.02, dur)));
  }
}

/** 合成各音效的采样（缓存 data URI） */
function synth(name: SfxName): string {
  const dur = name === 'win' ? 0.52 : name === 'lose' ? 0.45 : name === 'start' ? 0.16 : 0.17;
  const out = new Float32Array(Math.floor(RATE * dur));
  if (name === 'place') {
    // 石头磕木盘：极短的宽带噪声"啪" + 低频木共鸣 + 一点高频泛音
    for (let i = 0; i < out.length; i++) {
      const t = i / RATE;
      out[i] = (Math.random() * 2 - 1) * 0.55 * Math.exp(-t * 95);
    }
    addTone(out, 240, 120, 0, 0.15, 0.75);
    addTone(out, 1650, 900, 0, 0.035, 0.28);
  } else if (name === 'win') {
    addTone(out, 523, 523, 0, 0.16, 0.30);
    addTone(out, 659, 659, 0.11, 0.16, 0.30);
    addTone(out, 784, 784, 0.22, 0.26, 0.32);
  } else if (name === 'lose') {
    addTone(out, 392, 392, 0, 0.18, 0.28);
    addTone(out, 294, 240, 0.14, 0.30, 0.28);
  } else {
    addTone(out, 520, 680, 0, 0.14, 0.26);
  }
  return encodeWav(out);
}

const wavCache: Partial<Record<SfxName, string>> = {};
const elCache: Partial<Record<SfxName, HTMLAudioElement>> = {};

/** 取（必要时创建）某个音效的 <audio> 元素；失败返回 null */
function el(name: SfxName): HTMLAudioElement | null {
  if (elCache[name]) return elCache[name] || null;
  try {
    if (!wavCache[name]) wavCache[name] = synth(name);
    const a = new Audio(wavCache[name]);
    a.preload = 'auto';
    a.volume = FALLBACK_VOL;
    elCache[name] = a;
    return a;
  } catch (e) {
    return null;   // 不支持 WAV data URI（极老浏览器）→ 静默降级
  }
}

/** 兜底播放（走 <audio> 元素通道） */
function playViaElement(name: SfxName): void {
  const a = el(name);
  if (!a) return;
  try {
    // ⚠️ 必须显式写回音量：解锁过程会临时把音量置 0，若解锁还在进行中
    //    就播这一声，会继承 volume=0 → 无声。宁可极小概率重一小声，也不要哑。
    a.volume = FALLBACK_VOL;
    a.currentTime = 0;
    void a.play().catch(() => { /* 未解锁 / 被拦截：不影响棋局 */ });
  } catch (e) { /* noop */ }
}

/** 在手势里把 <audio> 通道也解锁（音量 0 偷播一次，听不见但能解锁） */
function unlockElements(): void {
  if (elUnlocked || elUnlocking) return;   // 幂等 + 防重入
  const a = el('place');
  if (!a) return;
  elUnlocking = true;
  const done = (): void => {
    try { a.pause(); a.currentTime = 0; } catch (e) { /* noop */ }
    a.volume = FALLBACK_VOL;               // 用常量写回，别用"当前值"——重入时会记成 0
    elUnlocked = true; elUnlocking = false;
  };
  try {
    a.volume = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') p.then(done).catch(done);
    else done();
  } catch (e) {
    done();
  }
}
const FALLBACK_VOL = 0.9;
let elUnlocked = false;
let elUnlocking = false;

/** 取（必要时创建）AudioContext；创建失败（无 WebAudio）返回 null，全函数静默降级 */
function ac(): AudioContext | null {
  // iOS 中断后可能把 context 关闭（state='closed'）——丢弃重建，别卡死在坏实例上
  if (ctx && ctx.state === 'closed') { ctx = null; unlockedOnce = false; }
  if (ctx) return ctx;
  try {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch (e) {
    return null;
  }
  return ctx;
}

/** 短噪声缓冲（白噪 → 后面用带通塑形成"石头磕木盘"的脆响） */
function noiseBuffer(c: AudioContext): AudioBuffer {
  const n = Math.floor(c.sampleRate * 0.08);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** 单个衰减音：osc(type, f0→f1) + gain 指数衰减 */
function ping(
  c: AudioContext,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  gain: number,
  delay = 0,
): void {
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 噪声脉冲（落子的"啪"） */
function clack(c: AudioContext, dur: number, center: number, gain: number, delay = 0): void {
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(center, t);
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function playSfx(name: SfxName): void {
  if (!enabled) return;
  const c = ac();
  if (!c) { playViaElement(name); return; }   // 根本没有 WebAudio → 直接走兜底
  // 非运行态（suspended / interrupted）都尝试恢复：挂起态下调度的节点会在
  // resume 后补播，所以这里不 return —— 宁可延迟出声也不要吞掉这一手。
  if (c.state !== 'running') void c.resume().catch(() => {});
  // 🔴 兜底：WebAudio 通道此刻不可用（iOS 静音/老 WebView/被拦截）时，
  //    再走一次 <audio> 元素通道。两条通道是独立的，任一条通就有声。
  if (c.state !== 'running') playViaElement(name);

  try {
    if (name === 'place') {
      // 木质棋盘落子：脆响 + 木共鸣 + 一点高频"啪"。
      // 2026-10-03 调厚一档：手机小喇叭对 2kHz 以上的窄带脆响几乎没反应，
      // 加长到 ~0.1s 并把共鸣降到 260→130Hz、增益提到 .3，听感明显但仍短促。
      clack(c, 0.075, 1750, 0.34);
      ping(c, 'triangle', 260, 130, 0.13, 0.30);
      ping(c, 'sine', 900, 620, 0.035, 0.14);
      return;
    }
    if (name === 'start') {
      ping(c, 'sine', 520, 660, 0.14, 0.12);
      return;
    }
    if (name === 'win') {
      // 上行三音（C-E-G 感），短促不吵
      ping(c, 'triangle', 523, 523, 0.16, 0.14, 0);
      ping(c, 'triangle', 659, 659, 0.16, 0.14, 0.11);
      ping(c, 'triangle', 784, 784, 0.28, 0.15, 0.22);
      return;
    }
    if (name === 'lose') {
      ping(c, 'sine', 392, 392, 0.20, 0.12, 0);
      ping(c, 'sine', 294, 262, 0.34, 0.12, 0.13);
      return;
    }
  } catch (e) {
    /* 音频失败绝不能影响棋局 */
  }
}
