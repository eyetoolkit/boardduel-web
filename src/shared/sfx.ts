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
 * "真正播过东西"的状态，之后才能出声。否则第一次之后可能全程静音。
 * 做法：在最早的一次 pointerdown/touchstart 里建 context + resume +
 * 播一个 1 采样的静音 buffer（无害、听不见，但会把 context 踢进 running）。
 */
export function unlockSfx(): void {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => {});
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, c.sampleRate);
    s.connect(c.destination);
    s.start(0);
  } catch (e) { /* 解锁失败不影响棋局 */ }
}

/** 取（必要时创建）AudioContext；创建失败（无 WebAudio）返回 null，全函数静默降级 */
function ac(): AudioContext | null {
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
  if (!c) return;
  // 手势后若仍处于 suspended（iOS/Safari 常见），尝试恢复；失败就静默跳过
  if (c.state === 'suspended') void c.resume().catch(() => {});

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
