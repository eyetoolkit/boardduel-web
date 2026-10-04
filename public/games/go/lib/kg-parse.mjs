// KataGo v8..v16 binary model parser, ported from the MIT-licensed
// SoumyaK4/web-katrain implementation (src/engine/katago/{loadModelV8,binModelParser}.ts),
// cross-checked against lightvector/KataGo cpp/neuralnet/modeldesc.cpp / nninputs.cpp.
// MIT both sides. Pure JS, no deps: runs in Node and in the browser.

export class BinParser {
  constructor(data) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.idx = 0;
    this.dec = new TextDecoder('utf-8');
  }
  skipWs() {
    const d = this.data;
    while (this.idx < d.length) {
      const b = d[this.idx];
      if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09) { this.idx++; continue; }
      break;
    }
  }
  readToken() {
    this.skipWs();
    const start = this.idx;
    const d = this.data;
    while (this.idx < d.length) {
      const b = d[this.idx];
      if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09) break;
      this.idx++;
    }
    if (this.idx <= start) throw new Error('EOF reading token at ' + start);
    return this.dec.decode(d.subarray(start, this.idx));
  }
  readInt() {
    const t = this.readToken();
    const v = Number.parseInt(t, 10);
    if (!Number.isFinite(v)) throw new Error('Invalid int token: ' + t);
    return v;
  }
  readFloatAscii() {
    const t = this.readToken();
    const v = Number.parseFloat(t);
    if (!Number.isFinite(v)) throw new Error('Invalid float token: ' + t);
    return v;
  }
  readBinaryFloats(count) {
    this.skipWs();
    const d = this.data;
    if (this.idx + 5 > d.length) throw new Error('EOF at @BIN@ marker');
    if (!(d[this.idx] === 0x40 && d[this.idx + 1] === 0x42 && d[this.idx + 2] === 0x49 &&
          d[this.idx + 3] === 0x4e && d[this.idx + 4] === 0x40)) {
      throw new Error('Expected @BIN@ marker at ' + this.idx);
    }
    this.idx += 5;
    const byteLen = count * 4;
    const absStart = d.byteOffset + this.idx;
    const absEnd = absStart + byteLen;
    if (absEnd > d.buffer.byteLength) throw new Error('EOF reading ' + count + ' floats');
    const out = new Float32Array(d.buffer.slice(absStart, absEnd));
    this.idx += byteLen;
    this.skipWs();
    return out;
  }
  get remaining() { return this.data.length - this.idx; }
  atEof() {
    return this.remaining === 0;
  }
}

function parseBN(p) {
  const name = p.readToken();
  const channels = p.readInt();
  const epsilon = p.readFloatAscii();
  const hasScale = p.readInt() !== 0;
  const hasBias = p.readInt() !== 0;
  const mean = p.readBinaryFloats(channels);
  const variance = p.readBinaryFloats(channels);
  const scale = hasScale ? p.readBinaryFloats(channels) : new Float32Array(channels).fill(1);
  const bias = hasBias ? p.readBinaryFloats(channels) : new Float32Array(channels).fill(0);
  const mergedScale = new Float32Array(channels);
  const mergedBias = new Float32Array(channels);
  for (let i = 0; i < channels; i++) {
    const ms = scale[i] / Math.sqrt(variance[i] + epsilon);
    mergedScale[i] = ms;
    mergedBias[i] = bias[i] - ms * mean[i];
  }
  // KEEP_RAW_BN is dev-only diagnostics (never set in production builds).
  const raw = globalThis.KEEP_RAW_BN ? { mean, variance, scale, bias, epsilon, hasScale, hasBias } : null;
  return { name, channels, mergedScale, mergedBias, raw };
}

function parseAct(p, ver) {
  const name = p.readToken();
  if (ver < 11) return { name, kind: 'relu' };
  const k = p.readToken();
  if (k === 'ACTIVATION_IDENTITY') return { name, kind: 'identity' };
  if (k === 'ACTIVATION_RELU') return { name, kind: 'relu' };
  if (k === 'ACTIVATION_MISH') return { name, kind: 'mish' };
  throw new Error('Unsupported activation ' + k);
}

function parseConv(p) {
  const name = p.readToken();
  const kernelY = p.readInt();
  const kernelX = p.readInt();
  const inC = p.readInt();
  const outC = p.readInt();
  const dilationY = p.readInt();
  const dilationX = p.readInt();
  const weights = p.readBinaryFloats(kernelY * kernelX * inC * outC);
  return { name, kernelY, kernelX, inC, outC, dilationY, dilationX, weights };
}

function parseMatMul(p) {
  const name = p.readToken();
  const inC = p.readInt();
  const outC = p.readInt();
  return { name, inC, outC, weights: p.readBinaryFloats(inC * outC) };
}

function parseMatBias(p) {
  const name = p.readToken();
  const channels = p.readInt();
  return { name, channels, weights: p.readBinaryFloats(channels) };
}

export function parseKataGoModelV8(raw) {
  const p = new BinParser(raw);
  const modelName = p.readToken();
  const modelVersion = p.readInt();
  if (modelVersion < 8 || modelVersion > 16) throw new Error('Unsupported modelVersion ' + modelVersion);
  const numInputChannels = p.readInt();
  const numInputGlobalChannels = p.readInt();

  const postProcess = modelVersion >= 13
    ? {
        tdScoreMultiplier: p.readFloatAscii(), scoreMeanMultiplier: p.readFloatAscii(),
        scoreStdevMultiplier: p.readFloatAscii(), leadMultiplier: p.readFloatAscii(),
        varianceTimeMultiplier: p.readFloatAscii(), shorttermValueErrorMultiplier: p.readFloatAscii(),
        shorttermScoreErrorMultiplier: p.readFloatAscii(), outputScaleMultiplier: 1.0,
      }
    : {
        tdScoreMultiplier: 20.0, scoreMeanMultiplier: 20.0, scoreStdevMultiplier: 20.0,
        leadMultiplier: 20.0, varianceTimeMultiplier: 40.0, shorttermValueErrorMultiplier: 0.25,
        shorttermScoreErrorMultiplier: 30.0, outputScaleMultiplier: 1.0,
      };

  let metaEncoderVersion = 0, metaEncoder;
  if (modelVersion >= 15) {
    metaEncoderVersion = p.readInt();
    for (let i = 0; i < 7; i++) p.readInt();
    if (metaEncoderVersion !== 0 && metaEncoderVersion !== 1) throw new Error('Unsupported metaEncoderVersion');
  }

  p.readToken(); // trunk name
  const numBlocks = p.readInt();
  const trunkNumChannels = p.readInt();
  const midNumChannels = p.readInt();
  const regularNumChannels = p.readInt();
  const dilatedNumChannels = p.readInt();
  const gpoolNumChannels = p.readInt();
  if (modelVersion >= 15) {
    const trunkNormKind = p.readInt();
    if (trunkNormKind !== 0) throw new Error('Unsupported trunk norm kind ' + trunkNormKind);
    for (let i = 0; i < 5; i++) p.readInt();
  }

  const conv1 = parseConv(p);
  const ginput = parseMatMul(p);

  if (metaEncoderVersion > 0) {
    p.readToken();
    const numInputMetaChannels = p.readInt();
    const mul1 = parseMatMul(p);
    const bias1 = parseMatBias(p);
    const act1 = parseAct(p, modelVersion);
    const mul2 = parseMatMul(p);
    const bias2 = parseMatBias(p);
    const act2 = parseAct(p, modelVersion);
    const mul3 = parseMatMul(p);
    metaEncoder = { numInputMetaChannels, mul1, bias1, act1, mul2, bias2, act2, mul3 };
  }

  function parseBlock() {
    const kind = p.readToken();
    if (kind === 'ordinary_block') {
      const name = p.readToken();
      return { kind: 'ordinary', name, preBN: parseBN(p), preAct: parseAct(p, modelVersion),
               w1: parseConv(p), midBN: parseBN(p), midAct: parseAct(p, modelVersion), w2: parseConv(p) };
    }
    if (kind === 'gpool_block') {
      const name = p.readToken();
      return { kind: 'gpool', name, preBN: parseBN(p), preAct: parseAct(p, modelVersion),
               w1a: parseConv(p), w1b: parseConv(p), gpoolBN: parseBN(p), gpoolAct: parseAct(p, modelVersion),
               w1r: parseMatMul(p), midBN: parseBN(p), midAct: parseAct(p, modelVersion), w2: parseConv(p) };
    }
    if (kind === 'nested_bottleneck_block') {
      const name = p.readToken();
      const numInner = p.readInt();
      const preBN = parseBN(p), preAct = parseAct(p, modelVersion), preConv = parseConv(p);
      const inner = [];
      for (let i = 0; i < numInner; i++) inner.push(parseBlock());
      return { kind: 'nested_bottleneck', name, numInner, preBN, preAct, preConv, inner,
               postBN: parseBN(p), postAct: parseAct(p, modelVersion), postConv: parseConv(p) };
    }
    throw new Error('Unsupported trunk block kind ' + kind);
  }

  const blocks = [];
  for (let i = 0; i < numBlocks; i++) blocks.push(parseBlock());
  const tipBN = parseBN(p);
  const tipAct = parseAct(p, modelVersion);

  const policyName = p.readToken();
  const policy = {
    name: policyName,
    p1: parseConv(p), g1: parseConv(p), g1BN: parseBN(p), g1Act: parseAct(p, modelVersion),
    gpoolToBias: parseMatMul(p), p1BN: parseBN(p), p1Act: parseAct(p, modelVersion),
    p2: parseConv(p), passMul: parseMatMul(p),
  };
  if (modelVersion >= 15) {
    policy.passBias = parseMatBias(p);
    policy.passAct = parseAct(p, modelVersion);
    policy.passMul2 = parseMatMul(p);
  }

  const valueName = p.readToken();
  const value = {
    name: valueName,
    v1: parseConv(p), v1BN: parseBN(p), v1Act: parseAct(p, modelVersion),
    v2: parseMatMul(p), v2Bias: parseMatBias(p), v2Act: parseAct(p, modelVersion),
    v3: parseMatMul(p), v3Bias: parseMatBias(p),
    sv3: parseMatMul(p), sv3Bias: parseMatBias(p),
    ownership: parseConv(p),
  };

  return {
    modelName, modelVersion, numInputChannels, numInputGlobalChannels, postProcess,
    numBlocks, trunkNumChannels, midNumChannels, regularNumChannels, dilatedNumChannels, gpoolNumChannels,
    conv1, ginput, blocks, tipBN, tipAct, policy, value,
    policyOutChannels: policy.p2.outC,
    scoreValueChannels: value.sv3.outC,
    bytesRemaining: p.remaining,
    bytesTotal: raw.byteLength,
  };
}

export function summarize(parsed) {
  let nConv = 0, nMM = 0, params = 0;
  const walk = (b) => {
    if (b.kind === 'ordinary') { nConv += 2; params += b.w1.weights.length + b.w2.weights.length; }
    else if (b.kind === 'gpool') { nConv += 3; nMM += 1; params += b.w1a.weights.length + b.w1b.weights.length + b.w1r.weights.length + b.w2.weights.length; }
    else {
      nConv += 2; params += b.preConv.weights.length + b.postConv.weights.length;
      b.inner.forEach(walk);
    }
    params += b.preBN.channels * 2;
    params += b.midBN ? b.midBN.channels * 2 : 0;
  };
  parsed.blocks.forEach(walk);
  params += parsed.conv1.weights.length + parsed.ginput.weights.length + parsed.tipBN.channels * 2;
  const P = parsed.policy;
  params += P.p1.weights.length + P.g1.weights.length + P.gpoolToBias.weights.length + P.p2.weights.length + P.passMul.weights.length;
  const V = parsed.value;
  params += V.v1.weights.length + V.v2.weights.length + V.v3.weights.length + V.sv3.weights.length + V.ownership.weights.length;
  return { blocksKinds: parsed.blocks.map(b => b.kind), nConv, nMM, params };
}
