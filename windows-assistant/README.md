# FALCON Windows Assistant — Core 0.1.0

A separate Windows desktop/browser assistant built around a local Python service and Ollama. This does not modify the repository's existing Quant Terminal.

## Included in this first delivery

- Local web dashboard on the first available port in `8765–8875`
- Ollama model discovery and model selection, including any cloud-backed models exposed by the user's Ollama installation
- Research workspace: DuckDuckGo HTML search, up to five bounded page retrieval attempts, and evidence-limited synthesis by the selected Ollama model
- Chat requests through Ollama's local API
- Local SQLite conversation history
- Explicitly saved, reviewable and deletable memories
- Local task list with completion and deletion
- Browser speech recognition where supported, plus spoken replies using browser text-to-speech
- Windows PowerShell setup and launcher scripts
- No third-party Python packages

## Requirements

- Windows 10 or 11
- Python 3.10+
- Ollama for model responses: https://ollama.com/download/windows
- At least one model installed. A small starter model:
  ```powershell
  ollama pull qwen3:4b
  ```
  Existing models such as `gemma3:4b` can also be used.

## Start

Open PowerShell in this folder. The setup script checks for a working Python interpreter (including the Windows `py` launcher); it will stop with an installation instruction if Python is missing. The launcher searches ports 8765–8875 for an existing FALCON instance before starting a new one. If another application owns a port, it selects the next free local port:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Setup.ps1
.\Launch-FALCON.ps1
```

The launcher prints and opens the actual URL. Use that URL; the port may be different from 8765 when another app owns the default port. Keep the PowerShell window open while using FALCON; Ctrl+C stops the service.

## Data and privacy

- The server binds to `127.0.0.1` only. It is not exposed to your LAN or public internet. The launcher manages ports 8765–8875 and reuses an existing FALCON instance in that range.
- Conversations, tasks and saved memories are stored in `data/falcon.db` on this PC.
- Prompts are sent to the selected Ollama model. Local models process locally. A cloud model selected through Ollama sends prompts to that cloud provider; do not use cloud models for sensitive data unless you accept that provider's terms.
- This first version does not read arbitrary files, run shell commands, control the mouse/keyboard, or execute unattended actions.
- Do not put API keys or passwords into memory or chat.

## Research workspace

Open **Research** in the dashboard and submit a question. FALCON queries DuckDuckGo's public HTML search endpoint, then attempts bounded HTML retrieval for up to five result pages. It extracts a limited amount of readable page text and common publication-date metadata, and asks the selected Ollama model to draft a brief with numbered source references. Research synthesis prefers Gemma 3 or Llama 3.2. On the tested Ollama 0.40.16 setup, Qwen3 ignored both the `think: false` API field and the literal `/no_think` prompt and exhausted its output budget without a usable final answer. If Qwen3 is selected (or `auto` would otherwise choose it), FALCON routes research synthesis to an installed non-Qwen3 model and reports the actual model used. If no non-Qwen3 model is installed, research stops with an actionable error rather than presenting reasoning text as a report. The interface shows each page's retrieval status and whether date metadata was found. A successful fetch is not proof that a page's claims are true; dates may be absent, extraction may be incomplete, and some sites block automated access. The research endpoint reports model diagnostics if Ollama returns no final answer. Treat model summaries as analysis, inspect the linked sources, and verify important claims independently. Search availability depends on internet access and the upstream search service.

## Configuration

Edit `config.json` to change the Ollama endpoint or request timeout. The default is `http://127.0.0.1:11434`.

## Current limitations — not implemented yet

- Native Windows desktop shell / tray icon
- Wake-word listening and continuous microphone mode
- Native offline speech-to-text and text-to-speech engines
- Browser-grade full-page rendering and independent source verification (research uses bounded text extraction and requires human review)
- File workspace and code-editing agent
- Permission-gated Windows automation
- Multi-agent orchestration and scheduled background jobs
- Installer / auto-updater

These are planned stages, not claimed features. Voice input depends on browser support and may use the browser's speech service. Voice output uses the browser's built-in speech synthesis.

See [HANDOVER.md](HANDOVER.md) for the full architecture, API inventory, operating procedure, validation checklist, backup/restore notes, and known limitations.

## Troubleshooting

- **Ollama offline:** start Ollama and verify `http://127.0.0.1:11434/api/version`.
- **No models:** run `ollama list`, then `ollama pull qwen3:4b`.
- **Port busy:** the launcher scans ports 8765–8875 and selects an available one. Use the URL it prints.
- **No voice input:** use current Microsoft Edge or Chrome and allow microphone permission.

## Security model

The service intentionally has no remote-access mode or arbitrary command-execution endpoint. Do not expose it using port forwarding. Any future computer-control feature must have a visible approval step and a clear action log.
