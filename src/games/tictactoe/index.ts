/**
 * BoardDuel Tic-Tac-Toe page TS
 */
import { setupGamePage } from '../shared';
import { selfTest } from './engine';

setupGamePage('tictactoe');
const r = selfTest();
if (!r.ok) console.warn('[tictactoe] selfTest failed:', r.details);
console.info('[BoardDuel] tictactoe engine selfTest:', r.ok ? 'OK' : 'FAIL', r.details.join(' | '));