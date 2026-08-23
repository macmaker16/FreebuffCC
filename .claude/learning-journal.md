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

### 🟡 Learning
- Agentic loop flow — understand the iteration pattern and tool call cycle
- Text-based tool call parsing — NIM Llama outputs tool calls as text, not structured
- SSE streaming — how events flow from server generator to React frontend

### 🔴 Need to Explore
- Electron app lifecycle (main vs renderer process)
- Express server routing and middleware
- TypeScript type system and interfaces
- React component lifecycle and hooks
- The agentic loop architecture
- Tool registration and execution pipeline
- SSE streaming from server to client

## Concept Mastery Map

### 🟢 Confident
<!-- Concepts you can explain to others and apply in new situations -->

### 🟡 Learning  
<!-- Partial understanding, making connections, have active questions -->

### 🔴 Need to Explore
<!-- Cannot explain or apply yet, need guided exploration -->

## Open Questions

- [ ] Why does parseToolCallsFromText silently drop malformed JSON instead of sending an error back to the LLM?
- [ ] What happens to the conversation when the agent exits early due to no tool calls?
- [ ] How does the text parser handle multiple tool calls in a single response?

## Spaced Review Queue

<!-- Concepts scheduled for review based on spaced repetition -->

## Aha Moments

<!-- Insights captured in your own words—these cement understanding -->

## Session Log

### 2026-08-23
- **Explored**: Agentic loop architecture, SSE streaming pipeline, text-based tool call parsing
- **Learned**: Frontend → Express → LLM flow, async generator pattern, NIM Llama text output quirk
- **Struggled with**: Understanding why tool calls are dropped silently
- **Next**: Trace the tool execution pipeline (executeTool → executeWriteFile etc.), understand the diff engine

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
