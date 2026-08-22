# FreebuffCC

A standalone Windows desktop application for interacting with AI models through OpenRouter and NVIDIA NIM APIs. Built with Electron, React, TypeScript, and an internal Express proxy server.

![Electron](https://img.shields.io/badge/Electron-28-47848f)
![React](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06b6d4)
![Express](https://img.shields.io/badge/Express-4-000000)

---

## Overview

FreebuffCC is a local desktop client that acts as a secure proxy between you and AI model providers. Instead of sending API keys directly from a browser, all requests route through a lightweight Express server running inside the Electron app.

**Key benefits:**
- Your API keys never leave your machine
- No CORS issues — the Express proxy handles all external requests
- Clean, modern UI with model browsing, testing, and chat
- Single portable `.exe` — no installation required

---

## Features

### Settings
- Securely input and store OpenRouter and NVIDIA NIM API keys
- Keys are persisted locally using `electron-store`
- Visual status indicators show which providers are configured

### Model Manager
- Automatically fetches available models from OpenRouter (200+ models)
- Curated list of popular NVIDIA NIM models (Nemotron, Llama, Mistral, etc.)
- Models grouped by provider with search/filter
- **Test button** — sends a quick "Hello world" prompt to verify the model and API key work
- **Select button** — sets a model as active for chat

### Chat
- Displays the active model and provider at the top
- Sends messages through the internal Express proxy
- Supports streaming responses (SSE)
- Markdown-friendly text rendering
- Conversation history within the session

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   FreebuffCC (Electron)               │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Model   │  │   Chat   │  │ Settings │          │
│  │ Manager  │  │   View   │  │   View   │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │                  │
│       └─────────────┼─────────────┘                  │
│                     │ fetch()                        │
│       ┌─────────────▼─────────────┐                  │
│       │   Express Proxy Server    │                  │
│       │   (dynamic port, 127.0.0.1)│                 │
│       └─────────────┬─────────────┘                  │
│                     │                                │
│       ┌─────────────┴─────────────┐                  │
│       │      electron-store       │                  │
│       │    (API key persistence)  │                  │
└───────┼───────────────────────────┼──────────────────┘
        │                           │
        ▼                           ▼
┌───────────────┐       ┌───────────────────┐
│  OpenRouter   │       │    NVIDIA NIM     │
│  (200+ models)│       │  (12 free models) │
└───────────────┘       └───────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Electron 28** | Desktop application framework |
| **React 18** | UI component library |
| **TypeScript 5** | Type-safe JavaScript |
| **Tailwind CSS 3** | Utility-first CSS styling |
| **Express 4** | Internal HTTP proxy server |
| **electron-store** | Persistent local storage for API keys |
| **Vite 5** | Frontend build tool |
| **electron-builder** | Windows packaging |
| **Lucide React** | Icon library |

---

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later (or yarn/pnpm)
- **Windows** 10/11 (for building the `.exe`)

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/macmaker16/FreebuffCC-v3.git
cd FreebuffCC-v3
npm install
```

### 2. Development Mode

```bash
npm run dev
```

This starts:
- Vite dev server on `http://localhost:5173` (with hot reload)
- Electron app with DevTools enabled
- Express proxy on a dynamic port

### 3. Build for Production

```bash
npm run build
```

### 4. Package as Portable Executable

```bash
npm run package
```

Output: `release/FreebuffCC.exe` (~70 MB, no installation needed)

---

## Usage Guide

### Step 1: Configure API Keys

1. Open FreebuffCC
2. Go to the **Settings** tab
3. Enter your API key(s):
   - **OpenRouter**: Get a free key at [openrouter.ai/keys](https://openrouter.ai/keys)
   - **NVIDIA NIM**: Get a free key at [build.nvidia.com](https://build.nvidia.com) (1000 free credits/month)
4. Click **Save Settings**

### Step 2: Browse & Test Models

1. Go to the **Models** tab
2. Click **Refresh** to fetch available models
3. Browse models grouped by provider
4. Click **Test** on any model to verify it works
5. Click **Select** to set it as your active model

### Step 3: Chat

1. Go to the **Chat** tab
2. The active model is shown at the top
3. Type your message and press **Enter**
4. The response streams in from the provider through the Express proxy

---

## Project Structure

```
FreebuffCC-v3/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── main.ts                    # App entry, window, IPC, server lifecycle
│   │   ├── preload.ts                 # Secure context bridge
│   │   └── server.ts                  # Express proxy (OpenRouter + NIM)
│   └── renderer/                      # React frontend
│       ├── index.html                 # HTML entry
│       └── src/
│           ├── main.tsx               # React entry
│           ├── App.tsx                # Root component + sidebar nav
│           ├── components/
│           │   ├── ModelManager.tsx    # Model list with test/select
│           │   ├── ChatView.tsx        # Chat interface
│           │   └── SettingsView.tsx    # API key configuration
│           ├── services/
│           │   └── api.ts             # Fetch wrapper for Express proxy
│           ├── types/
│           │   ├── index.ts           # Shared TypeScript types
│           │   └── electron.d.ts      # Window.electronAPI types
│           └── styles/
│               └── globals.css        # Tailwind + custom animations
├── assets/                            # App icons
├── package.json                       # Dependencies & build config
├── tsconfig.main.json                 # TypeScript config (main process)
├── tsconfig.json                      # TypeScript config (renderer)
├── vite.config.ts                     # Vite bundler config
├── tailwind.config.js                 # Tailwind theme
├── postcss.config.js                  # PostCSS config
└── README.md                          # This file
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode (hot reload) |
| `npm run build` | Build main process + renderer for production |
| `npm run start` | Run the built app |
| `npm run package` | Build + package as portable Windows `.exe` |

---

## How the Proxy Works

1. **Startup**: Electron launches Express on a dynamic port (e.g., `3040`)
2. **Settings**: API keys are saved to `electron-store` via IPC
3. **Model Fetch**: Frontend calls `GET /api/models` → Express fetches from OpenRouter API
4. **Chat**: Frontend calls `POST /api/chat/completions` → Express routes to the correct provider based on model ID
5. **Provider Detection**: Model IDs starting with `nvidia/`, `meta/`, `mistralai/`, etc. go to NVIDIA NIM; everything else goes to OpenRouter
6. **Shutdown**: When the app closes, Express server is gracefully stopped

---

## API Endpoints (Internal)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List available models from configured providers |
| `POST` | `/api/chat/completions` | Proxy chat request to OpenRouter or NIM |
| `POST` | `/api/test-model` | Quick test of a model with "Hello world" |
| `GET` | `/api/settings/status` | Check which API keys are configured |

---

## Troubleshooting

### "No API key configured" error
Go to Settings and add your API key for the provider you're trying to use.

### Models list is empty
1. Ensure you've added at least one API key in Settings
2. Click Refresh in the Models tab
3. Check that your API key is valid at the provider's website

### Chat not responding
1. Verify the model was selected (check the Chat header)
2. Check if the API key is still valid
3. Try the Test button on the model in the Models tab

### App won't start
1. Ensure Node.js 18+ is installed: `node --version`
2. Reinstall dependencies: `rm -rf node_modules && npm install`
3. Rebuild: `npm run build && npm run package`

---

## License

MIT

---

## Credits

- **[Freebuff](https://github.com/CodebuffAI/freebuff)** — Original AI coding agent that inspired this project
- **[OpenRouter](https://openrouter.ai)** — Unified API for 200+ AI models
- **[NVIDIA NIM](https://build.nvidia.com)** — Free tier for NVIDIA AI models
- **[Electron](https://www.electronjs.org)** — Cross-platform desktop framework
- **[React](https://react.dev)** — UI library
- **[Tailwind CSS](https://tailwindcss.com)** — Utility-first CSS
