/**
 * BoardDuel Reversi page TS
 */
import { setupGamePage } from '../shared';
import { selfTest } from './engine';

setupGamePage('reversi');
const r = selfTest();
if (!r.ok) console.warn('[reversi] selfTest failed:', r.details);
console.info('[BoardDuel] reversi engine selfTest:', r.ok ? 'OK' : 'FAIL', r.details.join(' | '));