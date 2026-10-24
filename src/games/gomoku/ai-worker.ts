/**
 * 五子棋 AI Worker（薄转发层）— 2026-10-24 第四批续：AI Worker 迁移
 * 逻辑全部在 shared/ai-worker.ts 与 ./engine.ts，本文件只做接线。
 * 主线程同步 bestMove 在 hard 档会冻结主线程（秒级搜索），搬进 Worker 后
 * 主线程只留 UI，落子/动画/棋钟不再卡顿。
 */
import { bestMove } from './engine';
import { wireAiWorker } from '../../shared/ai-worker';

interface GomokuAiPayload {
  board: Parameters<typeof bestMove>[0];
  player: Parameters<typeof bestMove>[1];
  level: Parameters<typeof bestMove>[2];
}

wireAiWorker((payload) => {
  const p = payload as GomokuAiPayload;
  return bestMove(p.board, p.player, p.level);
});
