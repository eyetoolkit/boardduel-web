/**
 * BoardDuel Chess page TS
 */
import { setupGamePage } from '../shared';
import { selfTest } from './engine';

setupGamePage('chess');
const r = selfTest();
if (!r.ok) console.warn('[chess] selfTest failed:', r.details);
console.info('[BoardDuel] chess engine selfTest:', r.ok ? 'OK' : 'FAIL', r.details.join(' | '));