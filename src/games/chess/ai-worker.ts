/**
 * 国际象棋 AI Worker（薄转发层）— 2026-10-23 第三批
 * 逻辑全部在 shared/ai-worker.ts 与 ./engine.ts，本文件只做接线。
 */
import { bestMove } from './engine';
import { wireAiWorker } from '../../shared/ai-worker';

interface ChessAiPayload {
  state: Parameters<typeof bestMove>[0];
  level: Parameters<typeof bestMove>[1];
  timeBudget?: number;
}

wireAiWorker((payload) => {
  const p = payload as ChessAiPayload;
  return bestMove(p.state, p.level, p.timeBudget ?? 1500);
});
