# Changelog

All notable changes to **Michaelangelo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] — 2026-08-25

### Added
- **`/diff` slash command** — Visual side-by-side diff of all files changed in the current session
- **`SessionFileTracker`** — Records every `write_file` and `edit_file` change with original/new snapshots
- **Diff tab badge** — Shows file count (e.g., `Diff (3)`) in the context panel
- **Structured SSE diffs** — Diffs stream to the frontend via `session_diffs` event for live rendering

### Fixed
- Diffs auto-clear on `/clear` or new conversation

---

## [1.3.0] — 2026-08-24

### Added
- **Onboarding guide** — 4-step getting started walkthrough with API key setup for NVIDIA NIM and OpenRouter
- **Notification chime** — Pleasant three-tone ascending chime (C5→E5→G5) when agent finishes responding
- **Dashboard overhaul** — Proper overview tab (sessions, tool calls, tokens, cost) + live activity stream
- **Dark/Light theme** — Full CSS variable-based theme toggle with `Ctrl+Shift+T` shortcut, persists across restarts
- **Plugin Marketplace expansion** — 16 plugins including Slack, Notion, Sentry, Vercel, Linear, Postman, Supabase
- **Custom plugin support** — "Add Plugin" button to create custom plugins that persist across sessions
- **Claude Code superpower skills** — 10 elite engineering skills:
  - `/tdd` — Red-Green-Refactor loop
  - `/debug` — 6-phase systematic diagnosis
  - `/review-code` — Spec compliance review
  - `/architect` — Dependency analysis and coupling detection
  - `/investigate` — Stack trace root cause tracing
  - `/verify` — Run tests + build after every change
  - `/plan` — Structured execution planning
  - `/execute` — Step-by-step plan execution
  - `/refactor` — Safe refactor workflow
  - `/smart-commit` — Analyze changes, write proper commit messages
- **Impeccable UI/UX design system** — 8 design skills + 4 design tools:
  - `/design-landing`, `/design-dashboard`, `/design-form`, `/design-card`
  - `/design-theme`, `/design-responsive`, `/design-accessibility`, `/design-animation`
  - `generate_ui`, `check_design`, `create_theme`, `generate_component`
- **Skills UI** — Browse, search, and run skills from the sidebar with category filtering
- **Full Playwright access** — 20+ browser interaction tools:
  - E2E: `click`, `type`, `fill`, `press`, `hover`, `check`, `select`, `scroll`, `drag`, `upload`, `wait_for`
  - Tabs: `new_tab`, `switch_tab`, `list_tabs`
  - Navigation: `go_back`, `go_forward`, `reload`
  - State: `pdf`, `cookie`, `local_storage`, `intercept`
  - Device: `emulate` (mobile emulation)
  - Auth: `auth` (login, save/load auth state)
- **Link crawler + auto-fix** — `check_links` and `fix_links` tools for broken link detection
- **`/audit` command** — Full site audit: crawl links, check imports, test interactive elements
- **Auto-dependency install** — `ensure_dependency` tool auto-detects and installs missing tools
- **CodeRabbit integration** — `/coderabbit` command for AI code review
- **Power slash commands** — `/compare`, `/explain`, `/deps`, `/test-gen`, `/format`, `/persona`, `/coderabbit`, `/audit`, `/skills`
- **Auto-continue agentic loop** — Agent never stops mid-task while todos remain
- **Permission dropdown** — Allow / Full Access / Deny with session-level persistence
- **Permission requests in chat** — Permission dialogs appear inline in the chat window
- **Model thinking display** — Shows reasoning/thinking process in chat window
- **UI text size bump** — All text scaled up for better readability (9→10.5, 10→12, 11→13px)

### Fixed
- Plugin Marketplace blank page — proper import, error handling, duplicate route fix
- Stuck todos — stale detection, auto-complete, and auto-clear after 2 seconds
- Agent stops after 1 todo — stronger loop instructions + task state preservation across context compression
- Local LLM models showing offline — fixed timeout and sequential testing

---

## [1.2.0] — 2026-08-23

### Added
- **Production-grade agent architecture**:
  - PageRank Repo Map via AST elision (Aider/Cursor style)
  - Cascading Planner mode (Windsurf/Aider style) — read-only research → execution plan → approval → sequential execution
  - Output Interceptor — terminal output > 1500 tokens compressed by fast local LLM
  - Context Compaction & Rehydration engine — triggers at 60% context window, compresses old traffic
  - Dispatch Agent (sub-agent spawning) — isolated background agents for parallel research
- **Split-pane chat** — Chat on left, live terminal panel + diff viewer + permission dialogs on right
- **Drag-to-resize splitter** — Adjustable split ratio between chat and context panels
- **`/approve` and `/deny` slash commands** — Inline permission management from chat input
- **Real-time diff streaming** — `edit_file` diffs flow through SSE to DiffViewer in real-time
- **SSE streaming** — Token-by-token real-time responses from the agent endpoint
- **WebSocket dashboard** — Real-time agent activity dashboard with live event stream
- **Playwright headless browser** — Visual web UI analysis with screenshot capabilities
- **Context compression, multi-model router, headless CI/CD, workflow tools** — Full production systems
- **27 tools total** — Complete Claude Code tool parity
- **JSON repair** — Text-based tool call parser with auto-repair for malformed JSON
- **10 production improvements** — Workspace detection, parser fixes, persistence, file tree, and more
- **Windows NSIS installer** — Package as Windows installer with auto-update support

### Fixed
- Unhandled errors in streaming agent causing Electron crash dialog
- Production cleanup — dead code removal, bug fixes, integration tests
- Chat state preserved when switching tabs (ChatView stays mounted)
- JSON repair for text-based tool call parser

---

## [1.1.0] — 2026-08-22

### Added
- **Provider tabs** — Models organized by provider (NVIDIA NIM, OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, Groq, Together, Mistral, Cohere)
- **Parallel model testing** — Tests all models simultaneously for faster online/offline detection
- **10 API providers** — Full support for OpenRouter, NVIDIA NIM, OpenAI, Anthropic, DeepSeek, Gemini, Groq, Together, Mistral, Cohere
- **Local LLM support** — Ollama, llama.cpp, LM Studio, vLLM compatible endpoints
- **Compact UI overhaul** — List-mode models, auto-test on app open, model fallback
- **Model status indicators** — Green dot for online, red dot for offline
- **Model selection** — Check/radio button to select active model
- **Model fallback** — Auto-switch to working model if current model goes offline
- **Workspace folder selection** — Choose working folder from Chat view
- **Agentic tool execution loop** — Gather → Plan → Execute → Verify cycle
- **Claude Code-style agent architecture** — 3-phase loop, skills, MCP, sub-agents
- **Production-grade agent with permissions** — `edit_file`, `glob`, simplified loop
- **Plugin system** — Event-driven plugin registry with lifecycle hooks
- **Persistent memory** — Auto-capture tool outputs, compress into semantic summaries
- **MCP (Model Context Protocol)** — Connect to external MCP servers for dynamic tool loading

### Fixed
- NIM model routing — filter chat models, sort active models first
- Chat routing through agentic endpoint for file creation
- Allow selecting any non-offline model in Models tab
- Fetch NIM models dynamically from API instead of hardcoded list

---

## [1.0.0] — 2026-08-22

### Added
- **Initial release** — FreebuffCC v3 (later renamed to Michaelangelo)
- **Electron + React + Express architecture** — Desktop app with internal proxy server
- **Multi-provider chat proxy** — OpenRouter, NVIDIA NIM, OpenAI, Anthropic, DeepSeek, Gemini, Groq, Together, Mistral, Cohere
- **Agentic tool execution** — `write_file`, `read_file`, `run_command` with tool call loop
- **Settings view** — API key management for all providers with `electron-store` persistence
- **Model Manager** — Fetch, test, and select models from all providers
- **Chat view** — Real-time chat interface with message history
- **Context compression** — Summarize tool outputs to save tokens
- **Multi-model router** — Route standard vs. complex tasks to different models
- **Headless CI/CD mode** — CLI entry point for PR review and auto-fix
- **Workflow meta-tools** — Git branch, commit, PR, and ticket status tools
- **GitHub Actions CI** — Automated build verification
- **CommonJS config** — Node 18 compatibility
- **CONTRIBUTING.md, LICENSE, README badges** — Project documentation

### Renamed
- FreebuffCC → **Michaelangelo** (commit `abd7b94`)

---

## Tool Count Progression

| Version | Tools | Skills | Slash Commands |
|---------|-------|--------|----------------|
| 1.0.0 | 6 | 0 | 2 |
| 1.1.0 | 15 | 5 | 8 |
| 1.2.0 | 27 | 10 | 14 |
| 1.3.0 | 42 | 22 | 21 |
| 1.4.0 | 43 | 22 | 22 |

---

## Providers Supported

| Provider | API Key | Models |
|----------|---------|--------|
| NVIDIA NIM | ✅ | Llama 3.1, Nemotron, Mistral, etc. |
| OpenRouter | ✅ | 200+ models (GPT-4, Claude, Llama, etc.) |
| OpenAI | ✅ | GPT-4o, GPT-4 Turbo, etc. |
| Anthropic | ✅ | Claude 3.5 Sonnet, Claude 3 Opus, etc. |
| DeepSeek | ✅ | DeepSeek V2, DeepSeek Coder |
| Google Gemini | ✅ | Gemini 1.5 Pro, Gemini 1.5 Flash |
| Groq | ✅ | Llama 3.1, Mixtral |
| Together AI | ✅ | Llama, Mistral, etc. |
| Mistral | ✅ | Mistral Large, Mistral Small |
| Cohere | ✅ | Command R+, Command R |
| Local (Ollama) | ✅ | Any local model |

---

## Upgrading

### From 1.3.x to 1.4.0
No breaking changes. The `/diff` command is new and optional.

### From 1.2.x to 1.3.0
No breaking changes. New skills and design tools are additive.

### From 1.1.x to 1.2.0
No breaking changes. The split-pane UI is new; existing layouts are preserved.

### From 1.0.x to 1.1.0
- App renamed from FreebuffCC to **Michaelangelo**
- Provider tabs replace the single-model list
- Local LLM support requires configuring endpoint in Settings

---

*Generated from 68 commits across 4 days of development (Aug 22–25, 2026).*
