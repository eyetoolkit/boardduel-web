// KataGo v7 input features (22 spatial planes + 19 globals).
// Authoritative spec: lightvector/KataGo cpp/neuralnet/nninputs.cpp :: NNInputs::fillRowV7
//
import { calculateArea } from './kg-area.mjs';
//
// Plane map:
//   0   on board (1 inside xSize*ySize only)
//   1   pla stones        2   opp stones
//   3,4,5  stone (either colour) with exactly 1,2,3 liberties
//   6   ko-ban / superko-banned locations
//   7,8 encore-only (0 for normal games)
//   9..13  location of each of the previous 5 moves (newest first)
//   14  stones in a group that is currently capturable-by-ladder
//   15  same, one move ago    16  same, two moves ago
//   17  ladder "working moves" points (only set when the laddered group belongs to opp)
//   18  pla area / ownership     19  opp area / ownership
//   20,21 second-encore colours (0 for normal games)
//
// Global map:
//   0..4  each of the previous 5 moves was a pass
//   5   selfKomi / 20
//   6   ko rule != simple      7   +0.5 positional / -0.5 situational
//   8   multi-stone suicide legal     9   territory scoring
//   10  tax seki|all          11  tax all
//   12,13 encore phase        14  pass would end phase
//   15,16 playout doubling advantage   17  button
//   18  komi parity wave (area scoring only)

export const SPATIAL = 22;
export const GLOBAL = 19;

// Must mirror KataGo's default GTP ruleset ("TrompTaylor"):
//   ko = POSITIONAL, multiStoneSuicide = legal, scoring = AREA, tax = NONE, no button.
// Verified against lightvector/KataGo `Rules::parseRules("tromp-taylor")` as dumped by
// GTP `showboard` ("ko":"POSITIONAL","scoring":"AREA","suicide":true,"tax":"NONE").
// Getting these wrong silently shifts G[6..11] and the G[18] parity gate.
export const DEFAULT_RULES = {
  ko: 'positional',       // 'simple' | 'positional' | 'spight' | 'situational'
  suicide: true,          // multiStoneSuicideLegal
  scoring: 'area',        // 'area' | 'territory'
  tax: 'none',            // 'none' | 'seki' | 'all'
  button: false,
};

function computeLiberties(board, xSize, ySize, libs, owners) {
  const N = xSize * ySize;
  owners.fill(-1);
  let next = 0;
  const stack = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    const c = board[start];
    if (c === 0 || owners[start] !== -1) continue;
    const gid = next++;
    let sp = 0;
    stack[sp++] = start;
    owners[start] = gid;
    const members = [start];
    let libs4 = 0;
    const visitedLib = new Set();
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % xSize, y = (p / xSize) | 0;
      const nb = [x + 1 < xSize ? p + 1 : -1, x > 0 ? p - 1 : -1,
                  y + 1 < ySize ? p + xSize : -1, y > 0 ? p - xSize : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (board[q] === 0) {
          if (!visitedLib.has(q)) { visitedLib.add(q); libs4++; }
        } else if (board[q] === c && owners[q] === -1) {
          owners[q] = gid;
          stack[sp++] = q;
          members.push(q);
        }
      }
    }
    for (const m of members) libs[m] = libs4;
  }
}

/**
 * @param {object} a
 *   board  Uint8Array(xSize*ySize): 0 empty, 1 black, 2 white
 *   toPlay 1 black | 2 white
 *   moves  array of {pos:number(-1=pass), player:1|2}, oldest first
 *   komi   number (points added to WHITE)
 *   koLoc  board index that is illegal for one move due to simple ko, or -1
 *   superkoBanned  optional Set/array of indices banned by positional superko
 *   rules  DEFAULT_RULES-shaped object
 *   areaMap optional Uint8Array with 1=pla area, 2=opp area (planes 18/19).
 *           Omit it: the encoder then runs its own port of KataGo's
 *           Board::calculateArea (lib/kg-area.mjs), which is what the official
 *           binary does under AREA + TAX_NONE. Only used when those rules are set;
 *           under any other ruleset planes 18/19 stay 0.
 *   ladder optional Uint8Array flags for plane 14 (and .prev/.prevPrev/.working)
 */
export function fillInputsV7(a, outSpatial, outGlobal) {
  const xSize = a.xSize ?? 19, ySize = a.ySize ?? 19;
  const N = xSize * ySize;
  const rules = { ...DEFAULT_RULES, ...(a.rules || {}) };
  const pla = a.toPlay, opp = pla === 1 ? 2 : 1;
  const board = a.board;
  const S = outSpatial, G = outGlobal;
  S.fill(0); G.fill(0);

  const libs = new Int32Array(N);
  const owners = new Int32Array(N);
  computeLiberties(board, xSize, ySize, libs, owners);

  for (let y = 0; y < ySize; y++) {
    for (let x = 0; x < xSize; x++) {
      const p = y * xSize + x;
      const base = p * SPATIAL;   // NHWC within the (xSize*ySize) region
      S[base + 0] = 1;
      const v = board[p];
      if (v === pla) S[base + 1] = 1;
      else if (v === opp) S[base + 2] = 1;
      if (v !== 0) {
        const n = libs[p];
        if (n === 1) S[base + 3] = 1;
        else if (n === 2) S[base + 4] = 1;
        else if (n === 3) S[base + 5] = 1;
      }
    }
  }

  if (a.koLoc != null && a.koLoc >= 0) S[a.koLoc * SPATIAL + 6] = 1;
  if (a.superkoBanned) for (const q of a.superkoBanned) { if (q !== a.koLoc) S[q * SPATIAL + 6] = 1; }

  // history planes 9..13 + pass globals 0..4
  const moves = a.moves || [];
  const expected = [opp, pla, opp, pla, opp];
  const historyPlanes = [9, 10, 11, 12, 13];
  let turns = 0;
  for (let i = 0; i < 5; i++) {
    const m = moves[moves.length - 1 - i];
    if (!m || m.player !== expected[i]) break;
    if (m.pos < 0) G[i] = 1; else S[m.pos * SPATIAL + historyPlanes[i]] = 1;
    turns++;
  }

  if (a.ladder) {
    for (let p = 0; p < N; p++) {
      if (a.ladder.now?.[p]) S[p * SPATIAL + 14] = 1;
      if (a.ladder.prev?.[p]) S[p * SPATIAL + 15] = 1;
      if (a.ladder.prevPrev?.[p]) S[p * SPATIAL + 16] = 1;
      if (a.ladder.working?.[p]) S[p * SPATIAL + 17] = 1;
    }
  }

  // Features 18,19 - current territory / area. KataGo only emits them when
  // scoringRule == SCORING_AREA && taxRule == TAX_NONE (nninputs.cpp: "hasAreaFeature"),
  // and then it calls Board::calculateArea, which also assigns ENCLOSED EMPTY POINTS to
  // their surrounding colour. Using stone colours alone left those points at 0 and made
  // positions with a corner eye disagree with the official binary by ~1.4e-2 winprob.
  const hasAreaFeature = rules.scoring === 'area' && rules.tax === 'none';
  if (hasAreaFeature) {
    const area = a.areaMap || calculateArea(board, xSize, ySize, !!rules.suicide);
    for (let p = 0; p < N; p++) {
      if (area[p] === pla) S[p * SPATIAL + 18] = 1;
      else if (area[p] === opp) S[p * SPATIAL + 19] = 1;
    }
  }

  const selfKomi = pla === 2 ? a.komi : -a.komi;
  G[5] = selfKomi / 20.0;
  if (rules.ko === 'positional' || rules.ko === 'spight') { G[6] = 1; G[7] = 0.5; }
  else if (rules.ko === 'situational') { G[6] = 1; G[7] = -0.5; }
  if (rules.suicide) G[8] = 1;
  if (rules.scoring === 'territory') G[9] = 1;
  if (rules.tax === 'seki') G[10] = 1;
  else if (rules.tax === 'all') { G[10] = 1; G[11] = 1; }
  G[14] = a.passWouldEndPhase ? 1 : 0;
  if (rules.button) G[17] = 1;

  if (rules.scoring === 'area') {
    // Which komi values can produce a jigo depends on board-area parity:
    //   even area -> even komis are drawable; odd area -> odd komis are drawable.
    // nninputs.cpp: bool drawableKomisAreEven = (xSize*ySize) % 2 == 0;
    // 19x19 = 361 (odd) -> odd branch, which the previous version never took.
    const drawableKomisAreEven = (xSize * ySize) % 2 === 0;
    let floor = drawableKomisAreEven
      ? Math.floor(selfKomi / 2.0) * 2.0
      : Math.floor((selfKomi - 1.0) / 2.0) * 2.0 + 1.0;
    let delta = selfKomi - floor;
    if (delta < 0) delta = 0;
    if (delta > 2) delta = 2;
    G[18] = delta < 0.5 ? delta : delta < 1.5 ? 1.0 - delta : delta - 2.0;
  }
  return { turns, libs, owners };
}
