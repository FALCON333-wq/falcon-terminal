# FALCON Windows Assistant — System Handover

**Release line:** Core 0.1.x  
**Repository:** FALCON333-wq/falcon-terminal  
**Working branch:** feature/falcon-windows-assistant  
**Application directory:** windows-assistant/

This document is the operational handover for the Windows assistant. It describes the current implementation, how to run and validate it, where data lives, and what is not implemented. It does not claim that unrun tests passed or that every possible defect has been eliminated.

## 1. System overview

FALCON is a local-first browser dashboard backed by a Python standard-library HTTP server and Ollama.

- **UI:** index.html, style.css, app.js
- **Backend:** server.py using http.server, sqlite3, urllib, html.parser, and the standard library
- **Model runtime:** Ollama HTTP API, default http://127.0.0.1:11434
- **Database:** data/falcon.db (SQLite)
- **Network binding:** loopback only, 127.0.0.1
- **Managed ports:** 8765–8875
- **External research search:** DuckDuckGo HTML search endpoint; result pages are fetched best-effort

FALCON is separate from the repository's existing Quant Terminal. Do not move these files into the trading application or change its entry points as part of FALCON maintenance.

## 2. Features currently present

1. Chat with a model available in the connected Ollama installation.
2. Auto model selection (prefers a model whose name starts with qwen3, otherwise the first installed model) or explicit model selection.
3. Local SQLite conversation history.
4. Explicitly saved and deletable memory records.
5. Local task list with completion and deletion.
6. Research workspace: web search, bounded HTML page retrieval, limited page-text extraction, available publication-date metadata, and local-model synthesis with numbered source references.
7. Browser voice input/output where the browser supports those APIs. Voice input may depend on browser speech services; it is not guaranteed to be fully offline.
8. A PowerShell launcher that finds an existing FALCON instance on the managed port range before starting another process.

## 3. Requirements

- Windows 10 or 11
- Python 3.10+ (the launcher prefers py -3 and avoids the Microsoft Store python.exe alias)
- Ollama installed and running
- At least one Ollama model installed; for example: ollama pull qwen3:4b

No third-party Python packages are required by the current backend.

## 4. Install, update, start, stop

Open PowerShell:

```powershell
cd C:\Users\meetb\falcon-terminal
git switch feature/falcon-windows-assistant
git pull origin feature/falcon-windows-assistant
cd .\windows-assistant
Set-ExecutionPolicy -Scope Process Bypass
.\Setup.ps1
.\Launch-FALCON.ps1
```

Keep the launcher terminal open. It prints the actual URL and local data directory. Open the printed URL if the browser does not open automatically.

The launcher probes every port from 8765 through 8875 for an existing FALCON /api/status response. If found, it opens that instance rather than creating a duplicate. Otherwise it selects the first free port in the range. This permits another local application to own 8765 without preventing FALCON from starting.

**Stop:** focus the terminal running server.py and press Ctrl+C. Do not kill a process by PID unless its command line has been checked first.

**Important:** the port may differ from run to run if another application owns a port. Always use the URL printed by the launcher or discover the active port using the validation commands below. Do not assume 8766.

## 5. Configuration and local data

config.json is read from the application directory. If absent, server.py creates defaults:

- ollama_url: http://127.0.0.1:11434
- default_model: auto
- request_timeout: 180

The application creates data/falcon.db on first start. It stores conversations, messages, explicitly saved memories, and tasks. Back up the whole data directory while FALCON is stopped. Do not commit the database or private conversation contents to Git.

## 6. HTTP API inventory

All routes are served by the local Python process.

| Method | Path | Purpose |
|---|---|---|
| GET | / | Dashboard |
| GET | /api/status | FALCON and Ollama status |
| GET | /api/models | Installed Ollama models |
| GET | /api/conversations | Recent conversation list |
| GET | /api/conversations/{id} | Messages for one conversation |
| POST | /api/chat | Non-streaming chat response |
| POST | /api/research | Search, retrieve pages, synthesize report |
| GET/POST | /api/memory | List or save explicit memories |
| DELETE | /api/memory/{id} | Delete one memory |
| GET/POST | /api/tasks | List or create tasks |
| PATCH | /api/tasks/{id} | Set task completion |
| DELETE | /api/tasks/{id} | Delete a task |

The service is designed for local use and has no authentication. Do not expose it to the LAN or public internet and do not configure router port forwarding.

## 7. Research engine: current behavior and safeguards

The research pipeline:

1. Sends the user's query to DuckDuckGo's public HTML search endpoint.
2. Parses up to five result links and snippets.
3. Attempts bounded HTML retrieval for each result, with a per-page timeout and response-size limit.
4. Extracts readable text, the page title, and common date metadata (date, article:published_time, datePublished, dc.date, time[datetime], and related fields).
5. Sends bounded excerpts and snippets to the selected Ollama model.
6. Requests numbered citations that refer only to the supplied source list.
7. Returns retrieval statuses and date metadata alongside the report.

### Qwen3 generation fix

The previous failure was confirmed by Ollama diagnostics: done_reason=length, eval_count=384, 1,629 characters in the separate thinking field, and empty message.content. The model consumed its entire 384-token generation allowance without producing a final answer.

The research request has been changed to:
- append Qwen3's /no_think control to the research prompt for models named qwen3...;
- increase num_predict from 384 to 768;
- limit the requested brief to 250 words;
- reduce each source excerpt passed to the model;
- use actual newline characters in the prompt instead of literal backslash-n sequences;
- preserve diagnostics if Ollama still returns no final answer;
- flag an answer if Ollama reports that output was truncated by the token limit.

This is a code-level correction. It still requires the user's local runtime test after pulling the latest branch. Do not describe the fix as runtime-verified until the research request returns a non-empty report on the target PC.

### Evidence limits

- A successful HTTP fetch only means the page was retrieved. It does not prove that the page's statements are accurate.
- Date metadata may be absent, misleading, or refer to an update rather than the original announcement.
- Search snippets can be inaccurate or stale.
- Some pages block automated access or return incomplete text.
- The model can still misunderstand evidence or cite a source incorrectly. Verify important claims against primary announcements and original documents.
- Do not treat a generated research report as a substitute for source review.

## 8. Validation checklist

Run these checks after each update.

### A. Python syntax

From the windows-assistant directory:

```powershell
py -3 -m py_compile .\server.py
```

No output and exit code 0 means the file compiled. This checks syntax only, not runtime behavior.

### B. Research parser unit tests

Run from the windows-assistant directory:

```powershell
py -3 -m unittest discover -s tests -v
```

These tests cover publication-date parsing, page text filtering, search-result parsing, and rejection of a loopback URL. They do not call Ollama or validate live web search.

### C. Find the active FALCON port

```powershell
8765..8875 | ForEach-Object {
    $p = $_
    try {
        $s = Invoke-RestMethod "http://127.0.0.1:$p/api/status" -TimeoutSec 1
        if ($s.app -eq "FALCON") {
            "FALCON PORT: $p"
            $s | ConvertTo-Json -Depth 5
        }
    } catch {}
}
```

Expected status fields include app=FALCON, status=online, and ollama=connected.

### D. Models

Replace 8766 with the port discovered above:

```powershell
Invoke-RestMethod "http://127.0.0.1:8766/api/models" | ConvertTo-Json -Depth 6
```

### E. Chat

```powershell
$body = @{ message = "Reply with exactly: FALCON CHAT TEST PASSED"; model = "qwen3:4b" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/chat" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180 | ConvertTo-Json -Depth 6
```

### F. Research

```powershell
$body = @{ query = "Summarize three recent official AI product announcements. Include source links and dates only when supported."; model = "qwen3:4b" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/research" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 700 | ConvertTo-Json -Depth 12
```

Use the actual active port instead of 8766 if it differs. A successful research response must contain a non-empty report, a model name, and a sources array. Review the source statuses and dates; do not validate the report based only on HTTP 200.

## 9. Troubleshooting

- **Unable to connect:** FALCON is not listening on the port used in the request. Find the active port using section 8B and use the launcher's printed URL.
- **Port 8765 shows another app:** expected if another local app owns it. The launcher should find/reuse FALCON elsewhere in 8765–8875.
- **Ollama offline:** start Ollama, then test http://127.0.0.1:11434/api/version.
- **No models:** run ollama list and install a model if needed.
- **Research 502 with done_reason=length:** inspect ollama_diagnostics. Confirm the latest server.py is running and Qwen3 research uses /no_think plus the larger output budget. Capture the full response; do not keep increasing limits blindly.
- **Research 504:** model generation or the Ollama request exceeded the backend timeout. Check Ollama logs, system RAM/VRAM, and model load time.
- **Search failed:** check internet access and whether DuckDuckGo's HTML endpoint is reachable.
- **Wrong/old behavior after update:** stop the old FALCON process with Ctrl+C, pull the branch, then relaunch. A running Python process does not automatically load changed source code.

## 10. Security and privacy

- The HTTP server binds to loopback (127.0.0.1) and has no authentication. Keep it local.
- Local Ollama models process prompts on the PC. Ollama cloud models send prompts to the cloud provider; provider terms and privacy apply.
- Research sends search queries to DuckDuckGo and fetches public pages. Do not submit confidential material in research queries.
- Saved memory is explicit and stored in the local SQLite database. Avoid storing passwords, API keys, recovery codes, or other secrets.
- The current assistant does not provide arbitrary PowerShell execution, general filesystem browsing, remote desktop control, or unattended computer automation.

## 11. Known limitations / not included

- No native Windows executable installer, tray application, or auto-updater.
- No guaranteed offline speech recognition or offline voice synthesis.
- No background autonomous agent or scheduler.
- No full browser-grade rendering for source pages; extraction is text-only and best-effort.
- No independent fact-checking service. Human review of primary sources remains necessary.
- No user authentication, multi-user isolation, or remote access.
- No guaranteed performance on models other than those actually tested on the target PC.

## 12. Handover acceptance criteria

Treat the handover as operationally accepted only after the target PC passes all of these:

- [ ] py -3 -m py_compile .\server.py
- [ ] launcher finds/reuses the existing FALCON process without starting a duplicate
- [ ] /api/status reports FALCON online and Ollama connected
- [ ] /api/models lists installed models
- [ ] /api/chat returns a non-empty answer
- [ ] /api/research returns a non-empty report with sources
- [ ] a saved conversation remains after restarting FALCON
- [ ] tasks and explicitly saved memories can be created, listed, and deleted
- [ ] database backup and restore procedure is understood

**Current handover status:** source changes are committed to the feature branch. Runtime acceptance remains pending the user's Windows-side validation.