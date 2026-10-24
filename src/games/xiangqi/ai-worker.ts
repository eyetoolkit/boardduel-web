/**
 * 中国象棋 AI Worker（薄转发层）— 2026-10-24 第四批续：AI Worker 迁移
 * 逻辑全部在 shared/ai-worker.ts 与 ./engine.ts，本文件只做接线。
 * 引擎决策（search + 随机兜底）已封装进 engine.ts 的 bestMove(gs, level)，
 * 本文件只转发，零逻辑。
 */
import { bestMove } from './engine';
import { wireAiWorker } from '../../shared/ai-worker';

interface XiangqiAiPayload {
  gs: Parameters<typeof bestMove>[0];
  level: Parameters<typeof bestMove>[1];
}

wireAiWorker((payload) => {
  const p = payload as XiangqiAiPayload;
  return bestMove(p.gs, p.level);
});
