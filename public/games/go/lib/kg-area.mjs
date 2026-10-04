/**
 * Port of lightvector/KataGo `Board::calculateArea` (cpp/game/board.cpp) with the
 * arguments nninputs.cpp uses for v7 features under AREA scoring + TAX_NONE:
 *
 *   calculateArea(area, nonPassAliveStones = true,
 *                 safeBigTerritories = true, unsafeBigTerritories = true,
 *                 isMultiStoneSuicideLegal = rules.suicide)
 *
 * This drives NN spatial planes 18/19. A stone-colour approximation is NOT enough:
 * an empty point fully enclosed by one colour is that colour's territory, and
 * KataGo additionally marks "big" empty regions. Getting this wrong made positions
 * with an enclosed corner eye disagree with the official binary by ~1.4e-2 winprob.
 *
 * The algorithm is Benson's algorithm for pass-alive groups, then territory marking.
 * Faithful to the C++ including the <=1 internal space rule and the
 * safe/unsafe big-territory branches.
 *
 * @param {Uint8Array} board  0 empty, 1 black, 2 white
 * @param {number} xSize
 * @param {number} ySize
 * @param {boolean} multiStoneSuicideLegal
 * @returns {Uint8Array} 0 = unowned/empty, 1 = black area, 2 = white area
 */
export function calculateArea(board, xSize, ySize, multiStoneSuicideLegal) {
  const N = xSize * ySize;
  const C_EMPTY = 0;
  const result = new Uint8Array(N); // C_EMPTY everywhere

  // Chain heads + next-in-chain, so "walk the chain" steps form a proper ring.
  const chainHead = new Int32Array(N).fill(-1);
  const nextInChain = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (board[i] === 0 || chainHead[i] !== -1) continue;
    const c = board[i];
    const members = [];
    const stack = [i];
    const seen = new Uint8Array(N);
    seen[i] = 1; chainHead[i] = i;
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      for (const q of neighbours(p, xSize, ySize)) {
        if (q < 0 || board[q] !== c || seen[q]) continue;
        seen[q] = 1; chainHead[q] = i; stack.push(q);
      }
    }
    for (let k = 0; k < members.length; k++) nextInChain[members[k]] = members[(k + 1) % members.length];
  }

  for (const pla of [1, 2]) calculateAreaForPla(board, xSize, ySize, pla, result, multiStoneSuicideLegal);

  // nonPassAliveStones = true: unclaimed points belong to whoever is on them.
  for (let i = 0; i < N; i++) if (result[i] === C_EMPTY) result[i] = board[i];
  return result;
}

function calculateAreaForPla(board, xSize, ySize, pla, result, multiStoneSuicideLegal) {
  const N = xSize * ySize;
  const opp = pla === 1 ? 2 : 1;
  const C_EMPTY = 0;

  const chainHead = new Int32Array(N).fill(-1);
  const nextInChain = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (board[i] === 0 || chainHead[i] !== -1) continue;
    const c = board[i];
    const members = [];
    const stack = [i];
    const seen = new Uint8Array(N);
    seen[i] = 1; chainHead[i] = i;
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      for (const q of neighbours(p, xSize, ySize)) {
        if (q < 0 || board[q] !== c || seen[q]) continue;
        seen[q] = 1; chainHead[q] = i; stack.push(q);
      }
    }
    for (let k = 0; k < members.length; k++) nextInChain[members[k]] = members[(k + 1) % members.length];
  }

  const isAdjacentToPla = (loc) => {
    for (const q of neighbours(loc, xSize, ySize)) if (q >= 0 && board[q] === pla) return true;
    return false;
  };
  const isAdjacentToPlaHead = (loc, head) => {
    for (const q of neighbours(loc, xSize, ySize)) if (q >= 0 && board[q] === pla && chainHead[q] === head) return true;
    return false;
  };

  // Regions of empty-or-opp points, as circular linked lists.
  const regionIdxByLoc = new Int32Array(N).fill(-1);
  const nextEmptyOrOpp = new Int32Array(N).fill(-1);
  const regionHeads = [];
  const vitalLists = [];       // per region: array of pla chain heads
  const numInternal = [];      // capped at 2
  const containsOpp = [];
  const bordersNonPassAlive = [];
  let atLeastOnePla = false;

  for (let start = 0; start < N; start++) {
    if (regionIdxByLoc[start] !== -1) continue;
    if (board[start] !== C_EMPTY) {
      if (board[start] === pla) atLeastOnePla = true;
      continue;
    }
    const ri = regionHeads.length;
    const head = start;
    regionHeads.push(head);
    vitalLists.push([]);
    numInternal.push(0);
    containsOpp.push(false);
    bordersNonPassAlive.push(false);
    // seed vital list from the head's adjacent pla chains
    const seed = [];
    for (const q of neighbours(head, xSize, ySize)) {
      if (q >= 0 && board[q] === pla) {
        const h = chainHead[q];
        if (!seed.includes(h)) seed.push(h);
      }
    }
    vitalLists[ri] = seed;

    // BFS the region
    const members = [];
    const queue = [head];
    regionIdxByLoc[head] = ri;
    let vlen = seed.length;
    for (let qi = 0; qi < queue.length; qi++) {
      const loc = queue[qi];
      if (vlen > 0 && (multiStoneSuicideLegal || board[loc] === C_EMPTY)) {
        const kept = vitalLists[ri].filter((h) => isAdjacentToPlaHead(loc, h));
        vitalLists[ri] = kept;
        vlen = kept.length;
      }
      if (numInternal[ri] < 2 && !isAdjacentToPla(loc)) numInternal[ri] += 1;
      if (board[loc] === opp) containsOpp[ri] = true;
      members.push(loc);
      for (const q of neighbours(loc, xSize, ySize)) {
        if (q < 0) continue;
        if ((board[q] === C_EMPTY || board[q] === opp) && regionIdxByLoc[q] === -1) {
          regionIdxByLoc[q] = ri;
          queue.push(q);
        }
      }
    }
    // close the ring
    for (let k = 0; k < members.length; k++) nextEmptyOrOpp[members[k]] = members[(k + 1) % members.length];
  }

  // all pla chain heads
  const plaHeads = [];
  for (let i = 0; i < N; i++) if (board[i] === pla && chainHead[i] === i) plaHeads.push(i);
  const killed = new Uint8Array(N);
  const vitalCount = new Int32Array(N);
  for (const h of plaHeads) vitalCount[h] = 0;
  vitalLists.forEach((list) => { for (const h of list) vitalCount[h] += 1; });

  // Benson iteration
  for (;;) {
    let killedAnything = false;
    for (const h of plaHeads) {
      if (killed[h]) continue;
      if (vitalCount[h] < 2) {
        killed[h] = 1;
        killedAnything = true;
        // walk the chain, marking bordering regions as no-longer-vital
        let cur = h;
        const guard = new Set();
        do {
          for (const adj of neighbours(cur, xSize, ySize)) {
            const ri = regionIdxByLoc[adj];
            if (ri >= 0 && !bordersNonPassAlive[ri] && (board[adj] === C_EMPTY || board[adj] === opp)) {
              bordersNonPassAlive[ri] = true;
              for (const ph of vitalLists[ri]) vitalCount[ph] -= 1;
            }
          }
          cur = nextInChain[cur];
          if (guard.has(cur)) break;
          guard.add(cur);
        } while (cur !== h);
      }
    }
    if (!killedAnything) break;
  }

  // pass-alive stones
  for (const h of plaHeads) {
    if (killed[h]) continue;
    let cur = h;
    const guard = new Set();
    do {
      result[cur] = pla;
      cur = nextInChain[cur];
      if (guard.has(cur)) break;
      guard.add(cur);
    } while (cur !== h);
  }

  // territory
  for (let ri = 0; ri < regionHeads.length; ri++) {
    const head = regionHeads[ri];
    let shouldMark = numInternal[ri] <= 1 && !bordersNonPassAlive[ri] && atLeastOnePla;
    if (!shouldMark) shouldMark = !containsOpp[ri] && !bordersNonPassAlive[ri] && atLeastOnePla; // safeBigTerritories
    if (shouldMark) {
      let cur = head;
      const guard = new Set();
      do {
        result[cur] = pla;
        cur = nextEmptyOrOpp[cur];
        if (guard.has(cur)) break;
        guard.add(cur);
      } while (cur !== head);
    } else {
      // unsafeBigTerritories, but ONLY if the opponent hasn't already claimed the stones
      // used to surround this region (board.cpp: shouldMarkIfEmpty). Omitting this guard
      // made an EMPTY board come back 100% black.
      const shouldMarkIfEmpty = !containsOpp[ri] && atLeastOnePla;
      if (shouldMarkIfEmpty) {
        let cur = head;
        const guard = new Set();
        do {
          if (result[cur] === C_EMPTY) result[cur] = pla;
          cur = nextEmptyOrOpp[cur];
          if (guard.has(cur)) break;
          guard.add(cur);
        } while (cur !== head);
      }
    }
  }
}

function* neighbours(p, xSize, ySize) {
  const x = p % xSize, y = (p / xSize) | 0;
  if (x + 1 < xSize) yield p + 1;
  if (x > 0) yield p - 1;
  if (y + 1 < ySize) yield p + xSize;
  if (y > 0) yield p - xSize;
}
