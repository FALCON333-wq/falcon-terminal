/* Falcon Quant Terminal (mobile PWA) - UI + scheduling. PAPER ONLY. */
(function () {
  'use strict';
  const { DataClient, MarkStream } = QTData;
  const $ = id => document.getElementById(id);
  const VERSION = 'm1.0.0';
  const LS_STATE = 'qt_mobile_paper_v1', LS_PREFS = 'qt_mobile_prefs_v1';
  const SCAN_EVERY_MS = 5 * 60e3, POLL_EVERY_MS = 10e3, FUNDING_EVERY_MS = 60e3;

  // ------------------------------------------------------------ persistence (localStorage, JSON)
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(LS_STATE)); } catch (e) { return null; } },
    save(s) { try { localStorage.setItem(LS_STATE, JSON.stringify(s)); } catch (e) { banner('Could not save paper account (storage full?)', true); } },
  };
  const prefs = Object.assign({ notify: false, wake: false, phrase: 'Open Falcon terminal' }, JSON.parse(localStorage.getItem(LS_PREFS) || '{}'));
  const savePrefs = () => localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const engine = new QT.PaperEngine(store);
  const client = new DataClient();
  const S = { results: [], tick: {}, prices: {}, spark: {}, lastScan: null, scanning: false, lastError: null, prevDecision: {}, wakeLock: null };

  // ------------------------------------------------------------ helpers
  const fmt = (x, d = 2) => (x === null || x === undefined || !isFinite(x)) ? '-' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fpx = x => { if (!x) return '-'; const d = x >= 1000 ? 1 : x >= 1 ? 3 : x >= 0.01 ? 5 : 8; return fmt(x, d); };
  const sgn = (x, d = 2) => x === null || x === undefined ? '-' : (x >= 0 ? '+' : '') + fmt(x, d);
  const cls = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ist = (ms, d = true) => QT.fmtIST(ms, d);
  function banner(msg, err = false) { const b = $('banner'); if (!msg) { b.classList.add('hidden'); return; } b.textContent = msg; b.className = 'banner' + (err ? ' err' : ''); }
  const log = msg => { engine._log(msg); engine._save(); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function prices() { return Object.assign({}, S.prices, stream.marks); }

  // ------------------------------------------------------------ websocket marks -> stop checks
  const stream = new MarkStream(onMarks, st => { $('wsLabel').textContent = 'price stream: ' + st; });
  function onMarks(m) {
    const open = engine.positions();
    if (!open.length) return;
    if (open.some(p => m[p.symbol] !== undefined)) processPrices(prices(), 'ws');
  }
  function processPrices(px, via) {
    const open = engine.positions();
    const closed = engine.checkStops(px);
    closed.forEach(t => notify(`Paper stop hit: ${t.symbol}`, `${t.side} closed @ ${fpx(t.exit)} (${via}) net ${fmt(t.net_pnl)} USDT`));
    if (open.every(p => px[p.symbol] !== undefined)) { engine.s.last_check_ms = Date.now(); }
    engine.snapshot(px);
    if (closed.length) renderAll(); else if (S.activeTab === 'positions' || S.activeTab === 'account') throttledRender();
  }
  let rt = 0; function throttledRender() { if (Date.now() - rt > 2000) { rt = Date.now(); renderPositions(); renderAccount(); } }

  // ------------------------------------------------------------ polling fallback when the stream is down
  async function pollPrices() {
    if (document.hidden || client.mode === 'offline' || stream.alive) return;
    const open = engine.positions(); if (!open.length) return;
    try {
      if (client.mode === 'futures') { for (const p of await client.premiumIndex()) S.prices[p.symbol] = +p.markPrice; }
      else { for (const p of open) { const t = await QTData.getJSON(`${client.source.base}/api/v3/ticker/price?symbol=${p.symbol}`); S.prices[p.symbol] = +t.price; } }
      processPrices(prices(), 'poll');
    } catch (e) { S.lastError = e.message; }
  }

  // ------------------------------------------------------------ funding (real history)
  async function chargeFunding(upToById = {}) {
    if (client.mode !== 'futures') return;
    for (const p of engine.positions()) {
      try {
        const ev = await client.fundingHistory(p.symbol, p.opened_at + 1);
        const ch = engine.applyFunding(p.id, ev, prices()[p.symbol] || p.entry, upToById[p.id] ?? null);
        ch.forEach(c => log(`FUNDING ${c.symbol} rate ${(c.rate * 100).toFixed(4)}% -> ${c.amount >= 0 ? 'paid' : 'received'} ${Math.abs(c.amount).toFixed(4)} USDT (funding time ${ist(c.funding_time)} IST)`));
      } catch (e) { S.lastError = 'funding: ' + e.message; }
    }
  }

  // ------------------------------------------------------------ gap-aware catch-up after sleep
  async function catchUp(why) {
    const open = engine.positions();
    const from = engine.s.last_check_ms || Date.now();
    const gap = Date.now() - from;
    if (!open.length || gap < 60e3 || client.mode === 'offline') { engine.s.last_check_ms = Date.now(); engine._save(); return; }
    const interval = gap <= 24 * 3600e3 ? '1m' : gap <= 14 * 86400e3 ? '15m' : '1h';
    const label = (client.mode === 'futures' ? interval + ' mark-price' : interval + ' SPOT');
    let anyHit = false;
    for (const p of open) {
      try {
        let start = Math.max(from, p.opened_at) - 60e3, rows = [];
        for (let page = 0; page < 20 && start < Date.now(); page++) {
          const raw = await client.stopCandles(p.symbol, interval, start);
          if (!raw.length) break;
          rows = rows.concat(raw); start = Number(raw[raw.length - 1][6]) + 1;
          if (raw.length < 900) break;
        }
        const candles = QT.parseKlines(rows, false);
        const b = QT.findStopBreach(p, candles, from);
        if (b) {
          await chargeFunding({ [p.id]: b.when });
          const r = engine.reconstructStop(p.id, candles, from, label);
          if (r) { anyHit = true; notify(`Paper stop (reconstructed): ${p.symbol}`, `closed @ ${fpx(r.trade.exit)} at ${ist(r.when)} IST while the app was asleep`); }
        }
      } catch (e) { log(`catch-up ${p.symbol} failed: ${e.message} (will retry next resume)`); return; }
    }
    log(`Catch-up after ${Math.round(gap / 60000)} min away (${why}): checked ${open.length} position(s) with ${label} candles; ${anyHit ? 'stop(s) RECONSTRUCTED' : 'no stop crossed'}`);
    engine.s.last_check_ms = Date.now(); engine._save();
  }

  // ------------------------------------------------------------ scanner
  async function mapLimit(items, n, fn) { const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); await sleep(60); } })); return out; }

  async function scan(why = 'timer') {
    if (S.scanning) return; S.scanning = true; $('btnScan').disabled = true; $('scanLabel').textContent = 'scanning…';
    try {
      if (client.mode !== 'futures') { await client.detect(); renderSource(); if (client.mode === 'futures') stream.start(); }
      if (client.mode === 'offline') throw new Error('No Binance source reachable (no internet, or blocked network)');
      const [tickers, perps] = await Promise.all([client.tickers(), client.perpSet()]);
      const top = QT.topSymbols(tickers, QT.CONFIG.SCAN_TOP_N, perps, client.mode === 'spot');
      const funding = {};
      if (client.mode === 'futures') for (const p of await client.premiumIndex()) { funding[p.symbol] = +p.lastFundingRate; S.prices[p.symbol] = +p.markPrice; }
      for (const t of tickers) if (!S.prices[t.symbol] || client.mode === 'spot') S.prices[t.symbol] = +t.lastPrice;
      const btc = QT.parseKlines(await client.klines('BTCUSDT', '1d', 120));
      const allowShort = engine.account().allow_short;
      const res = await mapLimit(top, 4, async t => {
        try {
          const d = t.symbol === 'BTCUSDT' ? btc : QT.parseKlines(await client.klines(t.symbol, '1d', 120));
          const r = QT.evaluate(t.symbol, d, { funding: funding[t.symbol] ?? null, priceChange24hPct: +t.priceChangePercent, livePrice: prices()[t.symbol] || +t.lastPrice, allowShort });
          r.metrics.btc_corr = t.symbol === 'BTCUSDT' ? 1.0 : QT.alignedReturnCorr(d.t, d.c, btc.t, btc.c, QT.CONFIG.CORR_LOOKBACK_DAYS);
          r.quote_volume_24h = +t.quoteVolume; r.closed_daily_ms = d.close_time[d.close_time.length - 1];
          S.spark[t.symbol] = { c: d.c.slice(-90), s: QT.sma(d.c, 50).slice(-90) };
          return r;
        } catch (e) { return { symbol: t.symbol, decision: 'NO TRADE', price: null, reasons: ['DATA ERROR: ' + e.message], metrics: {}, quote_volume_24h: +t.quoteVolume, error: true }; }
      });
      const order = { LONG: 0, SHORT: 0, 'NO TRADE': 1 };
      res.sort((a, b) => (order[a.decision] - order[b.decision]) || (b.quote_volume_24h - a.quote_volume_24h));
      // signal flips vs previous scan -> local notification (only while open)
      const flips = res.filter(r => !r.error && S.prevDecision[r.symbol] && S.prevDecision[r.symbol] !== r.decision);
      flips.forEach(r => { log(`SIGNAL FLIP ${r.symbol}: ${S.prevDecision[r.symbol]} -> ${r.decision}`); notify(`Signal flip: ${r.symbol}`, `${S.prevDecision[r.symbol]} → ${r.decision}. ${r.reasons[0]}`); });
      res.forEach(r => { if (!r.error) S.prevDecision[r.symbol] = r.decision; });
      localStorage.setItem('qt_prev_dec', JSON.stringify(S.prevDecision));
      S.results = res; S.lastScan = Date.now(); S.lastError = null;
      if (engine.account().auto_trade) {
        if (client.mode !== 'futures') log('Auto-trade skipped: spot fallback data (not futures prices)');
        else for (const a of QT.autoTrade(engine, res, prices())) {
          if (a.type === 'skip') log(`auto skip ${a.symbol}: ${a.why}`);
          else if (a.type === 'open') notify(`Auto paper OPEN ${a.pos.symbol}`, `${a.pos.side} @ ${fpx(a.pos.entry)}`);
        }
      }
      await chargeFunding();
      engine.snapshot(prices());
      banner(client.mode === 'spot' ? 'Futures API unreachable: showing SPOT prices from data-api.binance.vision. No funding, no auto-trade.' : null);
    } catch (e) { S.lastError = e.message; banner('Scan failed: ' + e.message, true); }
    finally { S.scanning = false; $('btnScan').disabled = false; renderAll(); }
  }

  // ------------------------------------------------------------ notifications / wake lock
  async function notify(title, body) {
    if (!prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: title });
      else new Notification(title, { body }); } catch (e) { /* ignore */ }
  }
  async function setWake(on) {
    prefs.wake = on; savePrefs();
    if (!('wakeLock' in navigator)) { $('wakeNote').textContent = 'Screen Wake Lock is not supported in this browser.'; $('optWake').checked = false; return; }
    try {
      if (on && !S.wakeLock && !document.hidden) { S.wakeLock = await navigator.wakeLock.request('screen'); S.wakeLock.addEventListener('release', () => { S.wakeLock = null; renderWake(); }); }
      if (!on && S.wakeLock) { await S.wakeLock.release(); S.wakeLock = null; }
    } catch (e) { $('wakeNote').textContent = 'Wake lock refused: ' + e.message; }
    renderWake();
  }
  function renderWake() { if ('wakeLock' in navigator) $('wakeNote').textContent = S.wakeLock ? 'Screen is being kept awake (battery use is higher).' : (prefs.wake ? 'Will re-apply when the app is visible.' : 'Off.'); }

  // ------------------------------------------------------------ manual paper trades
  function sheet(html) { $('sheetBody').innerHTML = html; $('sheet').classList.remove('hidden'); }
  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.dataset.close) $('sheet').classList.add('hidden'); });
  function openTicket(sym, side) {
    const r = S.results.find(x => x.symbol === sym); if (!r) return;
    const px = prices()[sym] || r.price, eq = engine.equityNow(prices());
    let plan; try { plan = QT.buildPlan(engine, side, px, r.metrics.atr_1d, eq); } catch (e) { return alert(e.message); }
    const against = side !== r.decision;
    sheet(`<h3>Paper ${side} ${sym}</h3>
      ${against ? `<p class="banner err">This is AGAINST the current rule (${r.decision}).</p>` : ''}
      ${client.mode !== 'futures' ? '<p class="banner err">Spot fallback prices, not futures.</p>' : ''}
      <div class="kv"><div>Price<b>${fpx(px)}</b></div><div>Stop (3×ATR)<b>${fpx(plan.stop)}</b></div><div>Qty<b>${plan.qty.toPrecision(5)}</b></div>
      <div>Notional<b>${fmt(plan.notional)}</b></div><div>Risk<b>${fmt(plan.risk_amount)} (${fmt(plan.risk_pct_of_equity)}%)</b></div><div>BTC corr<b>${fmt(r.metrics.btc_corr)}</b></div></div>
      <p class="muted">Simulated fill = price ${side === 'LONG' ? '+' : '−'} 0.05% slippage, fee 0.05%. ${plan.note}</p>
      <div class="row"><button class="btn ${side === 'LONG' ? 'long' : 'short'}" id="confirmOpen">Open paper ${side}</button><button class="btn" data-close="1">Cancel</button></div>`);
    $('confirmOpen').onclick = () => {
      try { engine.openPosition(sym, side, plan.qty, px, plan.stop, 'manual', r.reasons[0], r.metrics.btc_corr ?? null, eq); $('sheet').classList.add('hidden'); renderAll(); }
      catch (e) { alert(e.message); }
    };
  }
  function closePos(id) {
    const p = engine.positions().find(x => x.id === id); if (!p) return;
    const px = prices()[p.symbol]; if (!px) return alert('No live price for ' + p.symbol + ' yet');
    if (confirm(`Close paper ${p.side} ${p.symbol} at ~${fpx(px)}?`)) { engine.closePosition(id, px, 'manual'); renderAll(); }
  }

  // ------------------------------------------------------------ rendering
  function drawSpark(cv, sp, dec) {
    if (!cv || !sp) return; const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = cv.clientHeight || 56;
    cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const vals = sp.c.concat(sp.s.filter(x => x !== null)); const lo = Math.min(...vals), hi = Math.max(...vals), n = sp.c.length;
    const X = i => i / (n - 1) * (w - 4) + 2, Y = v => h - 3 - (v - lo) / ((hi - lo) || 1) * (h - 6);
    g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeStyle = '#8b98a5'; g.beginPath(); let st = false;
    sp.s.forEach((v, i) => { if (v === null) return; st ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); st = true; }); g.stroke();
    g.setLineDash([]); g.lineWidth = 2; g.strokeStyle = dec === 'LONG' ? '#1fbf75' : dec === 'SHORT' ? '#f05252' : '#aab4be'; g.beginPath();
    sp.c.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  }
  function renderScanner() {
    const res = S.results, n = k => res.filter(r => r.decision === k).length;
    $('scanSummary').textContent = res.length ? `${n('LONG')} LONG · ${n('SHORT')} SHORT · ${n('NO TRADE')} NO TRADE (of ${res.length})` : (S.lastError ? 'No data: ' + S.lastError : 'Scanning top 20 USDT perps…');
    const openSyms = new Set(engine.positions().map(p => p.symbol));
    $('scanList').innerHTML = res.map(r => {
      const m = r.metrics || {}, dc = r.decision === 'NO TRADE' ? 'NO' : r.decision, px = prices()[r.symbol] || r.price;
      return `<div class="card"><div class="head"><div><span class="sym">${esc(r.symbol.replace('USDT', ''))}</span> <span class="px">${fpx(px)}</span></div><span class="dec ${dc}">${r.decision}</span></div>
        <canvas class="spark" data-sym="${r.symbol}" data-dec="${r.decision}"></canvas>
        <div class="kv"><div>vs SMA50<b class="${cls(m.daily_dist_pct)}">${sgn(m.daily_dist_pct, 1)}%</b></div><div>ATR(1d)<b>${fmt(m.atr_1d_pct, 1)}%</b></div><div>BTC corr<b>${fmt(m.btc_corr)}</b></div>
        <div>Funding/8h<b>${m.funding === null || m.funding === undefined ? 'n/a' : sgn(m.funding * 100, 4) + '%'}</b></div><div>24h<b class="${cls(m.price_change_24h_pct)}">${sgn(m.price_change_24h_pct, 1)}%</b></div><div>State since<b>${m.state_since_ms ? ist(m.state_since_ms).split(',')[0] : '-'}</b></div></div>
        <details><summary>Why? (reasons)</summary><ul class="reasons">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}
          <li>Last closed daily candle: ${ist(r.closed_daily_ms)} IST</li></ul></details>
        <div class="row">${openSyms.has(r.symbol) ? '<span class="muted">Paper position open</span>' :
          `<button class="btn ${r.decision === 'LONG' ? 'long' : ''}" data-open="${r.symbol}" data-side="LONG" ${r.error ? 'disabled' : ''}>Paper LONG</button>
           ${engine.account().allow_short ? `<button class="btn ${r.decision === 'SHORT' ? 'short' : ''}" data-open="${r.symbol}" data-side="SHORT" ${r.error ? 'disabled' : ''}>Paper SHORT</button>` : ''}`}</div></div>`;
    }).join('');
    document.querySelectorAll('canvas.spark').forEach(cv => drawSpark(cv, S.spark[cv.dataset.sym], cv.dataset.dec));
  }
  function renderPositions() {
    const s = engine.summary(prices());
    $('posBadge').textContent = s.positions.length; $('posBadge').classList.toggle('hidden', !s.positions.length);
    $('posList').innerHTML = s.positions.length ? s.positions.map(p => `<div class="card"><div class="head"><div><span class="sym">${esc(p.symbol)}</span> <span class="tag">${p.source}</span></div><span class="dec ${p.side}">${p.side}</span></div>
      <div class="kv"><div>Entry<b>${fpx(p.entry)}</b></div><div>Mark<b>${fpx(p.mark)}</b></div><div>Stop<b>${fpx(p.stop)}</b></div>
      <div>Qty<b>${p.qty.toPrecision(5)}</b></div><div>uPnL<b class="${cls(p.upnl)}">${sgn(p.upnl)}</b></div><div>Funding paid<b>${fmt(p.funding_paid, 4)}</b></div></div>
      <p class="muted">Opened ${ist(p.opened_at)} IST · risk ${fmt(p.risk_amount)} USDT</p>
      <button class="btn" data-close-pos="${p.id}">Close at market (paper)</button></div>`).join('') : '<p class="muted">No open paper positions.</p>';
    $('tradeList').innerHTML = s.trades.length ? s.trades.slice(0, 50).map(t => `<div class="card"><div class="head"><span class="sym">${esc(t.symbol)} <span class="dec ${t.side}">${t.side}</span></span><b class="${cls(t.net_pnl)}">${sgn(t.net_pnl)} USDT</b></div>
      <p class="muted">${fpx(t.entry)} → ${fpx(t.exit)} · fees ${fmt(t.fees, 3)} · funding ${fmt(t.funding, 4)}<br>${ist(t.opened_at)} → ${ist(t.closed_at)} IST · <span class="tag ${/RECONSTRUCTED/.test(t.exit_reason) ? 'recon' : ''}">${esc(t.exit_reason)}</span></p></div>`).join('') : '<p class="muted">No closed trades yet.</p>';
  }
  function renderAccount() {
    const s = engine.summary(prices()), a = s.account, rk = s.risk;
    $('acctCards').innerHTML = [['Equity', fmt(s.equity) + ' USDT'], ['Return', `<span class="${cls(s.return_pct)}">${sgn(s.return_pct)}%</span>`], ['Balance', fmt(a.balance)], ['Unrealized', `<span class="${cls(s.unrealized)}">${sgn(s.unrealized)}</span>`],
      ['Max drawdown', fmt(s.max_drawdown_pct) + '%'], ['Trades / win', `${s.trade_count} / ${s.win_rate_pct === null ? '-' : fmt(s.win_rate_pct, 0) + '%'}`], ['Realized', sgn(s.realized_pnl)], ['Funding paid', fmt(s.funding_paid_total, 4)]]
      .map(([k, v]) => `<div class="card"><span class="muted">${k}</span><b>${v}</b></div>`).join('');
    $('riskBox').innerHTML = `<div class="kv"><div>Positions<b>${rk.positions}/${rk.max_positions}</b></div><div>Open risk<b>${fmt(rk.open_risk_pct)}% / ${rk.max_total_risk_pct}%</b></div>
      <div>BTC-corr L/S<b>${rk.corr_long}/${rk.corr_short} (max ${rk.max_corr_positions})</b></div></div><p class="muted">Preset: ${engine.activePreset()} · risk ${a.risk_pct}%/trade · auto-trade ${a.auto_trade ? 'ON' : 'off'} · started ${ist(a.created_at)} IST with ${fmt(a.start_balance)} USDT</p>`;
    $('eventLog').textContent = engine.s.events.slice().reverse().slice(0, 150).map(([t, m]) => `${ist(t)}  ${m}`).join('\n') || 'Nothing yet.';
    const cv = $('eqChart'), eq = engine.s.equity.map(e => e[1]).concat([s.equity]);
    if (S.activeTab === 'account' && eq.length > 1) drawSpark(cv, { c: eq, s: eq.map(() => null) }, eq[eq.length - 1] >= eq[0] ? 'LONG' : 'SHORT');
  }
  function renderSource() {
    const dot = $('srcDot'); dot.className = 'dot ' + (client.mode === 'futures' ? 'ok' : client.mode === 'spot' ? 'warn' : 'bad');
    $('srcLabel').textContent = client.label;
    $('srcInfo').innerHTML = `Active: <b>${esc(client.label)}</b><br>Probe (fapi → www → spot): ${esc(client.probeLog.join(' · ') || '-')}<br>Live prices: ${client.mode === 'futures' ? 'fstream.binance.com mark-price websocket, 10 s polling fallback' : 'polling only'}`;
  }
  function renderSettings() {
    const a = engine.account(), ap = engine.activePreset();
    $('presetSel').value = ap; $('presetNote').textContent = ap === 'custom' ? 'Custom values' : QT.PRESETS[ap].note;
    $('optShort').checked = !!a.allow_short; $('optAuto').checked = !!a.auto_trade; $('optNotify').checked = !!prefs.notify && ('Notification' in window) && Notification.permission === 'granted';
    $('optWake').checked = !!prefs.wake; $('voicePhrase').value = prefs.phrase;
    ['vp1', 'vp2', 'vp3', 'vp4'].forEach(id => $(id).textContent = prefs.phrase);
    $('pwaUrl').textContent = location.origin + location.pathname;
    $('buildInfo').textContent = `Version ${VERSION} · data stored only on this phone (localStorage)`;
    renderWake();
  }
  function renderAll() {
    renderSource(); renderScanner(); renderPositions(); renderAccount(); renderSettings();
    $('scanLabel').textContent = S.lastScan ? `last scan ${ist(S.lastScan, false)} IST` : (S.lastError ? 'scan failed' : 'no scan yet');
  }

  // ------------------------------------------------------------ events
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; showTab(b.dataset.tab); });
  function showTab(t) { S.activeTab = t; document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + t)); renderAll(); window.scrollTo(0, 0); }
  document.body.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) openTicket(o.dataset.open, o.dataset.side);
    const c = e.target.closest('[data-close-pos]'); if (c) closePos(+c.dataset.closePos); });
  $('btnScan').onclick = () => scan('manual');
  $('presetSel').onchange = e => { engine.applyPreset(e.target.value); log(`Preset -> ${e.target.value}`); renderAll(); };
  $('optShort').onchange = e => { engine.updateSettings({ allow_short: e.target.checked }); log('Allow short ' + (e.target.checked ? 'ON' : 'off')); scan('setting'); };
  $('optAuto').onchange = e => { if (e.target.checked && !confirm('Turn ON auto paper-trading? It opens/closes SIMULATED positions on each scan while the app is open. No real money.')) { e.target.checked = false; return; }
    engine.updateSettings({ auto_trade: e.target.checked }); log('Auto paper-trade ' + (e.target.checked ? 'ON' : 'off')); renderAll(); };
  $('optNotify').onchange = async e => { if (e.target.checked) { if (!('Notification' in window)) { alert('Notifications not supported here (iPhone: only after "Add to Home Screen", iOS 16.4+).'); e.target.checked = false; return; }
      const p = await Notification.requestPermission(); e.target.checked = p === 'granted'; } prefs.notify = e.target.checked; savePrefs(); };
  $('optWake').onchange = e => setWake(e.target.checked);
  $('voicePhrase').onchange = e => { prefs.phrase = e.target.value.trim() || 'Open Falcon terminal'; savePrefs(); renderSettings(); };
  $('btnReset').onclick = () => { const b = +$('startBal').value; if (!(b > 0)) return alert('Enter a positive balance');
    if (confirm(`Reset the PAPER account to ${b} USDT? All paper positions and history are deleted.`)) { engine.reset(b); log(`Reset paper account to ${b} USDT (preset aggressive)`); renderAll(); } };
  $('btnExport').onclick = () => { const blob = new Blob([JSON.stringify(engine.s, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `paper-account-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('btnReprobe').onclick = async () => { await client.detect(); renderSource(); stream.reconnectNow(); scan('reprobe'); };

  // resume after sleep / app switch: catch up stops first, then rescan
  let resuming = false;
  async function onResume(why) {
    if (resuming || document.hidden) return; resuming = true;
    try { if (client.mode === 'offline') await client.detect(); if (client.mode === 'futures') { stream.start(); if (!stream.alive) stream.reconnectNow(); }
      await catchUp(why); if (prefs.wake) setWake(true); await scan('resume'); } finally { resuming = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onResume('visible'); else { engine._save(); } });
  window.addEventListener('pageshow', e => { if (e.persisted) onResume('pageshow'); });
  window.addEventListener('online', () => onResume('online'));
  window.addEventListener('focus', () => { if (S.lastScan && Date.now() - S.lastScan > 60e3) onResume('focus'); });

  // ------------------------------------------------------------ boot
  async function boot() {
    try { S.prevDecision = JSON.parse(localStorage.getItem('qt_prev_dec') || '{}'); } catch (e) {}
    showTab('scanner');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'))
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
    await client.detect(); renderSource();
    if (client.mode === 'futures') stream.start();
    await catchUp('app start');
    await scan('start');
    if (prefs.wake) setWake(true);
    setInterval(() => { if (!document.hidden) scan('timer'); }, SCAN_EVERY_MS);
    setInterval(pollPrices, POLL_EVERY_MS);
    setInterval(() => { if (!document.hidden) chargeFunding(); }, FUNDING_EVERY_MS);
  }
  window.__qt = { engine, client, stream, S, scan, catchUp };   // for debugging / headless tests
  boot();
})();
