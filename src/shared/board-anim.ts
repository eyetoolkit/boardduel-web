/**
 * 动画三件套 · 共享 diff 注入器（2026-10-24 第四批打磨）
 *
 * 背景：各游戏 render() 都是 innerHTML 全量重建，挂在元素上的 CSS 动画会随
 * 重建重播——时钟 tick、hover 幽灵、选中态变化引发的重渲染会把落子动画播个
 * 没完。解法是「盘面 diff」：只给相对上一帧真正发生变化的格子挂一次性动画类，
 * 盘面没动的重渲染自然没有 diff、没有动画。
 *
 * 与 go 的关系：围棋 render.ts 已有自己的 .is-new/.is-captured（落子+提子），
 * 继续沿用；本模块服务其余 7 款，键名/时序与 go 对齐。
 *
 * 用法（以黑白棋 render() 为例）：
 *   const anim = diffCellAnims(animPrev, renderBoard, state.reviewAt === null, { lastIdx, cols: 8 });
 *   ...构建棋子时：const a = anim.get(i); 有则拼接 a.cls 与 animation-delay
 *   animPrev = renderBoard.slice();   // ⚠️ 快照必须在渲染后更新，且回放态也更新
 *                                    //（否则退出回放时对着陈旧盘面误放动画）
 */

export interface CellAnim {
  /** 要追加的 class（'bd-anim-place' | 'bd-anim-flip'） */
  cls: string;
  /** animation-delay（ms），翻子按与落点距离 stagger */
  delay: number;
}

export interface DiffOpts {
  /** 本手落点（翻子 stagger 的圆心）；-1/缺省 = 不 stagger */
  lastIdx?: number;
  /** 盘面列数（算距离用） */
  cols?: number;
  /** 是否允许"变色翻面"动画（仅黑白棋 true；国象升变不翻） */
  allowFlip?: boolean;
  /** stagger 单格步进 ms 与上限 */
  flipStepMs?: number;
  flipMaxMs?: number;
}

/** 默认 stagger：每格 22ms、封顶 176ms（8×8 盘最远 7 格 ≈ 154ms） */
const FLIP_STEP_MS = 22;
const FLIP_MAX_MS = 176;

/**
 * 比较 prev（上一帧盘面）与 next（本帧盘面），返回「哪一格该播什么动画」。
 *
 * 判定：
 *   空格 → 有子   → bd-anim-place（落子弹出）
 *   有子 → 变色   → bd-anim-flip（翻子，仅 allowFlip）
 *   有子 → 空格   → 不播（提子/清盘由各游戏自己的动画管，如 go 的 is-captured）
 *   live=false     → 一律不播（回放/复盘态历史盘面跳变会全盘乱播）
 *
 * prev 为 null（首帧）时不播任何动画——防止进页面/重连时全盘 pop。
 */
export function diffCellAnims(
  prev: ArrayLike<number | string> | null,
  next: ArrayLike<number | string>,
  live: boolean,
  opts: DiffOpts = {},
): Map<number, CellAnim> {
  const out = new Map<number, CellAnim>();
  if (!prev || !live) return out;
  const { lastIdx = -1, cols = 8, allowFlip = false, flipStepMs = FLIP_STEP_MS, flipMaxMs = FLIP_MAX_MS } = opts;
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i];
    if (a === b) continue;
    const emptyA = a === 0 || a === '.' || a === '';
    const emptyB = b === 0 || b === '.' || b === '';
    if (emptyA && !emptyB) {
      out.set(i, { cls: 'bd-anim-place', delay: 0 });
    } else if (!emptyA && !emptyB && allowFlip) {
      let delay = 0;
      if (lastIdx >= 0 && cols > 0) {
        const dr = Math.abs(Math.floor(i / cols) - Math.floor(lastIdx / cols));
        const dc = Math.abs((i % cols) - (lastIdx % cols));
        delay = Math.min(flipMaxMs, Math.max(dr, dc) * flipStepMs);
      }
      out.set(i, { cls: 'bd-anim-flip', delay });
    }
    // 其余（有子→空格）不播
  }
  return out;
}

/**
 * 把 CellAnim 拼成 SVG 属性串（class 后缀 + animation-delay 内联样式）。
 * 例：animAttr(anim, i, 'go-stone is-last') → 'go-stone is-last bd-anim-place'
 *     animAttr(anim, i, 'rv-stone')        → 'rv-stone bd-anim-flip' style="animation-delay:44ms"
 */
export function animClassSuffix(anim: Map<number, CellAnim>, i: number): string {
  const a = anim.get(i);
  return a ? ' ' + a.cls : '';
}

export function animDelayStyle(anim: Map<number, CellAnim>, i: number): string {
  const a = anim.get(i);
  return a && a.delay > 0 ? ` style="animation-delay:${a.delay}ms"` : '';
}
