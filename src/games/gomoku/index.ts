/**
 * BoardDuel Gomoku page TS
 * - nav cur 高亮
 * - engine selfTest
 * - mast .switcher 当前页 on 类
 */
import { setupGamePage } from '../shared';
import { selfTest } from './engine';

setupGamePage('gomoku');
const r = selfTest();
if (!r.ok) console.warn('[gomoku] selfTest failed:', r.details);
console.info('[BoardDuel] gomoku engine selfTest:', r.ok ? 'OK' : 'FAIL', r.details.join(' | '));