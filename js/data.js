/* Public Binance market data straight from the browser. No API keys, read-only, no orders.
   Source order (first that answers wins, re-probed on every rescan while on a fallback):
     1. https://fapi.binance.com          official USD-M futures REST host
     2. https://www.binance.com/fapi      same futures API on the main domain (works where #1 is geo-blocked, HTTP 451)
     3. https://data-api.binance.vision   SPOT market data fallback: NOT futures prices, no funding, labelled as such
   Both futures hosts and the spot host send `Access-Control-Allow-Origin: *` (checked 2026-11-16), so a static page can call them. */
(function (root) {
  'use strict';
  const SOURCES = [
    { id: 'fapi', mode: 'futures', base: 'https://fapi.binance.com', label: 'Binance USD-M futures (fapi.binance.com)' },
    { id: 'www', mode: 'futures', base: 'https://www.binance.com', label: 'Binance USD-M futures via www.binance.com/fapi' },
    { id: 'spot', mode: 'spot', base: 'https://data-api.binance.vision', label: 'SPOT FALLBACK (data-api.binance.vision): spot prices, NOT futures; no funding' },
  ];
  const WS_URLS = [
    'wss://fstream.binance.com/market/stream?streams=!markPrice@arr@1s',
    'wss://fstream.binance.com/stream?streams=!markPrice@arr@1s',
    'wss://fstream.binance.com/ws/!markPrice@arr@1s',
  ];

  async function getJSON(url, timeoutMs = 10000) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('?')[0]}`);
      return await r.json();
    } catch (e) {
      // A CORS rejection or a geo-block without CORS headers both surface as a TypeError ("Failed to fetch")
      throw new Error(e.name === 'AbortError' ? `timeout ${url.split('?')[0]}` : (e.message || String(e)));
    } finally { clearTimeout(tm); }
  }

  class DataClient {
    constructor() { this.source = null; this.probeLog = []; this.perps = null; this.perpsAt = 0; }
    get mode() { return this.source ? this.source.mode : 'offline'; }
    get label() { return this.source ? this.source.label : 'OFFLINE: no Binance source reachable'; }
    async detect() {
      this.probeLog = [];
      for (const s of SOURCES) {
        const path = s.mode === 'futures' ? '/fapi/v1/time' : '/api/v3/time';
        try { const j = await getJSON(s.base + path, 7000); if (!j.serverTime) throw new Error('bad reply');
          this.probeLog.push(`${s.id}: OK`); this.source = s; return s; }
        catch (e) { this.probeLog.push(`${s.id}: ${e.message}`); }
      }
      this.source = null; return null;
    }
    _f(path) { return getJSON(this.source.base + '/fapi/v1' + path); }
    _s(path) { return getJSON(this.source.base + '/api/v3' + path); }
    async perpSet() {
      if (this.mode !== 'futures') return null;
      if (!this.perps || Date.now() - this.perpsAt > 3600e3) { this.perps = QT.cryptoPerpSet(await this._f('/exchangeInfo')); this.perpsAt = Date.now(); }
      return this.perps;
    }
    tickers() { return this.mode === 'futures' ? this._f('/ticker/24hr') : this._s('/ticker/24hr'); }
    klines(sym, interval, limit = 120, startTime = null) {
      const q = `?symbol=${sym}&interval=${interval}&limit=${limit}` + (startTime ? `&startTime=${startTime}` : '');
      return this.mode === 'futures' ? this._f('/klines' + q) : this._s('/klines' + q);
    }
    /** Mark-price candles (what the live stop check uses); spot fallback uses spot candles (labelled). */
    stopCandles(sym, interval, startTime, limit = 1500) {
      const q = `?symbol=${sym}&interval=${interval}&limit=${limit}&startTime=${startTime}`;
      return this.mode === 'futures' ? this._f('/markPriceKlines' + q) : this._s('/klines' + q.replace('limit=1500', 'limit=1000'));
    }
    premiumIndex() { return this.mode === 'futures' ? this._f('/premiumIndex') : Promise.resolve([]); }
    fundingHistory(sym, startTime) { return this.mode === 'futures' ? this._f(`/fundingRate?symbol=${sym}&startTime=${startTime}&limit=1000`) : Promise.resolve([]); }
  }

  /** All-market mark price websocket with reconnect + exponential backoff and URL rotation. */
  class MarkStream {
    constructor(onMarks, onStatus) { this.onMarks = onMarks; this.onStatus = onStatus || (() => {}); this.ws = null; this.i = 0;
      this.retry = 0; this.lastMsg = 0; this.want = false; this.marks = {}; this.timer = null; }
    start() { this.want = true; this._open(); if (!this.watch) this.watch = setInterval(() => this._watchdog(), 5000); }
    stop() { this.want = false; clearInterval(this.watch); this.watch = null; if (this.ws) try { this.ws.close(); } catch (e) {} }
    get alive() { return this.ws && this.ws.readyState === 1 && Date.now() - this.lastMsg < 15000; }
    _open() {
      if (!this.want) return;
      const url = WS_URLS[this.i % WS_URLS.length];
      this.onStatus(`connecting ${url.replace('wss://', '')}`);
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return this._again(); }
      this.ws = ws; const opened = Date.now();
      ws.onmessage = ev => {
        try {
          const j = JSON.parse(ev.data); const arr = Array.isArray(j) ? j : j.data;
          if (!Array.isArray(arr)) return;
          const out = {};
          for (const m of arr) if (m.s && m.p) { out[m.s] = +m.p; this.marks[m.s] = +m.p; }
          this.lastMsg = Date.now(); this.retry = 0; this.onStatus('live (1s mark prices)');
          this.onMarks(out);
        } catch (e) { /* ignore malformed frame */ }
      };
      ws.onclose = () => { if (this.ws !== ws) return; if (Date.now() - opened < 20000 && !this.lastMsg) this.i++; this._again(); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }
    _again() { if (!this.want) return; const d = Math.min(30000, 1000 * 2 ** this.retry++); this.onStatus(`reconnecting in ${Math.round(d / 1000)}s`);
      clearTimeout(this.timer); this.timer = setTimeout(() => this._open(), d); }
    _watchdog() { if (this.want && this.ws && this.ws.readyState === 1 && Date.now() - this.lastMsg > 20000) { this.onStatus('stale, reconnecting'); this.ws.close(); } }
    reconnectNow() { this.retry = 0; if (this.ws) { try { this.ws.close(); } catch (e) {} } else this._open(); }
  }
  root.QTData = { SOURCES, WS_URLS, DataClient, MarkStream, getJSON };
})(self);
