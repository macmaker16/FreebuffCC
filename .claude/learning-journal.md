# Codebase Learning Journal

> This journal tracks your understanding of the codebase. Buffy updates it 
> during learning sessions to maintain continuity across conversations.

## Focus & Goals

- **Primary goal**: Contributing features to the Michaelangelo agent
- **Interested in**: The agentic loop — how the LLM orchestrates tools, plans, and executes
- **Background**: New to Electron, Express, and TypeScript — learning as we go
- **Learning style**: Prefers tracing real execution flows over abstract explanations

## Concept Mastery Map

### 🟢 Confident

### 🟢 Confident
- Agentic loop flow — iteration pattern and tool call cycle
- Text-based tool call parsing — NIM Llama outputs tool calls as text, not structured
- JSON repair technique — counting braces/brackets to fix truncated output
- Tool execution pipeline — executeTool routes to handlers via switch statement
- Security: isPathSafe resolves paths then checks containment, BLOCKED_COMMANDS prevents destructive ops
- Three-destination pattern: tool output goes to LLM context, frontend SSE, AND persistence simultaneously
- edit_file returns { output, diff } — diff feeds the DiffViewer, errors guide LLM retry
- run_command: blocklist + timeout (60s) + buffer limit (1MB) + output truncation (10K chars)

### 🟡 Learning
- SSE streaming — how events flow from server generator to React frontend
- The error-as-instruction pattern — errors are written to guide the LLM's next action

### 🔴 Need to Explore
- Electron app lifecycle (main vs renderer process)
- Express server routing and middleware
- React component lifecycle and hooks
- The Orchestrator class (full agent system vs simple agentic loop)
- Context compression and rehydration

## Concept Mastery Map

### 🟢 Confident
<!-- Concepts you can explain to others and apply in new situations -->

### 🟡 Learning  
<!-- Partial understanding, making connections, have active questions -->

### 🔴 Need to Explore
<!-- Cannot explain or apply yet, need guided exploration -->

## Open Questions

- [x] Why does parseToolCallsFromText silently drop malformed JSON instead of sending an error back to the LLM? **Answer**: Fixed — now attempts JSON repair first, then logs warnings. Could further improve by sending error back to LLM.
- [ ] What happens to the conversation when the agent exits early due to no tool calls?
- [x] How does the text parser handle multiple tool calls in a single response? **Answer**: The regex finds all matches in the content string, each becomes a separate tool call.

## Spaced Review Queue

<!-- Concepts scheduled for review based on spaced repetition -->

## Aha Moments

### 2026-08-23: JSON repair is just brace counting
The simplest way to fix truncated JSON is to count opening vs closing braces and add the missing ones. Close strings first (add `"`), then arrays (`]`), then objects (`}`). It's not perfect but handles the most common truncation pattern from LLMs.

### 2026-08-23: Three-destination pattern is the key to agent feedback
Every tool output goes three places simultaneously: back to the LLM (so it learns), to the frontend (so the user sees), and to persistence (so nothing is lost). This is what makes the agent feel responsive and reliable.

## Session Log

### 2026-08-23
- **Explored**: Agentic loop architecture, SSE streaming pipeline, text-based tool call parsing
- **Learned**: Frontend → Express → LLM flow, async generator pattern, NIM Llama text output quirk
- **Struggled with**: Understanding why tool calls are dropped silently

### 2026-08-23 (Session 2)
- **Explored**: Tool execution pipeline — executeTool → handlers → three-destination pattern
- **Learned**: isPathSafe security, BLOCKED_COMMANDS, edit_file error-as-instruction pattern, run_command safety layers
- **Struggled with**: Nothing — concepts were clear
- **Next**: Understand the Orchestrator class (full agent vs simple loop), context compression

---

## Quick Reference

### Mastery Levels

| Level | Meaning | Indicator |
|-------|---------|-----------|
| 🔴 Confused | Cannot explain or apply | Need exploration |
| 🟡 Learning | Partial understanding | Making connections |
| 🟢 Confident | Can explain & apply | Ready to teach others |

### Review Schedule (Spaced Repetition)

| Review # | Wait Time | After Success |
|----------|-----------|---------------|
| 1st | 1 day | Schedule 2nd |
| 2nd | 3 days | Schedule 3rd |
| 3rd | 1 week | Schedule 4th |
| 4th | 2 weeks | Schedule 5th |
| 5th+ | Consider 🟢 Confident | Long-term memory |

### How to Use This Journal

1. **Start sessions** by reviewing Focus & Goals and Open Questions
2. **During learning** let Buffy update mastery levels and add questions
3. **Capture insights** in Aha Moments using your own words
4. **Check review queue** at session start for spaced repetition
5. **Keep it honest** — 🟡 is fine! Moving to 🟢 too fast defeats the purpose
