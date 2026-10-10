
function validateCandles(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error("Candles must be a non-empty array.");
  }

  for (const c of candles) {
    for (const key of ["open", "high", "low", "close", "volume"]) {
      if (!Number.isFinite(c[key])) {
        throw new Error(`Invalid candle field: ${key}`);
      }
    }

    if (
      c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 ||
      c.volume < 0 || c.high < c.low ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close)
    ) {
      throw new Error("Invalid OHLCV candle values.");
    }
  }
}

function ema(values, period = 20) {
  if (values.length < period) return [];

  const result = Array(values.length).fill(null);
  const multiplier = 2 / (period + 1);

  let previous =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  result[period - 1] = previous;

  for (let i = period; i < values.length; i++) {
    previous = (values[i] - previous) * multiplier + previous;
    result[i] = previous;
  }

  return result;
}

function rsi(values, period = 14) {
  const result = Array(values.length).fill(null);
  if (values.length <= period) return result;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const value = () => {
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  };

  result[period] = value();

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain =
      (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss =
      (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = value();
  }

  return result;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line = Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (fastLine[i] != null && slowLine[i] != null) {
      line[i] = fastLine[i] - slowLine[i];
    }
  }

  const first = slow - 1;
  const valid = line.slice(first).filter(Number.isFinite);
  const signalValues = ema(valid, signalPeriod);
  const signal = Array(values.length).fill(null);
  const histogram = Array(values.length).fill(null);

  for (let i = 0; i < signalValues.length; i++) {
    const index = first + i;

    if (signalValues[i] != null) {
      signal[index] = signalValues[i];
      histogram[index] = line[index] - signal[index];
    }
  }

  return { line, signal, histogram };
}

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;

    const previousClose = candles[i - 1].close;

    return Math.max(
      c.high - c.low,
      Math.abs(c.high - previousClose),
      Math.abs(c.low - previousClose)
    );
  });

  const result = Array(candles.length).fill(null);
  if (tr.length < period) return result;

  let previous = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = previous;

  for (let i = period; i < tr.length; i++) {
    previous = (previous * (period - 1) + tr[i]) / period;
    result[i] = previous;
  }

  return result;
}

function bollinger(values, period = 20, multiplier = 2) {
  return values.map((_, i) => {
    if (i + 1 < period) return null;

    const window = values.slice(i + 1 - period, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance =
      window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);

    return {
      middle: mean,
      upper: mean + multiplier * deviation,
      lower: mean - multiplier * deviation,
    };
  });
}

function midpoint(candles, end, period) {
  const start = end - period + 1;
  if (start < 0) return null;

  const window = candles.slice(start, end + 1);
  const highest = Math.max(...window.map(c => c.high));
  const lowest = Math.min(...window.map(c => c.low));

  return (highest + lowest) / 2;
}

function ichimoku(candles) {
  return candles.map((_, i) => {
    const tenkan = midpoint(candles, i, 9);
    const kijun = midpoint(candles, i, 26);
    const spanB = midpoint(candles, i, 52);

    return {
      tenkanSen: tenkan,
      kijunSen: kijun,
      senkouSpanA:
        tenkan == null || kijun == null ? null : (tenkan + kijun) / 2,
      senkouSpanB: spanB,
      chikouSpan: i >= 26 ? candles[i - 26].close : null,
    };
  });
}

function supportResistance(candles, lookback = 20) {
  const recent = candles.slice(-lookback);

  if (!recent.length) {
    return { support: null, resistance: null };
  }

  return {
    support: Math.min(...recent.map(c => c.low)),
    resistance: Math.max(...recent.map(c => c.high)),
  };
}

function pivotPoints(previousCandle) {
  const { high, low, close } = previousCandle;
  const pivot = (high + low + close) / 3;

  return {
    pivot,
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
    r2: pivot + (high - low),
    s2: pivot - (high - low),
    r3: high + 2 * (pivot - low),
    s3: low - 2 * (high - pivot),
  };
}

function fibonacci(candles, lookback = 100) {
  const recent = candles.slice(-lookback);
  if (!recent.length) return null;

  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  const range = high - low;

  return {
    swingHigh: high,
    swingLow: low,
    levels: {
      "0": high,
      "0.236": high - range * 0.236,
      "0.382": high - range * 0.382,
      "0.5": high - range * 0.5,
      "0.618": high - range * 0.618,
      "0.786": high - range * 0.786,
      "1": low,
    },
    note: "Retracement dihitung dari swing high ke swing low pada lookback.",
  };
}

function analyzeCandles(candles) {
  validateCandles(candles);

  const closes = candles.map(c => c.close);
  const last = candles.length - 1;
  const macdResult = macd(closes);

  return {
    candleCount: candles.length,
    latestClose: closes[last],
    indicators: {
      ema20: ema(closes, 20)[last] ?? null,
      ema50: ema(closes, 50)[last] ?? null,
      ema200: ema(closes, 200)[last] ?? null,
      rsi14: rsi(closes, 14)[last] ?? null,
      macd: macdResult.line[last],
      macdSignal: macdResult.signal[last],
      macdHistogram: macdResult.histogram[last],
      atr14: atr(candles, 14)[last],
      bollinger20: bollinger(closes, 20)[last],
      ichimoku: ichimoku(candles)[last],
    },
    supportResistance: supportResistance(candles),
    pivotPoints: candles.length >= 2
      ? pivotPoints(candles[last - 1])
      : null,
    fibonacci: fibonacci(candles),
    dataReady: {
      ema200: candles.length >= 200,
      ichimoku: candles.length >= 52,
      general: candles.length >= 200,
    },
    note: "Hasil berdasarkan candle input, bukan rekomendasi finansial.",
  };
}

export {
  ema,
  rsi,
  macd,
  atr,
  bollinger,
  ichimoku,
  supportResistance,
  pivotPoints,
  fibonacci,
  analyzeCandles,
};
