// Signal engine: classic technical indicators combined into an indicative
// 30-day "potential gain" estimate with a confidence band.
//
// These are momentum/mean-reversion heuristics, not a forecast of the future.
// The API and UI label every number as indicative and not financial advice.

const TRADING_DAYS_PER_YEAR = 252;
const HORIZON_DAYS = 30;

function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function dailyReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

function stdev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function analyse(closes) {
  const price = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes);
  const returns = dailyReturns(closes);
  const recentReturns = returns.slice(-60);
  const dailyVol = stdev(recentReturns);
  const annualVol = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);

  const momentum20 = closes.length > 20 ? price / closes[closes.length - 21] - 1 : 0;
  const momentum60 = closes.length > 60 ? price / closes[closes.length - 61] - 1 : 0;

  // --- Component scores, each roughly in [-1, 1] ---
  const trendScore = sma20 && sma50 ? clamp(((sma20 - sma50) / sma50) * 12, -1, 1) : 0;
  const momentumScore = clamp(momentum20 * 8 + momentum60 * 3, -1, 1);
  // RSI: oversold (<30) hints mean-reversion upside, overbought (>70) downside risk.
  const rsiScore = clamp((50 - rsi14) / 35, -1, 1);
  const composite = clamp(0.45 * trendScore + 0.4 * momentumScore + 0.15 * rsiScore, -1, 1);

  // --- Indicative 30-day expected move ---
  const horizonVol = dailyVol * Math.sqrt(HORIZON_DAYS);
  // Scale the composite signal by realised volatility: a strong signal on a
  // volatile stock implies a larger potential move than on a quiet one.
  const expectedGain = composite * horizonVol * 0.9;
  const gainLow = expectedGain - horizonVol;
  const gainHigh = expectedGain + horizonVol;

  // Confidence: stronger when trend and momentum agree and volatility is tame.
  const agreement = 1 - Math.abs(trendScore - momentumScore) / 2;
  const volPenalty = clamp(annualVol / 0.45, 0, 1);
  const confidence = clamp(0.25 + 0.55 * agreement - 0.25 * volPenalty + 0.2 * Math.abs(composite), 0.05, 0.9);

  let signal;
  if (composite > 0.35) signal = 'strong-up';
  else if (composite > 0.1) signal = 'up';
  else if (composite < -0.35) signal = 'strong-down';
  else if (composite < -0.1) signal = 'down';
  else signal = 'neutral';

  return {
    price,
    horizonDays: HORIZON_DAYS,
    signal,
    score: Math.round((composite + 1) * 50), // 0-100 display score
    expectedGainPct: Number((expectedGain * 100).toFixed(2)),
    gainRangePct: [Number((gainLow * 100).toFixed(2)), Number((gainHigh * 100).toFixed(2))],
    confidencePct: Math.round(confidence * 100),
    indicators: {
      sma20: sma20 ? Number(sma20.toFixed(2)) : null,
      sma50: sma50 ? Number(sma50.toFixed(2)) : null,
      rsi14: Number(rsi14.toFixed(1)),
      momentum20Pct: Number((momentum20 * 100).toFixed(2)),
      momentum60Pct: Number((momentum60 * 100).toFixed(2)),
      annualVolatilityPct: Number((annualVol * 100).toFixed(1))
    }
  };
}
