# FALCON Windows Assistant — Core 0.1.0

A separate Windows desktop/browser assistant built around a local Python service and Ollama. This does not modify the repository's existing Quant Terminal.

## Included in this first delivery

- Local web dashboard at `http://127.0.0.1:8765`
- Ollama model discovery and model selection, including any cloud-backed models exposed by the user's Ollama installation
- Initial Research workspace: DuckDuckGo HTML search, up to six result links/snippets, and evidence-limited synthesis by the selected Ollama model
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

Open PowerShell in this folder. The setup script checks for a working Python interpreter (including the Windows `py` launcher); it will stop with an installation instruction if Python is missing. The launcher reuses an existing FALCON server on port 8765 or selects another free local port if that port belongs to another application:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Setup.ps1
.\Launch-FALCON.ps1
```

Then open `http://127.0.0.1:8765`. The launcher opens the browser. Keep the PowerShell window open while using FALCON; Ctrl+C stops the service.

## Data and privacy

- The server binds to `127.0.0.1` only. It is not exposed to your LAN or public internet.
- Conversations, tasks and saved memories are stored in `data/falcon.db` on this PC.
- Prompts are sent to the selected Ollama model. Local models process locally. A cloud model selected through Ollama sends prompts to that cloud provider; do not use cloud models for sensitive data unless you accept that provider's terms.
- This first version does not read arbitrary files, run shell commands, control the mouse/keyboard, or execute unattended actions.
- Do not put API keys or passwords into memory or chat.

## Research workspace

Open **Research** in the dashboard and submit a question. FALCON queries DuckDuckGo's public HTML search endpoint, then attempts bounded HTML retrieval for up to six result pages. It extracts a limited amount of readable page text and available publication-date metadata, and asks the selected Ollama model to draft a brief with numbered source references. The interface shows each page's retrieval status and whether date metadata was found. A successful fetch is not proof that a page's claims are true; dates may be absent, extraction may be incomplete, and some sites block automated access. Treat model summaries as analysis, inspect the linked sources, and verify important claims independently. Search availability depends on internet access and the upstream search service.

## Configuration

Edit `config.json` to change the Ollama endpoint or request timeout. The default is `http://127.0.0.1:11434`.

## Current limitations — not implemented yet

- Native Windows desktop shell / tray icon
- Wake-word listening and continuous microphone mode
- Native offline speech-to-text and text-to-speech engines
- Full-page retrieval and source verification (the initial Research workspace analyzes search-result snippets only)
- File workspace and code-editing agent
- Permission-gated Windows automation
- Multi-agent orchestration and scheduled background jobs
- Installer / auto-updater

These are planned stages, not claimed features. Voice input depends on browser support and may use the browser's speech service. Voice output uses the browser's built-in speech synthesis.

## Troubleshooting

- **Ollama offline:** start Ollama and verify `http://127.0.0.1:11434/api/version`.
- **No models:** run `ollama list`, then `ollama pull qwen3:4b`.
- **Port busy:** close the other process using port 8765, or set a different `FALCON_PORT` before launching.
- **No voice input:** use current Microsoft Edge or Chrome and allow microphone permission.

## Security model

The service intentionally has no remote-access mode or arbitrary command-execution endpoint. Do not expose it using port forwarding. Any future computer-control feature must have a visible approval step and a clear action log.
