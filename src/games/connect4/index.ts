/**
 * BoardDuel Connect-4 page TS
 */
import { setupGamePage } from '../shared';
import { selfTest } from './engine';

setupGamePage('connect4');
const r = selfTest();
if (!r.ok) console.warn('[connect4] selfTest failed:', r.details);
console.info('[BoardDuel] connect4 engine selfTest:', r.ok ? 'OK' : 'FAIL', r.details.join(' | '));