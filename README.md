# Quant Terminal – Mobile PWA (PAPER TRADING ONLY)

A phone version of the Quant Terminal that runs **entirely in the phone's browser**: plain HTML/JS/CSS, no server, no API keys, no real orders. It talks only to Binance's **public** market-data endpoints, and the paper account is stored on the phone (localStorage).

## What it does (same rules as the Python backend)
- **Universe:** top 20 USDT-margined **crypto perpetuals** by 24h quote volume. Skipped:
  - stablecoins (USDC, FDUSD, …);
  - TradFi perps (stocks, gold, oil: `TRADIFI_PERPETUAL`), index (BTCDOM) and pre-market contracts;
  - gold-backed tokens (XAUT, PAXG).
- **Signal:** last *closed* daily candle vs **SMA50**: LONG, otherwise flat (NO TRADE). Optional SHORT toggle.
- **Sizing:** stop **3 × ATR(14, daily)**; size so that hitting the stop loses the preset's risk, fees included; max 1× leverage.
- **Default preset = aggressive:** 1.5 %/trade, max 5 positions, max 7.5 % total open risk, max 3 same-side positions with BTC correlation ≥ 0.7 (60 days). Conservative and balanced are in Settings.
- **Costs:** fees 0.05 % + slippage 0.05 % per side. **Real funding** is charged from Binance `fundingRate` history, each event once.
- **Trading:** manual paper open/close. **Auto paper-trade toggle (off by default)**: on each scan, closes positions whose signal flipped, then opens new signals within the caps.
- **Live prices:** `fstream.binance.com` mark-price websocket (1 s) checks stops. It reconnects with backoff and rotates between 3 URLs; 10 s REST polling takes over if it drops.
- **Resume catch-up:** when you come back to the app (visibilitychange / pageshow / online), it first replays the time you were away. It downloads **1m mark-price candles** (15m for gaps over 1 day, 1h for over 14 days) and closes any position whose stop was crossed.
  - The fill is the stop price, or the candle open if price jumped past the stop.
  - Funding is charged only up to that exit.
  - Such exits are labelled **"stop (RECONSTRUCTED from … candle HH:MM IST)"**.
  - Then it rescans.
- **Screens:** Scanner (sparklines with SMA50, reasons), Positions (open + closed trades), Account (equity, drawdown, risk usage, IST activity log), Settings. Dark theme, ≥44 px touch targets, all times IST.

## Data sources and CORS (checked 16 Nov 2026 from our server, with `curl -H "Origin: https://example.github.io"` and from headless Chrome)
| Source | Result from our server | `Access-Control-Allow-Origin` |
|---|---|---|
| `https://fapi.binance.com/fapi/v1/*` | **HTTP 451** (geo-blocked where our server is); Chrome reports it as a CORS failure because the 451 reply has no CORS header | none on the 451 reply. **Could not check it from India**; if it answers there, it is used first |
| `https://www.binance.com/fapi/v1/*` (time, exchangeInfo, ticker/24hr, klines, premiumIndex, fundingRate, markPriceKlines) | 200 | `*` (OPTIONS preflight 204, also `*`) |
| `https://data-api.binance.vision/api/v3/*` (spot fallback) | 200 | `*` |
| `wss://fstream.binance.com/market/stream?streams=!markPrice@arr@1s` | connects; one array of ~980 mark prices every second | n/a (websockets are not subject to CORS) |

Fallback order: **fapi → www.binance.com/fapi → spot**. Whichever source is in use is shown at the top of the app.
- **Spot fallback** puts a yellow banner on screen: spot prices, NOT futures; no funding; auto-trade is disabled.
- The app re-checks for the futures source on every scan.

## Run it locally (verified)
```
cd mobile
python3 -m http.server 8765        # then open http://127.0.0.1:8765/
```
`localhost` counts as a secure context, so the service worker works there. Verified in headless Chrome at 390×844: 20 symbols scanned, websocket live, service worker controlling the page.

## Hosting so the phone can open it (needs TONNY's approval: nothing published)
Install-to-home-screen and the service worker need **HTTPS**. Any free static host works because the folder is only static files:
1. **Netlify Drop**: go to app.netlify.com/drop, sign in, drag the `mobile` folder → you get `https://<random>.netlify.app`. Needs a free Netlify account.
2. **GitHub Pages**: create a public repo, upload the *contents* of `mobile/`, then Settings → Pages → Deploy from branch `main` / root → `https://<user>.github.io/<repo>/`. Needs a GitHub account; the repo would be **public**. Only paper code is in it, no keys.
3. **Cloudflare Pages**: similar to (2), with a free account.

Each option creates an account or public URL in TONNY's name, so none was done without his OK.

## Install on the phone
- **Android (Chrome):** open the HTTPS URL → ⋮ menu → **Add to Home screen** / **Install app** → open it from the icon (full screen).
- **iPhone (Safari, iOS 16.4+ for notifications):** open the URL in **Safari** → **Share** → **Add to Home Screen** → open from the icon. Notifications only work from the Home-Screen app, after you turn on the switch in Settings.
- Your paper account lives in that browser/app's storage. Clearing site data deletes it, so use **Export JSON** for a backup.

## Honest limitations
- **No background running.** When the screen is off or you are in another app, Android and iOS suspend web apps: no scans, no live stop checks, no notifications. The catch-up applies stops **afterwards**, using real candles.
  - It does **not** replay daily-signal flips or auto-trade entries that would have happened while asleep. Those are acted on at the current price when you reopen.
- **Wake Lock** (Settings) keeps the screen on while the app is open (Chrome Android; Safari iOS 16.4+). It uses battery.
- Notifications fire only while the app is open (no push server, by design).
- Catch-up candles: for gaps up to 24 h it uses 1m mark-price candles, so its fills are close to what a live check would have given. For longer gaps it uses coarser candles (15m/1h), so fills are less precise.
- **The phone's network may differ from our server's.** fapi.binance.com and fstream may or may not be reachable from TONNY's mobile network in India; that could not be tested from here. The fallback order handles either case.
- The universe uses **today's** top 20 by volume, like the live backend. The research showed this point-in-time choice matters for backtests. It does not change live signals.
- Backtest numbers in Settings are history (2020–2026), not a forecast. The aggressive preset had a worst fall of -44 %.

## True 24/7 option: run the Python backend on an always-on device
The full backend (`../backend`, same rules plus the server-side scanner loop) keeps running while the phone sleeps if it is hosted on something that stays on. Open its dashboard from the phone.

### A) Android phone/tablet with Termux (**UNTESTED: written from Termux docs, not run on a device**)
```
# 1. Install Termux from F-Droid (the Play Store build is outdated), open it:
pkg update && pkg upgrade -y
pkg install -y python git unzip
termux-setup-storage                 # allow access to Downloads
# 2. Copy quant-terminal.zip to the phone's Downloads folder, then:
cd ~ && unzip ~/storage/downloads/quant-terminal.zip && cd quant-terminal
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
#    If pip fails building "pydantic-core" (no ready-made Android wheel), install a compiler and retry:
#    pkg install -y rust binutils && pip install -r requirements.txt
# 3. Keep Termux alive and start (paper only):
termux-wake-lock
python -m backend.main               # serves http://127.0.0.1:8000
```
Open `http://127.0.0.1:8000` in the phone's browser.
- Also exempt **Termux** from battery optimisation (Settings → Apps → Termux → Battery → Unrestricted). Without that, Android may still kill it.
- Everything stays on the phone: binding to 127.0.0.1 means nothing is reachable from outside.

### B) Small always-on server (VPS / free tier: e.g. Oracle Cloud Always Free, Google Cloud e2-micro). Needs an account, TONNY's approval required
```
sudo apt update && sudo apt install -y python3-venv unzip
unzip quant-terminal.zip && cd quant-terminal && ./start.sh        # binds 127.0.0.1:8000
```
- Choose a server region where `fapi.binance.com` or `www.binance.com/fapi` is reachable. Binance blocks some countries, e.g. the US (HTTP 451).
- **The backend has no login.** Do **not** expose port 8000 to the internet. From the phone, reach it through an SSH tunnel (`ssh -L 8000:127.0.0.1:8000 user@server`, e.g. with the Termius app) or a private VPN like Tailscale. Then open `http://127.0.0.1:8000` (SSH tunnel) or the server's Tailscale address.

## Voice
See **VOICE_ACTIVATION.md**. The phrase "Open Falcon terminal" opens Falcon in the Grok Bot app via Google Assistant, Bixby or Siri Shortcuts. Tapping the call button is still manual.

## Tests
```
npm test   (= node --test --test-reporter=spec tests/core.test.js)   # JS unit tests, cross-checked against the Python backend
../.venv/bin/python tools/make_fixtures.py         # (re)build tests/fixtures/py_reference.json from the Python code
node tools/headless_smoke.js http://127.0.0.1:8765/ /tmp/shot.png   # needs puppeteer-core + Chrome (not bundled)
```
The cross-check uses **real cached Binance daily klines** for BTC, ETH, SOL, DOGE, XRP and BNB, run through the Python code and the JS port, and compares the results. It covers:
- SMA, ATR, drawdown and correlation;
- 156 signal windows (LONG, NO TRADE and SHORT decisions), including the reason text;
- sizing;
- a 10-step paper scenario: caps rejections, slippage, fees, funding, stop hits, closes, preset switch.

## Files
```
index.html  style.css  manifest.json  sw.js  icons/
js/core.js   indicators, signal, sizing, caps, paper engine (port of backend/*.py)
js/data.js   Binance REST fallback chain + mark-price websocket
js/app.js    UI, scheduling, resume catch-up, wake lock, notifications
tests/       node unit tests + fixtures/py_reference.json
tools/       make_fixtures.py, headless_smoke.js
VOICE_ACTIVATION.md
```
