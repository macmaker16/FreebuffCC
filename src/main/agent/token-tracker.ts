/**
 * Michaelangelo - Token & Cost Tracker
 *
 * Tracks token usage across conversations and estimates costs
 * per provider/model combination.
 */

// ============================================================================
// MODEL PRICING (USD per 1M tokens)
// ============================================================================

interface ModelPricing {
  provider: string;
  modelPattern: RegExp;
  inputPrice: number;  // per 1M tokens
  outputPrice: number; // per 1M tokens
}

const PRICING_TABLE: ModelPricing[] = [
  // OpenRouter
  { provider: 'openrouter', modelPattern: /claude-sonnet-4/i, inputPrice: 3.0, outputPrice: 15.0 },
  { provider: 'openrouter', modelPattern: /claude-3\.5-sonnet/i, inputPrice: 3.0, outputPrice: 15.0 },
  { provider: 'openrouter', modelPattern: /claude-3\.5-haiku/i, inputPrice: 0.8, outputPrice: 4.0 },
  { provider: 'openrouter', modelPattern: /claude-3-opus/i, inputPrice: 15.0, outputPrice: 75.0 },
  { provider: 'openrouter', modelPattern: /gpt-4o/i, inputPrice: 2.5, outputPrice: 10.0 },
  { provider: 'openrouter', modelPattern: /gpt-4-turbo/i, inputPrice: 10.0, outputPrice: 30.0 },
  { provider: 'openrouter', modelPattern: /llama-3\.1-70b/i, inputPrice: 0.52, outputPrice: 0.75 },
  { provider: 'openrouter', modelPattern: /llama-3\.1-8b/i, inputPrice: 0.05, outputPrice: 0.1 },
  { provider: 'openrouter', modelPattern: /gemini-2\.5-pro/i, inputPrice: 1.25, outputPrice: 10.0 },
  { provider: 'openrouter', modelPattern: /gemini-2\.5-flash/i, inputPrice: 0.15, outputPrice: 0.6 },

  // NVIDIA NIM (free tier)
  { provider: 'nvidia_nim', modelPattern: /.*/, inputPrice: 0, outputPrice: 0 },

  // OpenAI
  { provider: 'openai', modelPattern: /gpt-4o/i, inputPrice: 2.5, outputPrice: 10.0 },
  { provider: 'openai', modelPattern: /gpt-4-turbo/i, inputPrice: 10.0, outputPrice: 30.0 },
  { provider: 'openai', modelPattern: /gpt-4/i, inputPrice: 30.0, outputPrice: 60.0 },
  { provider: 'openai', modelPattern: /o1/i, inputPrice: 15.0, outputPrice: 60.0 },
  { provider: 'openai', modelPattern: /o3/i, inputPrice: 10.0, outputPrice: 40.0 },

  // Anthropic
  { provider: 'anthropic', modelPattern: /claude-sonnet-4/i, inputPrice: 3.0, outputPrice: 15.0 },
  { provider: 'anthropic', modelPattern: /claude-3\.5-sonnet/i, inputPrice: 3.0, outputPrice: 15.0 },
  { provider: 'anthropic', modelPattern: /claude-3-opus/i, inputPrice: 15.0, outputPrice: 75.0 },
  { provider: 'anthropic', modelPattern: /claude-3-haiku/i, inputPrice: 0.25, outputPrice: 1.25 },

  // Groq (very cheap)
  { provider: 'groq', modelPattern: /llama.*70b/i, inputPrice: 0.59, outputPrice: 0.79 },
  { provider: 'groq', modelPattern: /llama.*8b/i, inputPrice: 0.05, outputPrice: 0.08 },
  { provider: 'groq', modelPattern: /mixtral/i, inputPrice: 0.24, outputPrice: 0.24 },

  // DeepSeek
  { provider: 'deepseek', modelPattern: /.*/, inputPrice: 0.14, outputPrice: 0.28 },

  // Mistral
  { provider: 'mistral', modelPattern: /mistral-large/i, inputPrice: 2.0, outputPrice: 6.0 },
  { provider: 'mistral', modelPattern: /mistral-medium/i, inputPrice: 2.7, outputPrice: 8.1 },
  { provider: 'mistral', modelPattern: /codestral/i, inputPrice: 0.3, outputPrice: 0.9 },

  // Gemini
  { provider: 'gemini', modelPattern: /gemini-2\.5-pro/i, inputPrice: 1.25, outputPrice: 10.0 },
  { provider: 'gemini', modelPattern: /gemini-2\.5-flash/i, inputPrice: 0.15, outputPrice: 0.6 },
  { provider: 'gemini', modelPattern: /gemini-1\.5-pro/i, inputPrice: 1.25, outputPrice: 5.0 },
  { provider: 'gemini', modelPattern: /gemini-1\.5-flash/i, inputPrice: 0.075, outputPrice: 0.3 },

  // Together
  { provider: 'together', modelPattern: /llama.*70b/i, inputPrice: 0.88, outputPrice: 0.88 },
  { provider: 'together', modelPattern: /llama.*8b/i, inputPrice: 0.1, outputPrice: 0.1 },

  // Local LLM (free)
  { provider: 'local_llm', modelPattern: /.*/, inputPrice: 0, outputPrice: 0 },
];

// ============================================================================
// TRACKER
// ============================================================================

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  model: string;
  provider: string;
  timestamp: number;
}

export class TokenTracker {
  private usageLog: TokenUsage[] = [];

  /** Calculate cost for a specific model/provider */
  calculateCost(
    promptTokens: number,
    completionTokens: number,
    model: string,
    provider: string,
  ): number {
    // Find matching pricing
    const pricing = PRICING_TABLE.find(p =>
      p.provider === provider && p.modelPattern.test(model)
    );

    if (!pricing) return 0;

    return (
      (promptTokens / 1_000_000) * pricing.inputPrice +
      (completionTokens / 1_000_000) * pricing.outputPrice
    );
  }

  /** Record a token usage event */
  record(
    promptTokens: number,
    completionTokens: number,
    model: string,
    provider: string,
  ): TokenUsage {
    const cost = this.calculateCost(promptTokens, completionTokens, model, provider);
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: cost,
      model,
      provider,
      timestamp: Date.now(),
    };
    this.usageLog.push(usage);
    return usage;
  }

  /** Get total usage across all records */
  getTotal(): { tokens: number; cost: number; requests: number } {
    return this.usageLog.reduce(
      (acc, u) => ({
        tokens: acc.tokens + u.totalTokens,
        cost: acc.cost + u.estimatedCost,
        requests: acc.requests + 1,
      }),
      { tokens: 0, cost: 0, requests: 0 },
    );
  }

  /** Get usage breakdown by model */
  getByModel(): Map<string, { tokens: number; cost: number; requests: number }> {
    const byModel = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const u of this.usageLog) {
      const key = `${u.provider}/${u.model}`;
      const existing = byModel.get(key) || { tokens: 0, cost: 0, requests: 0 };
      existing.tokens += u.totalTokens;
      existing.cost += u.estimatedCost;
      existing.requests += 1;
      byModel.set(key, existing);
    }
    return byModel;
  }

  /** Get usage for a specific time window */
  getWindow(minutes: number): TokenUsage[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.usageLog.filter(u => u.timestamp >= cutoff);
  }

  /** Clear usage log */
  clear(): void {
    this.usageLog = [];
  }

  /** Format cost as readable string */
  formatCost(cost: number): string {
    if (cost === 0) return 'Free';
    if (cost < 0.01) return `<$0.01`;
    return `$${cost.toFixed(4)}`;
  }

  /** Format tokens as readable string */
  formatTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
}
