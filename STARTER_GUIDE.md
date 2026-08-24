# Michaelangelo — Starter Guide

**A complete walkthrough for first-time users.** This guide will take you from zero to building your first project with AI in under 5 minutes.

---

## Table of Contents

1. [Download & Install](#1-download--install)
2. [First Launch](#2-first-launch)
3. [Get a Free API Key](#3-get-a-free-api-key)
4. [Select a Model](#4-select-a-model)
5. [Your First Project](#5-your-first-project)
6. [Understanding the Interface](#6-understanding-the-interface)
7. [Using Local Models (Ollama)](#7-using-local-models-ollama)
8. [Tips & Tricks](#8-tips--tricks)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Download & Install

You have two options:

### Option A: Installer (Recommended)
1. Go to [Releases](https://github.com/macmaker16/Michaelangelo/releases/latest)
2. Download `Michaelangelo-1.0.0-x64.exe`
3. Double-click to install — choose your install directory
4. A desktop shortcut will be created

### Option B: Portable (No Installation)
1. Go to [Releases](https://github.com/macmaker16/Michaelangelo/releases/latest)
2. Download `Michaelangelo-1.0.0-portable.exe`
3. Move it to any folder you want (e.g., `D:\Apps\`)
4. Double-click to run — no installation needed

---

## 2. First Launch

When you first open Michaelangelo, you'll see:

- **Left sidebar** — Navigation (Chat, Models, Dashboard, Plugins, Skills, Settings)
- **Main area** — The onboarding guide with 4 steps
- **Chat input** — At the bottom of the Chat view

The app will automatically:
- Start its internal server
- Try to connect to Ollama (if installed locally)
- Show you a step-by-step setup guide

---

## 3. Get a Free API Key

You need at least one API key to use Michaelangelo. Here are your free options:

### NVIDIA NIM (Recommended — Free 1000 Credits/Month)

1. Open your browser and go to **[build.nvidia.com](https://build.nvidia.com)**
2. Click **Sign Up** (or **Log In** if you have an account)
3. Once logged in, click **"Get API Key"** in the top right
4. Copy the key (it looks like `nvapi-xxxxxxxx...`)
5. Back in Michaelangelo, go to **Settings** (bottom of sidebar)
6. Paste the key into the **NVIDIA NIM API Key** field
7. Click **Save Settings**

> ✅ NVIDIA NIM gives you **1000 free credits per month** — enough for hundreds of coding sessions.

### OpenRouter (200+ Models)

1. Go to **[openrouter.ai](https://openrouter.ai)**
2. Click **Sign Up** (or **Log In**)
3. Go to **Keys** in the sidebar
4. Click **Create Key** → give it a name like `michaelangelo`
5. Copy the key
6. In Michaelangelo → **Settings** → paste into **OpenRouter API Key**
7. Click **Save Settings**

### Ollama (100% Free — Local Models)

If you want to run models on your own computer (no internet needed):

1. Download Ollama from **[ollama.com](https://ollama.com)**
2. Install it and open a terminal
3. Run: `ollama pull llama3.1:8b` (downloads a 4.7GB model)
4. Michaelangelo will automatically detect Ollama and show local models

---

## 4. Select a Model

1. Click **Models** in the sidebar
2. The app automatically tests all models — look for **green dots** (online)
3. Click the **checkmark button** on any green model to set it as active
4. The active model name appears in the sidebar footer

### Recommended Free Models

| Model | Provider | Best For |
|-------|----------|----------|
| `nvidia/llama-3.1-8b-instruct` | NVIDIA NIM | Fast coding, general tasks |
| `nvidia/nemotron-mini-4b-instruct` | NVIDIA NIM | Ultra-fast, simple tasks |
| `nvidia/mistral-nemo-12b-instruct` | NVIDIA NIM | Balanced speed/quality |
| `meta-llama/llama-3.1-8b-instruct:free` | OpenRouter | Free alternative |
| `ollama/llama3.1:8b` | Local (Ollama) | Offline, private |

---

## 5. Your First Project

Go to the **Chat** tab and try these examples:

### Example 1: Create a Website
```
Create a modern landing page for a coffee shop called "Bean There".
Include a hero section with a gradient background, a menu section
with 6 items and prices, customer testimonials, and a contact form.
Use HTML, CSS, and JavaScript.
```

### Example 2: Build an API
```
Create a REST API with Node.js and Express that manages a todo list.
Include CRUD operations, input validation, and error handling.
Add a SQLite database for storage.
```

### Example 3: Fix a Bug
```
I have a Python script that reads CSV files but crashes when
the file has empty rows. The file is at src/data_processor.py.
Find the bug and fix it.
```

### Example 4: Full-Stack App
```
Create a full-stack recipe sharing app with:
- React frontend with recipe cards
- Express backend with REST API
- SQLite database
- Search and filter functionality
- Mobile-responsive design
```

### What Happens Behind the Scenes

When you send a message, Michaelangelo:

1. **Plans** — Creates a todo list of steps to complete
2. **Creates files** — Writes actual code files to your working folder
3. **Runs commands** — Installs dependencies, starts servers
4. **Tests** — Takes screenshots, checks for errors
5. **Fixes issues** — If something breaks, it fixes it automatically
6. **Notifies** — Plays a chime when done

---

## 6. Understanding the Interface

### Sidebar Navigation

| Tab | What It Shows |
|-----|---------------|
| **Chat** | Your conversation with the AI agent |
| **Models** | Browse, test, and select AI models |
| **Dashboard** | Live stats, token usage, session history |
| **Plugins** | Browse and install capability extensions |
| **Skills** | Pre-built engineering workflows |
| **Settings** | API keys, local LLM config, preferences |

### Chat View Layout

```
┌──────────────────────────────────────┐
│ Model: nvidia/llama-3.1-8b     [●]  │  ← Active model + status
├──────────────────────────────────────┤
│ 🔧 run_command: npm install         │  ← Tool activity bar
├──────────────────────────────────────┤
│ Tasks                               │  ← Todo checklist
│ ✓ Create project structure          │
│ ⚡ Install dependencies             │
│ ○ Add tests                         │
├──────────────────────────────────────┤
│                                      │
│  👤 "Create a React app..."         │  ← Your messages
│                                      │
│  🤖 "I'll create a React app..."    │  ← Agent responses
│     ```jsx                          │
│     function App() { ... }          │  ← Code blocks
│     ```                             │
│                                      │
├──────────────────────────────────────┤
│ [📁] [Type your message...]  [Send] │  ← Input bar
└──────────────────────────────────────┘
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Switch to Chat view |
| `Ctrl+M` | Switch to Models view |
| `Ctrl+D` | Switch to Dashboard |
| `Ctrl+,` | Switch to Settings |
| `Ctrl+Shift+T` | Toggle dark/light theme |
| `Esc` | Stop the agent |
| `?` | Show all shortcuts |

### Slash Commands

Type these in the chat input:

| Command | What It Does |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear the conversation |
| `/compact` | Compress long conversations |
| `/model` | Switch models without leaving chat |
| `/commit` | Auto-stage and commit code changes |
| `/review` | Review code for bugs and improvements |
| `/test` | Run the project's test suite |
| `/run <code>` | Execute inline code snippets |
| `/audit <url>` | Crawl a website for broken links |
| `/design-landing` | Build a full landing page |
| `/tdd` | Start test-driven development mode |
| `/debug` | Systematic bug diagnosis |
| `/explain <file>` | Line-by-line code explanation |
| `/cost` | Show token usage and costs |

---

## 7. Using Local Models (Ollama)

### Setup

1. **Install Ollama**: Download from [ollama.com](https://ollama.com) and install
2. **Pull a model**: Open terminal and run:
   ```bash
   ollama pull llama3.1:8b          # 4.7GB — good all-rounder
   ollama pull qwen2.5-coder:1.5b   # 1GB — fast, code-focused
   ollama pull codellama:7b          # 4GB — specialized for code
   ```
3. **Configure Michaelangelo**:
   - Go to **Settings** → **Local LLM** section
   - Enter the endpoint: `http://localhost:11434`
   - Click **Test Connection**
4. **Select the model** in the Models tab (look for "Local" section)

### Tips for Local Models
- **Run one model at a time** — Ollama loads models into GPU/RAM
- **Smaller models (1.5B)** are faster but less capable
- **8B models** are the sweet spot for coding tasks
- **No API key needed** — 100% free and private

---

## 8. Tips & Tricks

### Make Better Prompts
- **Be specific**: "Create a React component for a user profile card with avatar, name, email, and bio" instead of "make a component"
- **Specify the tech**: "Use TypeScript", "Use Tailwind CSS", "Use SQLite"
- **Give context**: "My project uses Express 4 and the file is at src/routes/users.js"
- **Ask for tests**: "Write unit tests for the authentication module"

### Use Skills for Complex Tasks
Go to the **Skills** tab and click **Run** on any skill:
- **review-pr** — Reviews staged git changes
- **fix-bugs** — Analyzes and auto-fixes errors
- **test-all** — Runs your full test suite
- **clean-build** — Clean install and rebuild from scratch

### Monitor Your Usage
- **Dashboard tab** — See token usage, cost, and session history in real-time
- `/cost` — Quick cost check in chat
- `/stats` — Detailed usage breakdown

### Customize the Agent
- `/persona` — Set a custom agent personality
- `/config` — Show current configuration
- `/init` — Create a `.michaelangelo.md` project instructions file

### Theme & Appearance
- `Ctrl+Shift+T` — Toggle dark/light mode
- Settings → Preferences — Adjust behavior

---

## 9. Troubleshooting

### "No models online"
- Check that your API key is correct in **Settings**
- Try a different provider (NVIDIA NIM is most reliable)
- Check your internet connection

### "Chat not responding"
- Make sure a model is selected (green checkmark in Models tab)
- Try the **Test** button on the model to verify it works
- Check if you've hit API rate limits (try a different model)

### "Agent stops before finishing all tasks"
- The auto-continue system usually handles this
- Try sending "continue" or "keep going" in chat
- Check if the model is hitting token limits (use `/compact`)

### "Files not being created"
- Make sure you selected a working folder (folder icon in chat input)
- Check the Tool Activity bar — the agent shows what it's doing
- Look at the Dashboard → Activity tab for detailed event logs

### "App won't start"
- Make sure Node.js 18+ is installed: `node --version`
- Reinstall: delete `node_modules` and run `npm install`
- Try the portable version instead of installer

### "Ollama models not showing"
- Make sure Ollama is running: open terminal, run `ollama list`
- Check the Settings → Local LLM endpoint is `http://localhost:11434`
- Restart Michaelangelo after starting Ollama

### "Build fails on packaging"
- Close any running Michaelangelo instances
- Delete the `release/` folder and try again
- If antivirus blocks it, add an exclusion for the project folder

---

## Need Help?

- **GitHub Issues**: [github.com/macmaker16/Michaelangelo/issues](https://github.com/macmaker16/Michaelangelo/issues)
- **GitHub Discussions**: [github.com/macmaker16/Michaelangelo/discussions](https://github.com/macmaker16/Michaelangelo/discussions)

---

## Next Steps

Once you're comfortable with the basics:

1. **Try the Skills tab** — Run `/design-landing` to see the agent build a complete website
2. **Install plugins** — Go to Plugins tab and install GitHub Integration or Docker Manager
3. **Use `/tdd`** — Try test-driven development with the TDD skill
4. **Connect Ollama** — Run models locally for free, offline coding
5. **Set up `/persona`** — Give your agent a custom personality and coding style
6. **Create `.michaelangelo.md`** — Add project-specific instructions that the agent reads automatically

---

*Built with ❤️ by the Michaelangelo community. Inspired by Claude Code, Aider, and Cursor.*
