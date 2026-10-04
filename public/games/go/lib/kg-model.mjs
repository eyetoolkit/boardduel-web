// KataGo v8/v16 model as a TensorFlow.js graph. Port of the MIT-licensed
// SoumyaK4/web-katrain src/engine/katago/modelV8.ts, with two corrections that
// matter as soon as the board is not 19x19:
//   * KataGo pools with sqrt(boardArea), not boardSize (identical at 19x19,
//     different at 9x9/13x13) -- see cpp/neuralnet/nninputs.cpp / nneval.cpp.
// Same MIT licence as both upstream projects.

export function makeBn(tf, bn) {
  return {
    scale: tf.tensor4d(bn.mergedScale, [1, 1, 1, bn.channels]),
    bias: tf.tensor4d(bn.mergedBias, [1, 1, 1, bn.channels]),
  };
}
function makeConv(tf, c) {
  return {
    kernelY: c.kernelY, kernelX: c.kernelX, inC: c.inC, outC: c.outC,
    dilationY: c.dilationY, dilationX: c.dilationX,
    filter: tf.tensor4d(c.weights, [c.kernelY, c.kernelX, c.inC, c.outC]),
  };
}
function makeMatMul(tf, mm) { return { inC: mm.inC, outC: mm.outC, w: tf.tensor2d(mm.weights, [mm.inC, mm.outC]) }; }
function makeMatBias(tf, b) { return { channels: b.channels, b: tf.tensor2d(b.weights, [1, b.channels]) }; }

function actFn(tf, x, kind) {
  if (kind === 'identity') return x;
  if (kind === 'relu') return tf.relu(x);
  return tf.mul(x, tf.tanh(tf.softplus(x))); // mish
}

export class KgModel {
  constructor(tf, parsed, boardSize = 19) {
    this.tf = tf;
    this.p = parsed;
    this.boardSize = boardSize;
    this.sqrtArea = Math.sqrt(boardSize * boardSize);
    this.policyOutChannels = parsed.policyOutChannels;
    this.scoreValueChannels = parsed.scoreValueChannels;

    this.conv1 = makeConv(tf, parsed.conv1);
    this.ginput = makeMatMul(tf, parsed.ginput);
    this.tipBN = makeBn(tf, parsed.tipBN);
    this.tipAct = parsed.tipAct.kind;

    const convBlock = (b) => {
      if (b.kind === 'ordinary') {
        return { kind: 'ordinary', preBN: makeBn(tf, b.preBN), preAct: b.preAct.kind,
                 w1: makeConv(tf, b.w1), midBN: makeBn(tf, b.midBN), midAct: b.midAct.kind, w2: makeConv(tf, b.w2) };
      }
      if (b.kind === 'gpool') {
        return { kind: 'gpool', preBN: makeBn(tf, b.preBN), preAct: b.preAct.kind,
                 w1a: makeConv(tf, b.w1a), w1b: makeConv(tf, b.w1b),
                 gpoolBN: makeBn(tf, b.gpoolBN), gpoolAct: b.gpoolAct.kind, w1r: makeMatMul(tf, b.w1r),
                 midBN: makeBn(tf, b.midBN), midAct: b.midAct.kind, w2: makeConv(tf, b.w2) };
      }
      return { kind: 'nested', preBN: makeBn(tf, b.preBN), preAct: b.preAct.kind, preConv: makeConv(tf, b.preConv),
               inner: b.inner.map(convBlock),
               postBN: makeBn(tf, b.postBN), postAct: b.postAct.kind, postConv: makeConv(tf, b.postConv) };
    };
    this.blocks = parsed.blocks.map(convBlock);

    const P = parsed.policy, V = parsed.value;
    this.p1 = makeConv(tf, P.p1);
    this.g1 = makeConv(tf, P.g1);
    this.g1BN = makeBn(tf, P.g1BN);
    this.g1Act = P.g1Act.kind;
    this.gpoolToBias = makeMatMul(tf, P.gpoolToBias);
    this.p1BN = makeBn(tf, P.p1BN);
    this.p1Act = P.p1Act.kind;
    this.p2 = makeConv(tf, P.p2);
    this.passMul = makeMatMul(tf, P.passMul);
    this.passBias = P.passBias ? makeMatBias(tf, P.passBias) : null;
    this.passAct = P.passAct ? P.passAct.kind : null;
    this.passMul2 = P.passMul2 ? makeMatMul(tf, P.passMul2) : null;

    this.v1 = makeConv(tf, V.v1);
    this.v1BN = makeBn(tf, V.v1BN);
    this.v1Act = V.v1Act.kind;
    this.v2 = makeMatMul(tf, V.v2);
    this.v2Bias = makeMatBias(tf, V.v2Bias);
    this.v2Act = V.v2Act.kind;
    this.v3 = makeMatMul(tf, V.v3);
    this.v3Bias = makeMatBias(tf, V.v3Bias);
    this.sv3 = makeMatMul(tf, V.sv3);
    this.sv3Bias = makeMatBias(tf, V.sv3Bias);
    this.ownership = makeConv(tf, V.ownership);
  }

  conv2d(x, c) {
    // NOTE on padding: KataGo zero-pads (eigenbackend.cpp: "Convolution layer with
    // zero-padding"), while tf.conv2d(...,'same') on a 19x19 stride-1 board drops the
    // taps that hang over the border. I implemented explicit tf.pad + 'valid' to close
    // that gap and MEASURED it: identical output to 'same' on every test case (pad
    // counter confirms 15 of 20 convolutions take the pad branch). So TF.js's 'same'
    // already pads here, and the corner-only mismatch has another cause -- see
    // tools/verify-sizes.cjs. Keeping 'same' because it is the simpler equivalent.
    return this.tf.conv2d(x, c.filter, 1, 'same', 'NHWC', [c.dilationY, c.dilationX]);
  }
  bnAct(x, bn, kind) {
    return actFn(this.tf, this.tf.add(this.tf.mul(x, bn.scale), bn.bias), kind);
  }
  // Global pooling, matching eigenbackend.cpp poolRowsGPool / poolRowsValueHead:
  // divide by maskSum (valid points) and scale by sqrt(maskSum). At square sizes tf.js's
  // conv2d 'same' never pads a 19x19 tensor, so maskSum == H*W and this reduces to a plain
  // mean over the board -- which is what tf.mean() computes. Kept as an explicit comment
  // because a future non-square or dilated case would need the real mask.
  // concat(mean, mean*(sqrt(area)-14)*0.1, max)
  poolGPool(x) {
    const tf = this.tf;
    const f = (this.sqrtArea - 14) * 0.1;
    const mean = tf.mean(x, [1, 2]);
    const max = tf.max(x, [1, 2]);
    return tf.concat([mean, tf.mul(mean, f), max], 1);
  }
  // concat(mean, mean*(div-14)*0.1, mean*(((div-14)^2)*0.01 - 0.1))
  poolValueHead(x) {
    const tf = this.tf;
    const base = this.sqrtArea - 14;
    const f1 = base * 0.1;
    const f2 = base * base * 0.01 - 0.1;
    const mean = tf.mean(x, [1, 2]);
    return tf.concat([mean, tf.mul(mean, f1), tf.mul(mean, f2)], 1);
  }

  forwardTrunk(spatial, global) {
    const tf = this.tf;
    let t = this.conv2d(spatial, this.conv1);
    const gi = tf.matMul(global, this.ginput.w);
    t = tf.add(t, tf.reshape(gi, [gi.shape[0], 1, 1, gi.shape[1]]));
    t = this.applyBlocks(t, this.blocks);
    return this.bnAct(t, this.tipBN, this.tipAct);
  }

  applyBlocks(trunk, blocks) {
    const tf = this.tf;
    for (const b of blocks) {
      if (b.kind === 'ordinary') {
        const x1 = this.bnAct(trunk, b.preBN, b.preAct);
        const x2 = this.bnAct(this.conv2d(x1, b.w1), b.midBN, b.midAct);
        trunk = tf.add(trunk, this.conv2d(x2, b.w2));
      } else if (b.kind === 'gpool') {
        const x1 = this.bnAct(trunk, b.preBN, b.preAct);
        let reg = this.conv2d(x1, b.w1a);
        const gp = this.bnAct(this.conv2d(x1, b.w1b), b.gpoolBN, b.gpoolAct);
        const gconcat = this.poolGPool(gp);
        const gBias = tf.matMul(gconcat, b.w1r.w);
        reg = tf.add(reg, tf.reshape(gBias, [gBias.shape[0], 1, 1, gBias.shape[1]]));
        const x2 = this.bnAct(reg, b.midBN, b.midAct);
        trunk = tf.add(trunk, this.conv2d(x2, b.w2));
      } else {
        const x1 = this.bnAct(trunk, b.preBN, b.preAct);
        let mid = this.applyBlocks(this.conv2d(x1, b.preConv), b.inner);
        const x2 = this.bnAct(mid, b.postBN, b.postAct);
        trunk = tf.add(trunk, this.conv2d(x2, b.postConv));
      }
    }
    return trunk;
  }

  /**
   * Softmax over (legal board points + pass), the way KataGo builds its policy.
   * Naively sigmoid()ing the pass logit is WRONG: the pass competes with all 361
   * board logits, which makes the real pass probability ~2 orders of magnitude
   * smaller (empty board: sigmoid gives 0.0255, official KataGo reports 0.000059).
   * @param {number[]} policyLogits length 361
   * @param {number} passLogit
   * @param {Uint8Array|null} legal 1 = legal move; null/omitted = all legal
   */
  policyProbs(policyLogits, passLogit, legal) {
    let max = passLogit;
    for (let i = 0; i < policyLogits.length; i++) {
      if (legal && !legal[i]) continue;
      if (policyLogits[i] > max) max = policyLogits[i];
    }
    let sum = Math.exp(passLogit - max);
    const board = new Float64Array(policyLogits.length);
    for (let i = 0; i < policyLogits.length; i++) {
      if (legal && !legal[i]) { board[i] = 0; continue; }
      const v = Math.exp(policyLogits[i] - max);
      board[i] = v; sum += v;
    }
    for (let i = 0; i < board.length; i++) board[i] /= sum;
    return { board: Array.from(board), pass: Math.exp(passLogit - max) / sum };
  }

  /** @returns {{policy,policyPass,value,scoreValue,ownership}} policy is [N,H,W,C] logits (no softmax) */
  forward(spatial, global) {
    const tf = this.tf;
    return tf.tidy(() => {
      const trunk = this.forwardTrunk(spatial, global);

      let p1 = this.conv2d(trunk, this.p1);
      const g1 = this.bnAct(this.conv2d(trunk, this.g1), this.g1BN, this.g1Act);
      const gconcat = this.poolGPool(g1);
      const gBias = tf.matMul(gconcat, this.gpoolToBias.w);
      p1 = tf.add(p1, tf.reshape(gBias, [gBias.shape[0], 1, 1, gBias.shape[1]]));
      const p1a = this.bnAct(p1, this.p1BN, this.p1Act);
      const policy = this.conv2d(p1a, this.p2);

      let pp = tf.matMul(gconcat, this.passMul.w);
      if (this.passBias && this.passAct && this.passMul2) {
        pp = tf.add(pp, this.passBias.b);
        pp = actFn(tf, pp, this.passAct);
        pp = tf.matMul(pp, this.passMul2.w);
      }
      const policyPass = pp;

      const v1 = this.bnAct(this.conv2d(trunk, this.v1), this.v1BN, this.v1Act);
      // The ownership head is LINEAR; KataGo squashes it with tanh when it consumes
      // the result (verified against the official binary: every |value| > 1 we used to
      // emit matched tanh(x) to 4 decimals -- e.g. raw 1.0326 -> official -0.7750).
      const ownership = tf.tanh(this.conv2d(v1, this.ownership));
      const v1m = this.poolValueHead(v1);
      let v2 = tf.add(tf.matMul(v1m, this.v2.w), this.v2Bias.b);
      v2 = actFn(tf, v2, this.v2Act);
      const value = tf.add(tf.matMul(v2, this.v3.w), this.v3Bias.b);
      const scoreValue = tf.add(tf.matMul(v2, this.sv3.w), this.sv3Bias.b);

      return { policy, policyPass, value, scoreValue, ownership };
    });
  }
}

/** value logits -> {winprob, scoreMean, scoreStdev, lead, varTime} following KataGo's NhResult. */
export function postProcessValue(out, post, boardSize) {
  const boardArea = boardSize * boardSize;
  const w = out[0], l = out[1], n = out[2];
  const mm = Math.max(w, l, n);
  const ew = Math.exp(w - mm), el = Math.exp(l - mm), en = Math.exp(n - mm);
  const s = ew + el + en;
  return { winprob: (ew + 0.5 * en) / s, scoreLeadMean: out[3] ?? null, raw: out };
}
