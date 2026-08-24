# Michaelangelo

**The open-source AI coding agent that runs on your desktop.**

A standalone Windows application that gives you Claude Code-level capabilities using free and local AI models. Write code, run commands, browse the web, test websites, and build entire projects — all from a single desktop app.

[![CI](https://github.com/macmaker16/Michaelangelo/actions/workflows/ci.yml/badge.svg)](https://github.com/macmaker16/Michaelangelo/actions/workflows/ci.yml)
![Electron](https://img.shields.io/badge/Electron-28-47848f)
![React](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06b6d4)
![License](https://img.shields.io/badge/License-MIT-green)

[![Download Installer](https://img.shields.io/badge/Download-Installer-blue)](https://github.com/macmaker16/Michaelangelo/releases/latest)
[![Download Portable](https://img.shields.io/badge/Download-Portable-purple)](https://github.com/macmaker16/Michaelangelo/releases/latest)

---

## What Is Michaelangelo?

Michaelangelo is an **autonomous AI coding agent** that doesn't just chat — it **writes files, runs commands, tests websites, and builds entire projects** by itself. It connects to free AI model providers (NVIDIA NIM, OpenRouter, Ollama local models) and gives them superpowers with 42 built-in tools.

### Quick Demo
```
You: "Create a React landing page with a hero section, pricing table, and contact form"

Michaelangelo:
  1. Creates project structure (package.json, index.html, src/)
  2. Writes all React components
  3. Installs dependencies (npm install)
  4. Starts dev server and takes a screenshot
  5. Finds broken links and fixes them
  6. Runs tests to verify everything works
  7. Plays a notification chime when done
```

---

## Features

### 🤖 Agentic Tool Execution
Michaelangelo uses a **4-phase execution loop** (Gather → Plan → Execute → Verify) that lets it autonomously chain multiple tool calls:

| Category | Tools |
|----------|-------|
| **File System** | read, write, edit, list, glob, search, find |
| **Terminal** | run_command, ensure_dependency (auto-installs Docker, npm, etc.) |
| **Git** | status, diff, stage, commit, branch, log |
| **Web** | web_search, web_fetch, web_lookup |
| **Browser (Playwright)** | navigate, screenshot, click, type, fill, hover, scroll, PDF, cookies, local storage, emulation, auth |
| **Link Checking** | crawl site for broken links, auto-fix in source files |
| **Code Intelligence** | symbol search, error diagnosis |
| **Agent** | create_plan, todo_write, dispatch_sub_agent |
| **Design** | generate_ui, create_theme, check_design, responsive_check |

### 🎨 Impeccable UI/UX Design System
Build production-ready UIs with built-in design skills:
- **Design Landing** — full landing page with hero, features, testimonials, CTA
- **Design Dashboard** — admin dashboard with sidebar, charts, tables
- **Design Form** — beautiful forms with validation and micro-interactions
- **Design Theme** — complete design system with tokens and variables
- **Responsive Check** — audit and fix mobile/tablet/desktop layouts

### 🧪 Claude Code Superpowers
Built-in engineering skills inspired by Anthropic's best practices:

| Skill | Trigger | What It Does |
|-------|---------|-------------|
| 🧪 TDD | `/tdd` | Red-Green-Refactor loop — write tests first |
| 🐛 Debug | `/debug` | 6-phase systematic bug diagnosis |
| 🔍 Review | `/review-code` | Spec compliance, edge cases, performance review |
| 🏗️ Architect | `/architect` | Dependency analysis and architecture improvements |
| 🔬 Investigate | `/investigate` | Root cause tracing from stack traces |
| ✅ Verify | `/verify` | Run tests + build after every change |
| 📝 Plan | `/plan` | Structured execution plan before code changes |
| ▶️ Execute | `/execute` | Run plan step-by-step with verification |
| 🔄 Refactor | `/refactor` | Safe refactor with test coverage |

### 📊 20+ Slash Commands

| Category | Commands |
|----------|----------|
| **Session** | `/compact`, `/clear`, `/export`, `/cost`, `/sessions`, `/resume` |
| **Project** | `/init`, `/config`, `/memory`, `/lang`, `/persona` |
| **Agent** | `/model`, `/review`, `/test`, `/fix`, `/build`, `/run`, `/commit`, `/branch`, `/template`, `/compare`, `/explain`, `/deps`, `/test-gen`, `/format` |
| **Design** | `/design-landing`, `/design-dashboard`, `/design-form`, `/design-card`, `/design-theme`, `/design-responsive`, `/design-accessibility`, `/design-animation` |
| **Review** | `/coderabbit` |
| **Audit** | `/audit <url>` — full site crawl for broken links |
| **Info** | `/help` |

### 🧩 Plugin Marketplace
16 built-in plugins + custom plugin support:

| Plugin | Category |
|--------|----------|
| GitHub Integration | Create repos, open PRs, manage issues |
| Docker Manager | Build, run, compose stacks |
| Database Tools | Query, migrate, schema management |
| Test Runner | Jest, Vitest, Pytest with coverage |
| Security Scanner | Dependency vulnerabilities, secret detection |
| API Testing | REST and GraphQL request builder |
| Slack / Notion / Linear | Productivity integrations |
| Sentry / Vercel / Supabase | DevOps and deployment |
| AWS Tools | S3, Lambda, CloudFormation |

### 🌐 Multi-Provider Support
Connect to any AI provider — cloud or local:

| Provider | Models | Cost |
|----------|--------|------|
| **NVIDIA NIM** | Llama 3.1, Nemotron, Mistral, Gemma | Free (1000 credits/mo) |
| **OpenRouter** | 200+ models (GPT-4o, Claude, Gemini, Llama) | Pay-per-use |
| **OpenAI** | GPT-4o, GPT-4o-mini | Pay-per-use |
| **Anthropic** | Claude 3.5 Sonnet, Haiku | Pay-per-use |
| **DeepSeek** | DeepSeek Coder V2 | Pay-per-use |
| **Google Gemini** | Gemini 1.5 Pro, Flash | Pay-per-use |
| **Groq** | Llama 3, Mixtral (ultra-fast) | Free tier |
| **Together AI** | Llama, Mixtral, Vicuna | Pay-per-use |
| **Local (Ollama)** | Any model you download | Free forever |

### 🖥️ Full Playwright Browser Automation
The agent can interact with websites like a real user:
- Navigate, click buttons, fill forms, take screenshots
- Test responsive layouts on mobile/tablet/desktop
- Emulate iPhone, iPad, or custom devices
- Save cookies and local storage state
- Export pages as PDF

### 💡 Smart Features
- **Auto-continue** — agent keeps working until all tasks are done
- **Error recovery** — failed commands trigger automatic retry
- **Context compression** — summarizes long conversations to stay in token limits
- **Model fallback** — auto-switches to working model if current one goes offline
- **Notification chime** — pleasant sound when agent finishes
- **Dark/Light theme** — toggle with `Ctrl+Shift+T`
- **Keyboard shortcuts** — `Ctrl+K` chat, `Ctrl+M` models, `Ctrl+D` dashboard
- **Thinking display** — see the model's reasoning process
- **Permission system** — approve/deny destructive operations

---

## Getting Started

See **[STARTER_GUIDE.md](STARTER_GUIDE.md)** for a complete walkthrough with screenshots.

### Quick Start
1. Download the [installer](https://github.com/macmaker16/Michaelangelo/releases/latest) or [portable exe](https://github.com/macmaker16/Michaelangelo/releases/latest)
2. Open Settings and add a free API key from [build.nvidia.com](https://build.nvidia.com)
3. Go to Models and select a model (green dot = online)
4. Start chatting — describe what you want to build!

---

## Installation for Developers

### Prerequisites
- **Node.js** 18 or later
- **npm** 9 or later

### Setup
```bash
git clone https://github.com/macmaker16/Michaelangelo.git
cd Michaelangelo
npm install
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build              # Build main + renderer
npm run package            # Build + create portable exe
```

### Build Installer + Portable
```bash
npx electron-builder --win nsis portable
```

Output: `release/Michaelangelo-1.0.0-x64.exe` (installer) and `Michaelangelo-1.0.0-portable.exe`

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Michaelangelo (Electron)                 │
├─────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ │
│  │  Chat   │ │ Models  │ │Dashboard │ │ Settings│ │
│  │  View   │ │ Manager │ │  (Live)  │ │  View   │ │
│  └────┬────┘ └────┬────┘ └────┬─────┘ └────┬────┘ │
│       └───────────┼──────────┼─────────────┘       │
│                   ▼          ▼                      │
│  ┌────────────────────────────────────────────────┐ │
│  │           Express Proxy Server                 │ │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │ │
│  │  │  Agent   │ │  Plugin   │ │  Slash Cmds  │  │ │
│  │  │ Orchestr.│ │ Registry  │ │   Handler    │  │ │
│  │  └──────────┘ └───────────┘ └──────────────┘  │ │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │ │
│  │  │ Browser  │ │  Memory   │ │  Token       │  │ │
│  │  │ Manager  │ │  Store    │ │  Tracker     │  │ │
│  │  └──────────┘ └───────────┘ └──────────────┘  │ │
│  └────────────────────────────────────────────────┘ │
│                   │ WebSocket (events)               │
│                   ▼                                 │
│  ┌────────────────────────────────────────────────┐ │
│  │         WebSocket Dashboard (Live)             │ │
│  └────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────┐   ┌──────────────┐  ┌──────────┐
│ NVIDIA   │   │  OpenRouter  │  │  Ollama  │
│ NIM      │   │  (200+ mods) │  │ (Local)  │
│ (Free)   │   │              │  │          │
└──────────┘   └──────────────┘  └──────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Electron 28** | Desktop application framework |
| **React 18** | UI component library |
| **TypeScript 5** | Type-safe JavaScript |
| **Tailwind CSS 3** | Utility-first CSS with dark/light themes |
| **Express 4** | Internal HTTP/WebSocket proxy server |
| **WebSocket (ws)** | Real-time dashboard event streaming |
| **Playwright** | Headless browser automation |
| **electron-store** | Persistent local storage (API keys, plugins, settings) |
| **Vite 5** | Frontend build tool |
| **electron-builder** | Windows packaging (NSIS + Portable) |
| **Lucide React** | Icon library |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List all available models |
| `POST` | `/api/chat/completions` | Send chat with agent tool execution |
| `GET` | `/api/conversations` | List saved conversations |
| `GET` | `/api/stats` | Token usage and cost stats |
| `GET` | `/api/skills` | List built-in skills |
| `GET` | `/api/plugins` | List marketplace plugins |
| `POST` | `/api/plugins/install` | Install a plugin |
| `GET` | `/api/settings/status` | Check configured API keys |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode (hot reload) |
| `npm run build` | Build main + renderer for production |
| `npm run start` | Run the built app |
| `npm run package` | Build + package as portable exe |

---

## License

MIT

---

## Credits

- **[Freebuff](https://github.com/CodebuffAI/freebuff)** — Original AI coding agent that inspired this project
- **[OpenRouter](https://openrouter.ai)** — Unified API for 200+ AI models
- **[NVIDIA NIM](https://build.nvidia.com)** — Free tier for NVIDIA AI models
- **[Ollama](https://ollama.com)** — Run AI models locally
- **[Playwright](https://playwright.dev)** — Browser automation
- **[Claude Code](https://claude.ai)** — Inspiration for agent skills and architecture
- **[Aider](https://github.com/paul-gauthier/aider)** — Inspiration for repo map and diff editing
