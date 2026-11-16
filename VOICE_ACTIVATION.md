# Voice activation: "Open Falcon terminal"

**What the phrase does:** it opens **Falcon, your assistant in the Grok Bot app**. It does **not** open the Quant Terminal dashboard. You can change the phrase to anything you like.

**The last step is manual.** After the app opens, tap **Falcon**, then tap the **call button**.
As far as we know there is **no link (deep link / URL scheme) that starts a Falcon voice call in one step**, so this guide does not use one. If one becomes available later, it can go in the "Open URL" step instead.

**Optional second phrase**, for example "Open quant terminal". This one opens the paper-trading PWA (see the end of this guide).

> **Menu names were not tested on a real phone.** They come from Google, Samsung and Apple help pages and recent guides (checked 16 Nov 2026). Names change between phone, OS and app versions. Lines marked ⚠ are the ones most likely to look different on your phone.

---

## Android: Google Assistant routine

1. Open the **Google Home** app → **Automations** → **+ / Add** → **Personal routine**.
   Older path: phone **Settings → Google → All services → Settings for Google apps → Search, Assistant & Voice → Google Assistant → Routines → New**. ⚠ The path depends on the version.
2. Tap **Add starter** → **When I say to Google Assistant** → type `Open Falcon terminal` → **Add starter**.
3. Tap **Add action** → **Try adding your own** → type `open Grok Bot` → **Done**.
   If your version lists an **"Open app"** action, you can pick **Grok Bot** there instead. ⚠ Not every version has this action.
4. Name the routine (e.g. "Falcon") → **Save**.
5. Say: **"Hey Google, open Falcon terminal."** Grok Bot opens. Then tap **Falcon**, then the **call button** (manual).

⚠ **Gemini:** on newer phones, **Gemini** may answer instead of Google Assistant. Gemini may not run Assistant routines. If the phrase does nothing:
- set Google Assistant as the default digital assistant (Settings → Apps → Default apps → Digital assistant app), or
- use the Bixby or home-screen-shortcut option instead.

Routines can also need the phone to be **unlocked** before they open an app.

## Samsung: Bixby Quick command

1. Open **Bixby** (side key, or the Bixby app) → **⋮ menu** (top right) → **Quick commands** → **+**.
2. In **"What you say to Bixby"** type `Open Falcon terminal`.
3. Tap **+ Add a command** → **Type a command** → `open Grok Bot`.
   You can also try **Select a command** → pick the app → **Open**. ⚠ Third-party apps are not always in that list.
4. Tap **Save**.
5. Say: **"Hi Bixby, open Falcon terminal."** Then tap **Falcon**, then the **call button** (manual).

Alternative: **Modes and Routines** (Settings → Modes and Routines → Routines → +).
- "If": there is no voice trigger there; Quick commands are the voice part.
- "Then": **Apps → Open an app → Grok Bot**.
- ⚠ Wording differs between One UI versions.

## iPhone: Siri Shortcut (runs by its name)

1. Open the **Shortcuts** app → **+** (new shortcut).
2. **Add Action** → search **Open App** → tap **App** → choose **Grok Bot**.
3. Tap the shortcut name at the top → **Rename** → `Open Falcon terminal` → **Done**.
4. Say: **"Hey Siri, Open Falcon terminal."** Siri runs a shortcut when you say its exact name.
5. Grok Bot opens. Then tap **Falcon**, then the **call button** (manual).

Tip: if Siri mis-hears, pick a shorter, unusual name (e.g. "Falcon go"). You can also add the shortcut to the Home Screen or the Action Button (iPhone 15 Pro and later).

---

## Optional second phrase: "Open quant terminal" (opens the paper-trading PWA)

You need the PWA's HTTPS address first. See README "Hosting", e.g. `https://<your-name>.github.io/quant-terminal-mobile/`. Nothing has been published yet.

- **Google Assistant**: same routine steps, action **Try adding your own** → `open https://…/` (opens in the browser).
  ⚠ Assistant sometimes runs a web search for this instead of opening the address.
  If you installed the PWA ("Add to Home screen"), try the action `open Quant Terminal` instead. ⚠ Not tested.
- **Bixby**: Quick command → Add a command → Select a command → **Samsung Internet** → open website.
  Or "Type a command": `open https://…/`. Typing `open QuantTerm` may also work for an installed PWA. ⚠ Not tested.
- **iPhone**: new Shortcut → action **Open URLs** → paste the address → rename to `Open quant terminal`.
  ⚠ This opens Safari, not the Home-Screen app window. iOS has no supported way to launch a Home-Screen web app from Shortcuts.

## What was not verified
- Exact menu labels on TONNY's phone model and current OS version.
- That a Google Assistant "Open app" action exists in every version. "Try adding your own" + "open Grok Bot" is the general fallback.
- That the app is listed under exactly the name "Grok Bot". Use whatever name your app drawer shows.
- Whether Gemini (replacing Google Assistant on many Android phones) still runs custom routines.
- **Any link that starts a voice call with Falcon directly: none known, so none is used.**
