/**
 * 四子连珠 AI Worker（薄转发层）— 2026-10-24 第四批续：AI Worker 迁移
 * 逻辑全部在 shared/ai-worker.ts 与 ./engine.ts，本文件只做接线。
 */
import { bestMove } from './engine';
import { wireAiWorker } from '../../shared/ai-worker';

interface Connect4AiPayload {
  board: Parameters<typeof bestMove>[0];
  player: Parameters<typeof bestMove>[1];
  level: Parameters<typeof bestMove>[2];
}

wireAiWorker((payload) => {
  const p = payload as Connect4AiPayload;
  return bestMove(p.board, p.player, p.level);
});
