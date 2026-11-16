/* Falcon Quant Terminal (mobile) - pure logic, ported 1:1 from the Python backend
   (backend/indicators.py, signals.py, risk.py, paper.py, config.py).
   PAPER TRADING ONLY: nothing here can place a real order. No API keys anywhere.
   Works in the browser (window.QT) and in Node (module.exports) for unit tests. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ config (mirrors backend/config.py)
  const CONFIG = {
    SMA_PERIOD: 50, ATR_PERIOD: 14, SCAN_TOP_N: 20, CORR_LOOKBACK_DAYS: 60,
    DEFAULT_START_BALANCE: 300, DEFAULT_ATR_STOP_MULT: 3.0, DEFAULT_MAX_LEVERAGE: 1.0,
    DEFAULT_FEE_RATE: 0.0005, DEFAULT_SLIPPAGE: 0.0005, DEFAULT_ALLOW_SHORT: false, DEFAULT_CORR_THRESHOLD: 0.7,
    DEFAULT_PRESET: 'aggressive',
    STABLE_BASES: ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USD1', 'EUR', 'AEUR', 'XUSD', 'USDE', 'RLUSD', 'BFUSD'],
    // crypto tokens that just track a commodity price (tokenised gold) -> treated as non-crypto exposure
    COMMODITY_TOKENS: ['XAUT', 'PAXG'],
  };
  const PRESETS = {
    conservative: { risk_pct: 1.0, max_positions: 3, max_total_risk_pct: 3.0, max_corr_positions: 2,
      note: 'Previous default. Backtest 2020-26: ~16%/yr, worst fall -22.5% (OOS 2023+: 16.2%/yr, -15.1%).' },
    balanced: { risk_pct: 1.0, max_positions: 5, max_total_risk_pct: 5.0, max_corr_positions: 3,
      note: 'Backtest: 26.4%/yr, worst fall -33.0% (OOS: 16.6%/yr, -20.8%).' },
    aggressive: { risk_pct: 1.5, max_positions: 5, max_total_risk_pct: 7.5, max_corr_positions: 3,
      note: "DEFAULT (TONNY's choice). Backtest: 34.6%/yr, worst fall -43.9% (OOS: 23.1%/yr, -29.4%). Expect falls of 30-45%." },
  };

  // ------------------------------------------------------------------ indicators
  function sma(values, period) {
    if (period <= 0) throw new Error('period must be > 0');
    const out = new Array(values.length).fill(null);
    let s = 0;
    for (let i = 0; i < values.length; i++) {
      s += values[i];
      if (i >= period) s -= values[i - period];
      if (i >= period - 1) out[i] = s / period;
    }
    return out;
  }
  function trueRange(h, l, c) {
    return c.map((_, i) => i === 0 ? h[0] - l[0]
      : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  function atr(h, l, c, period = 14) {               // Wilder's ATR
    const tr = trueRange(h, l, c);
    const out = new Array(tr.length).fill(null);
    if (tr.length < period) return out;
    let prev = 0;
    for (let i = 0; i < period; i++) prev += tr[i];
    prev /= period; out[period - 1] = prev;
    for (let i = period; i < tr.length; i++) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
    return out;
  }
  function maxDrawdown(eq) {
    let peak = null, mdd = 0;
    for (const e of eq) {
      if (peak === null || e > peak) peak = e;
      if (peak && peak > 0) mdd = Math.min(mdd, e / peak - 1);
    }
    return mdd;
  }
  function parseKlines(raw, dropOpenCandle = true, nowMs = Date.now()) {
    const rows = raw.filter(k => !(dropOpenCandle && Number(k[6]) > nowMs));
    return { t: rows.map(k => Number(k[0])), close_time: rows.map(k => Number(k[6])),
      o: rows.map(k => +k[1]), h: rows.map(k => +k[2]), l: rows.map(k => +k[3]), c: rows.map(k => +k[4]), v: rows.map(k => +k[5]) };
  }
  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 3) return null;
    a = a.slice(-n); b = b.slice(-n);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    if (va <= 0 || vb <= 0) return null;
    return cov / Math.sqrt(va * vb);
  }
  function alignedReturnCorr(tA, cA, tB, cB, lookback = 60) {
    const mb = new Map(tB.map((t, i) => [t, cB[i]]));
    let common = [];
    tA.forEach((t, i) => { if (mb.has(t)) common.push([t, cA[i], mb.get(t)]); });
    common = common.slice(-(lookback + 1));
    if (common.length < 20) return null;
    const ra = [], rb = [];
    for (let i = 1; i < common.length; i++) { ra.push(common[i][1] / common[i - 1][1] - 1); rb.push(common[i][2] / common[i - 1][2] - 1); }
    return correlation(ra, rb);
  }

  // ------------------------------------------------------------------ signals (live rule only)
  const fmtSigned = (x, d = 1) => (x >= 0 ? '+' : '-') + Math.abs(x).toFixed(d);
  function trendState(closes, period = CONFIG.SMA_PERIOD) {
    if (closes.length < period) return [0, null, null];
    const s = sma(closes, period)[closes.length - 1];
    const c = closes[closes.length - 1];
    return [c > s ? 1 : c < s ? -1 : 0, s, (c / s - 1) * 100];
  }
  function stateSince(closes, times, period = CONFIG.SMA_PERIOD) {
    const s = sma(closes, period);
    const n = closes.length;
    if (!n || s[n - 1] === null) return null;
    const cur = closes[n - 1] > s[n - 1];
    let k = n - 1;
    while (k - 1 >= 0 && s[k - 1] !== null && (closes[k - 1] > s[k - 1]) === cur) k--;
    return (k > 0 && s[k - 1] !== null) ? times[k] : null;
  }
  /** Live rule: LONG if last CLOSED daily candle > SMA50; else SHORT (if allowShort) or NO TRADE (flat). */
  function evaluate(symbol, daily, opts = {}) {
    const { funding = null, priceChange24hPct = null, livePrice = null, allowShort = false } = opts;
    if ((daily.c || []).length < CONFIG.SMA_PERIOD)
      return { symbol, decision: 'NO TRADE', price: livePrice, reasons: ['Not enough daily history for the 50-day SMA (new listing?)'], metrics: {} };
    const [st, s, dist] = trendState(daily.c);
    const a = atr(daily.h, daily.l, daily.c, CONFIG.ATR_PERIOD)[daily.c.length - 1];
    const price = livePrice || daily.c[daily.c.length - 1];
    let decision, reasons;
    const d = fmtSigned(dist) + '%';
    if (st > 0) { decision = 'LONG'; reasons = [`RULE: daily close ABOVE 50-day SMA (${d}) -> hold LONG until a daily close below it`]; }
    else if (allowShort) { decision = 'SHORT'; reasons = [`RULE: daily close BELOW 50-day SMA (${d}) -> SHORT until a daily close above it`]; }
    else { decision = 'NO TRADE'; reasons = [`RULE: daily close BELOW 50-day SMA (${d}) -> stay flat (cash) until a daily close above it`]; }
    const since = stateSince(daily.c, daily.t || daily.c.map((_, i) => i));
    const m = { daily_close: daily.c[daily.c.length - 1], daily_sma50: s, daily_dist_pct: dist, atr_1d: a,
      atr_1d_pct: a ? a / price * 100 : null, price, state_since_ms: since, funding, price_change_24h_pct: priceChange24hPct };
    // context lines (info only, never change the decision)
    if (a) reasons.push(`Context: daily ATR(14) = ${(a / price * 100).toFixed(1)}% of price -> stop ${CONFIG.DEFAULT_ATR_STOP_MULT}xATR = ${(3 * a / price * 100).toFixed(1)}% away`);
    if (funding !== null && funding !== undefined) reasons.push(`Context: funding ${fmtSigned(funding * 100, 4)}%/8h (${funding > 0 ? 'longs pay shorts' : funding < 0 ? 'shorts pay longs' : 'zero'})`);
    else reasons.push('Context: funding n/a (spot fallback source)');
    if (priceChange24hPct !== null) reasons.push(`Context: 24h change ${fmtSigned(priceChange24hPct)}%`);
    return { symbol, decision, price, reasons, metrics: m };
  }

  // ------------------------------------------------------------------ sizing (risk.py)
  function atrStop(entry, atrValue, side, mult = 2.0) {
    if (!(atrValue > 0)) throw new Error('ATR must be positive');
    if (side === 'LONG') return entry - mult * atrValue;
    if (side === 'SHORT') return entry + mult * atrValue;
    throw new Error('side must be LONG or SHORT');
  }
  function positionSize(equity, entry, stop, side, riskPct = 1.0, maxLeverage = 1.0, feeRate = 0.0005) {
    if (equity <= 0 || entry <= 0) throw new Error('equity and entry must be positive');
    const dist = side === 'LONG' ? entry - stop : stop - entry;
    if (dist <= 0) throw new Error('stop must be on the losing side of entry');
    const riskAmount = equity * riskPct / 100;
    const perUnit = dist + entry * feeRate * 2;
    let qty = riskAmount / perUnit, capped = false;
    const maxNotional = equity * maxLeverage;
    if (qty * entry > maxNotional) { qty = maxNotional / entry; capped = true; }
    const actual = qty * perUnit;
    return { side, entry, stop, qty, notional: qty * entry, risk_amount: actual, risk_pct_of_equity: actual / equity * 100,
      capped_by_leverage: capped, note: capped ? 'Notional capped by leverage limit; real risk below target' : '' };
  }

  // ------------------------------------------------------------------ paper engine (paper.py), JSON state
  class CapError extends Error {}
  const pyFixed = (x, d) => x.toFixed(d);
  const pyNum = x => Number.isInteger(x) ? x.toFixed(1) : String(x);   // Python str(float)
  function defaultState(startBalance = CONFIG.DEFAULT_START_BALANCE, now = Date.now()) {
    const p = PRESETS[CONFIG.DEFAULT_PRESET];
    return { schema_version: 1, next_id: 1,
      account: { start_balance: startBalance, balance: startBalance, risk_pct: p.risk_pct, fee_rate: CONFIG.DEFAULT_FEE_RATE,
        max_leverage: CONFIG.DEFAULT_MAX_LEVERAGE, atr_mult: CONFIG.DEFAULT_ATR_STOP_MULT, auto_trade: false,
        slippage: CONFIG.DEFAULT_SLIPPAGE, allow_short: CONFIG.DEFAULT_ALLOW_SHORT, max_positions: p.max_positions,
        max_total_risk_pct: p.max_total_risk_pct, max_corr_positions: p.max_corr_positions,
        corr_threshold: CONFIG.DEFAULT_CORR_THRESHOLD, created_at: now },
      positions: [], trades: [], equity: [[now, startBalance]], funding_events: {}, events: [], last_check_ms: now };
  }
  class PaperEngine {
    /** store: {load(): state|null, save(state)}; clock: () => ms */
    constructor(store = null, clock = () => Date.now()) {
      this.store = store; this.clock = clock;
      this.s = (store && store.load()) || defaultState(CONFIG.DEFAULT_START_BALANCE, clock());
      this._save();
    }
    _save() { if (this.store) this.store.save(this.s); }
    reset(startBalance = CONFIG.DEFAULT_START_BALANCE) {
      if (!(startBalance > 0)) throw new Error('start balance must be positive');
      const keep = this.s.account; // keep switches the user set (auto-trade off for safety)
      this.s = defaultState(startBalance, this.clock());
      this.s.account.allow_short = keep.allow_short;
      this._save();
    }
    account() { return { ...this.s.account }; }
    positions() { return this.s.positions.map(p => ({ ...p })); }
    trades(limit = 200) { return this.s.trades.slice().reverse().slice(0, limit); }
    updateSettings(kw) {
      const allowed = ['risk_pct', 'fee_rate', 'max_leverage', 'atr_mult', 'auto_trade', 'slippage', 'allow_short',
        'max_positions', 'max_total_risk_pct', 'max_corr_positions', 'corr_threshold'];
      for (const [k, v] of Object.entries(kw)) if (allowed.includes(k) && v !== null && v !== undefined) this.s.account[k] = v;
      this._save();
    }
    applyPreset(name) {
      const p = PRESETS[name]; if (!p) throw new Error('unknown preset');
      this.updateSettings({ risk_pct: p.risk_pct, max_positions: p.max_positions, max_total_risk_pct: p.max_total_risk_pct, max_corr_positions: p.max_corr_positions });
    }
    activePreset() {
      const a = this.s.account;
      return Object.keys(PRESETS).find(n => { const p = PRESETS[n];
        return p.risk_pct === a.risk_pct && p.max_positions === a.max_positions && p.max_total_risk_pct === a.max_total_risk_pct && p.max_corr_positions === a.max_corr_positions; }) || 'custom';
    }
    static positionRisk(side, qty, entry, stop, feeRate) {
      if (stop === null || stop === undefined) return qty * entry;
      const dist = side === 'LONG' ? entry - stop : stop - entry;
      return qty * Math.max(dist, 0) + qty * entry * feeRate * 2;
    }
    riskStatus(equity = null) {
      const a = this.s.account, eq = equity !== null ? equity : a.balance, pos = this.s.positions;
      const openRisk = pos.reduce((x, p) => x + (p.risk_amount !== null && p.risk_amount !== undefined ? p.risk_amount
        : PaperEngine.positionRisk(p.side, p.qty, p.entry, p.stop, a.fee_rate)), 0);
      const thr = a.corr_threshold;
      const corr = s => pos.filter(p => p.side === s && p.btc_corr !== null && p.btc_corr !== undefined && p.btc_corr >= thr).length;
      return { equity: eq, positions: pos.length, max_positions: a.max_positions, open_risk: openRisk,
        open_risk_pct: eq > 0 ? openRisk / eq * 100 : null, max_total_risk_pct: a.max_total_risk_pct, corr_threshold: thr,
        corr_long: corr('LONG'), corr_short: corr('SHORT'), max_corr_positions: a.max_corr_positions };
    }
    checkCaps(symbol, side, riskAmount, btcCorr, equity = null) {
      const rs = this.riskStatus(equity);
      if (rs.positions >= rs.max_positions) throw new CapError(`cap: max open positions reached (${rs.positions}/${rs.max_positions})`);
      if (rs.equity <= 0) throw new CapError('cap: equity is zero');
      const newPct = (rs.open_risk + riskAmount) / rs.equity * 100;
      if (newPct > rs.max_total_risk_pct + 1e-9) throw new CapError(`cap: total open risk would be ${pyFixed(newPct, 2)}% of equity (max ${pyNum(rs.max_total_risk_pct)}%)`);
      if (btcCorr !== null && btcCorr !== undefined && btcCorr >= rs.corr_threshold) {
        const n = side === 'LONG' ? rs.corr_long : rs.corr_short;
        if (n >= rs.max_corr_positions) throw new CapError(`cap: already ${n} ${side} positions with BTC correlation >= ${pyNum(rs.corr_threshold)} (${symbol} corr ${pyFixed(btcCorr, 2)}); max ${rs.max_corr_positions}`);
      }
    }
    openPosition(symbol, side, qty, price, stop = null, source = 'manual', reason = '', btcCorr = null, equity = null, enforceCaps = true) {
      side = String(side).toUpperCase();
      if (!['LONG', 'SHORT'].includes(side)) throw new Error('side must be LONG or SHORT');
      if (!(qty > 0) || !(price > 0)) throw new Error('qty and price must be positive');
      if (symbol === 'BTCUSDT') btcCorr = 1.0;
      if (this.s.positions.some(p => p.symbol === symbol)) throw new Error(`already have an open ${symbol} position`);
      const a = this.s.account;
      const fill = side === 'LONG' ? price * (1 + a.slippage) : price * (1 - a.slippage);
      if (stop !== null && ((side === 'LONG' && stop >= fill) || (side === 'SHORT' && stop <= fill))) throw new Error('stop must be on the losing side of the entry');
      const risk = PaperEngine.positionRisk(side, qty, fill, stop, a.fee_rate);
      if (enforceCaps) this.checkCaps(symbol, side, risk, btcCorr, equity);
      const fee = qty * fill * a.fee_rate;
      if (fee >= a.balance) throw new Error('insufficient paper balance');
      a.balance -= fee;
      const p = { id: this.s.next_id++, symbol, side, qty, entry: fill, stop, entry_fee: fee, opened_at: this.clock(), source, reason,
        risk_amount: risk, btc_corr: btcCorr, funding_paid: 0 };
      this.s.positions.push(p);
      this._log(`OPEN ${side} ${symbol} qty ${qty.toPrecision(6)} @ ${fill.toPrecision(6)} stop ${stop === null ? '-' : stop.toPrecision(6)} (${source})`);
      this._save();
      return { ...p };
    }
    closePosition(id, price, exitReason = 'manual', closedAt = null) {
      if (!(price > 0)) throw new Error('price must be positive');
      const i = this.s.positions.findIndex(p => p.id === id);
      if (i < 0) throw new Error('position not found');
      const p = this.s.positions[i], a = this.s.account, d = p.side === 'LONG' ? 1 : -1;
      price = d === 1 ? price * (1 - a.slippage) : price * (1 + a.slippage);
      const gross = (price - p.entry) * p.qty * d;
      const exitFee = p.qty * price * a.fee_rate;
      const fees = p.entry_fee + exitFee;
      const funding = p.funding_paid || 0;
      const net = gross - fees - funding;
      a.balance += gross - exitFee;
      this.s.positions.splice(i, 1);
      const t = { id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entry, exit: price, gross_pnl: gross, fees, net_pnl: net,
        opened_at: p.opened_at, closed_at: closedAt || this.clock(), source: p.source, exit_reason: exitReason, funding };
      this.s.trades.push(t);
      this._log(`CLOSE ${p.side} ${p.symbol} @ ${price.toPrecision(6)} net ${net.toFixed(2)} USDT (${exitReason})`);
      this._save();
      return { ...t };
    }
    /** events: [{fundingTime, fundingRate, markPrice}]; only events after open (and before upTo, if given), each once. */
    applyFunding(id, events, fallbackMark = null, upTo = null) {
      const charged = [];
      const p = this.s.positions.find(x => x.id === id);
      if (!p) return charged;
      const d = p.side === 'LONG' ? 1 : -1;
      for (const ev of events) {
        const ft = Number(ev.fundingTime);
        if (ft <= p.opened_at || (upTo !== null && ft > upTo)) continue;
        const key = `${id}:${ft}`;
        if (this.s.funding_events[key]) continue;
        const rate = Number(ev.fundingRate);
        const mk = ev.markPrice;
        const mark = (mk !== null && mk !== undefined && mk !== '' && mk !== '0') ? Number(mk) : (fallbackMark || p.entry);
        const amount = d * p.qty * mark * rate;
        this.s.funding_events[key] = { symbol: p.symbol, funding_time: ft, rate, mark, amount };
        p.funding_paid += amount;
        this.s.account.balance -= amount;
        charged.push({ position_id: id, symbol: p.symbol, funding_time: ft, rate, amount });
      }
      if (charged.length) this._save();
      return charged;
    }
    fundingTotal() { return Object.values(this.s.funding_events).reduce((x, e) => x + e.amount, 0); }
    checkStops(prices) {
      const closed = [];
      for (const p of this.positions()) {
        const px = prices[p.symbol];
        if (px === undefined || px === null || p.stop === null) continue;
        if ((p.side === 'LONG' && px <= p.stop) || (p.side === 'SHORT' && px >= p.stop)) closed.push(this.closePosition(p.id, px, 'stop'));
      }
      return closed;
    }
    /** Gap-aware catch-up: candles = parsed klines (o,h,l,t,close_time) covering the time the app was asleep.
        Finds the FIRST candle after `fromMs` whose range crossed the stop and closes there. Fill = stop price, or the
        candle open if the market had already gapped through the stop. Labelled as reconstructed. */
    reconstructStop(id, candles, fromMs, label) {
      const p = this.s.positions.find(x => x.id === id);
      const b = p ? findStopBreach(p, candles, fromMs) : null;
      if (!b) return null;
      return { ...b, trade: this.closePosition(id, b.fill, `stop (RECONSTRUCTED from ${label} candle ${fmtIST(b.candle_t)} IST)`, b.when) };
    }
    unrealized(prices) {
      return this.s.positions.reduce((u, p) => { const px = prices[p.symbol];
        return px ? u + (px - p.entry) * p.qty * (p.side === 'LONG' ? 1 : -1) : u; }, 0);
    }
    equityNow(prices) { return this.s.account.balance + this.unrealized(prices); }
    snapshot(prices, minGapMs = 60000) {
      const eq = this.equityNow(prices), now = this.clock(), last = this.s.equity[this.s.equity.length - 1];
      if (!last || now - last[0] >= minGapMs) { this.s.equity.push([now, eq]); if (this.s.equity.length > 5000) this.s.equity.splice(0, 1000); this._save(); }
      return eq;
    }
    summary(prices) {
      const a = this.account(), eqNow = this.equityNow(prices), trades = this.trades(100000);
      const wins = trades.filter(t => t.net_pnl > 0);
      const pos = this.positions().map(p => { const px = prices[p.symbol];
        return { ...p, mark: px ?? null, upnl: px ? (px - p.entry) * p.qty * (p.side === 'LONG' ? 1 : -1) : null }; });
      return { account: a, equity: eqNow, unrealized: eqNow - a.balance, return_pct: (eqNow / a.start_balance - 1) * 100,
        max_drawdown_pct: maxDrawdown(this.s.equity.map(e => e[1]).concat([eqNow])) * 100, trade_count: trades.length,
        win_rate_pct: trades.length ? wins.length / trades.length * 100 : null, realized_pnl: trades.reduce((x, t) => x + t.net_pnl, 0),
        positions: pos, trades: trades.slice(0, 100), risk: this.riskStatus(eqNow), funding_paid_total: this.fundingTotal() };
    }
    _log(msg) { this.s.events.push([this.clock(), msg]); if (this.s.events.length > 300) this.s.events.splice(0, 100); }
  }

  /** First candle (closing after fromMs) whose range crossed the stop. Fill = stop, or the candle open if it gapped through. */
  function findStopBreach(p, candles, fromMs) {
    if (!p || p.stop === null || p.stop === undefined) return null;
    for (let i = 0; i < candles.t.length; i++) {
      if (candles.close_time[i] < Math.max(fromMs, p.opened_at)) continue;
      const o = candles.o[i], h = candles.h[i], l = candles.l[i];
      let fill = null;
      if (p.side === 'LONG' && l <= p.stop) fill = o <= p.stop ? o : p.stop;
      if (p.side === 'SHORT' && h >= p.stop) fill = o >= p.stop ? o : p.stop;
      if (fill !== null) return { fill, when: Math.max(candles.t[i], p.opened_at), candle_t: candles.t[i] };
    }
    return null;
  }

  /** Build a risk-based plan exactly like backend/main.py build_plan. */
  function buildPlan(engine, side, price, atrValue, equity) {
    const a = engine.account();
    if (!price || !atrValue) throw new Error('price/ATR unavailable for sizing');
    const stop = atrStop(price, atrValue, side, a.atr_mult);
    return positionSize(equity, price, stop, side, a.risk_pct, a.max_leverage, a.fee_rate);
  }

  /** Universe filter: USDT-margined PERPETUAL contracts on crypto coins only (no TradFi/index/pre-market, no stablecoins). */
  function cryptoPerpSet(exchangeInfo) {
    return new Set((exchangeInfo.symbols || []).filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT'
      && s.status === 'TRADING' && (s.underlyingType === undefined || s.underlyingType === 'COIN')
      && !CONFIG.COMMODITY_TOKENS.includes(s.baseAsset)).map(s => s.symbol));
  }
  function topSymbols(tickers, n, perps, spotMode = false) {
    const rows = [];
    for (const t of tickers) {
      const s = t.symbol;
      if (!s.endsWith('USDT')) continue;
      const base = s.slice(0, -4);
      if (perps && !perps.has(s)) continue;
      if (CONFIG.STABLE_BASES.includes(base) || CONFIG.COMMODITY_TOKENS.includes(base)) continue;
      if (spotMode && (/(UP|DOWN|BULL|BEAR)$/.test(base) || Number(t.count || 1) === 0)) continue;
      const qv = Number(t.quoteVolume);
      if (!isFinite(qv)) continue;
      rows.push([qv, s, t]);
    }
    rows.sort((a, b) => b[0] - a[0]);
    return rows.slice(0, n).map(r => r[2]);
  }

  /** Same decisions as backend/main.py auto_trade: close flipped positions, then open new signals within caps. */
  function autoTrade(engine, results, prices) {
    const actions = [];
    const bySym = Object.fromEntries(results.map(r => [r.symbol, r]));
    for (const p of engine.positions()) {
      const r = bySym[p.symbol];
      if (r && r.decision !== p.side && prices[p.symbol]) actions.push({ type: 'close', trade: engine.closePosition(p.id, prices[p.symbol], `signal now ${r.decision}`) });
    }
    const open = new Set(engine.positions().map(p => p.symbol));
    for (const r of results) {
      if (!['LONG', 'SHORT'].includes(r.decision) || open.has(r.symbol)) continue;
      try {
        const px = prices[r.symbol] || r.price;
        const plan = buildPlan(engine, r.decision, px, r.metrics.atr_1d, engine.equityNow(prices));
        actions.push({ type: 'open', pos: engine.openPosition(r.symbol, r.decision, plan.qty, plan.entry, plan.stop, 'auto', r.reasons[0], r.metrics.btc_corr ?? null, engine.equityNow(prices)) });
      } catch (e) { actions.push({ type: 'skip', symbol: r.symbol, why: e.message }); }
    }
    return actions;
  }

  function fmtIST(ms, withDate = true) {
    if (ms === null || ms === undefined) return '-';
    const o = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
    if (withDate) { o.day = '2-digit'; o.month = 'short'; }
    return new Intl.DateTimeFormat('en-IN', o).format(new Date(ms));
  }

  const QT = { CONFIG, PRESETS, sma, trueRange, atr, maxDrawdown, parseKlines, correlation, alignedReturnCorr, trendState, stateSince,
    evaluate, findStopBreach, atrStop, positionSize, CapError, PaperEngine, defaultState, buildPlan, cryptoPerpSet, topSymbols, autoTrade, fmtIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = QT; else root.QT = QT;
})(typeof self !== 'undefined' ? self : this);
