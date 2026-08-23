/**
 * Michaelangelo Agent - Multi-Model Router
 *
 * Routes tool calls to the appropriate model tier:
 *   - Orchestrator (fast/cheap): handles simple tools like search, read,
 *     run_command, list, etc.
 *   - Coder (heavy frontier): handles complex refactoring, multi-file edits,
 *     and difficult code generation via the `delegate_complex_code` tool.
 *
 * Flow:
 *  1. All requests start on the Orchestrator model
 *  2. Orchestrator can call `delegate_complex_code` to offload to a
 *     heavier model
 *  3. The Coder model gets the exact files needed, generates the solution,
 *     and returns it to the Orchestrator
 *  4. If no Coder model is configured, Orchestrator handles everything
 *
 * This saves cost by keeping routine operations on cheap models while
 * reserving expensive frontier models for genuinely hard tasks.
 */

import { ChatMessage, ToolResult } from './types';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelTier {
  /** Provider key (e.g., 'groq', 'nvidia_nim', 'openai') */
  provider: string;
  /** Model ID */
  model: string;
}

export interface MultiModelConfig {
  /** Fast, cheap model for orchestration and simple tools */
  orchestrator: ModelTier;
  /** Heavy frontier model for complex code generation (optional) */
  coder?: ModelTier;
  /** API key retrieval function */
  getApiKey: (provider: string) => string;
  /** Base URL retrieval function */
  getBaseUrl: (provider: string) => string;
  /** Auth prefix retrieval function */
  getAuthPrefix: (provider: string) => string;
}

export interface DelegationRequest {
  task: string;
  files: { path: string; content: string }[];
  language?: string;
  constraints?: string;
}

export interface DelegationResult {
  success: boolean;
  code: string;
  explanation: string;
  filesChanged: { path: string; content: string }[];
  error?: string;
}

// ============================================================================
// ROUTER
// ============================================================================

export class MultiModelRouter {
  private config: MultiModelConfig;
  private delegationHistory: {
    timestamp: number;
    task: string;
    success: boolean;
    tokensSaved: number;
  }[] = [];

  constructor(config: MultiModelConfig) {
    this.config = config;
  }

  /**
   * Get the tool definition for delegate_complex_code.
   * This tool is injected into the Orchestrator's tool pool.
   */
  getDelegateToolDefinition(): any {
    return {
      type: 'function',
      function: {
        name: 'delegate_complex_code',
        description:
          'Delegate complex code generation to a more capable frontier model. ' +
          'Use this for: multi-file refactors, complex algorithms, tricky bug fixes, ' +
          'or any task that needs higher reasoning. Provide the relevant files and a clear task.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Detailed description of the coding task to delegate',
            },
            files: {
              type: 'string',
              description:
                'Comma-separated list of file paths relevant to this task. ' +
                'The coder will receive the full contents of these files.',
            },
            language: {
              type: 'string',
              description: 'Programming language (e.g., "typescript", "python")',
            },
            constraints: {
              type: 'string',
              description:
                'Any constraints or requirements (e.g., "must not change the API signature")',
            },
          },
          required: ['task'],
        },
      },
    };
  }

  /**
   * Execute a delegation to the Coder model.
   * Reads the specified files, packages them into a prompt,
   * sends to the heavy model, and returns the result.
   */
  async delegateComplexCode(
    request: DelegationRequest,
    tools: Map<string, any>,
  ): Promise<DelegationResult> {
    if (!this.config.coder) {
      return {
        success: false,
        code: '',
        explanation: 'No Coder model configured. Add a Coder model in Settings.',
        filesChanged: [],
        error: 'No Coder model configured',
      };
    }

    const { provider: coderProvider, model: coderModel } = this.config.coder;
    const apiKey = this.config.getApiKey(coderProvider);
    const baseUrl = this.config.getBaseUrl(coderProvider);
    const authPrefix = this.config.getAuthPrefix(coderProvider);

    if (!apiKey) {
      return {
        success: false,
        code: '',
        explanation: `No API key for Coder provider: ${coderProvider}`,
        filesChanged: [],
        error: `No API key for ${coderProvider}`,
      };
    }

    // Read file contents if not already provided
    const fileContents: { path: string; content: string }[] = [];
    if (request.files && request.files.length > 0) {
      for (const file of request.files) {
        if (file.content) {
          fileContents.push(file);
        } else {
          // Read from the filesystem tool
          const readTool = tools.get('read_file');
          if (readTool) {
            const result = await readTool.execute(
              { file_path: file.path },
              {} as any,
            );
            if (result.success) {
              fileContents.push({ path: file.path, content: result.output });
            }
          }
        }
      }
    }

    // Build the prompt for the Coder model
    const fileContext = fileContents
      .map((f) => `--- FILE: ${f.path} ---\n${f.content}\n--- END FILE: ${f.path} ---`)
      .join('\n\n');

    const coderPrompt = [
      {
        role: 'system',
        content:
          `You are an expert software engineer. Generate clean, production-quality code.\n` +
          `Language: ${request.language || 'auto-detect from context'}\n` +
          (request.constraints ? `Constraints: ${request.constraints}\n` : '') +
          `\nReturn your response as a JSON object with this exact structure:\n` +
          '{\n' +
          '  "explanation": "Brief explanation of what you did and why",\n' +
          '  "files": [\n' +
          '    { "path": "relative/file/path", "content": "full file content" }\n' +
          '  ]\n' +
          '}\n' +
          'Return ONLY the JSON object. No markdown, no code fences.',
      },
      {
        role: 'user',
        content:
          `Task: ${request.task}\n\n` +
          (fileContents.length > 0 ? `Relevant Files:\n\n${fileContext}\n\n` : '') +
          `Generate the code. Return ONLY valid JSON.`,
      },
    ];

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${authPrefix}${apiKey}`,
        },
        body: JSON.stringify({
          model: coderModel,
          messages: coderPrompt,
          max_tokens: 8192,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Coder API ${response.status}: ${errBody}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';

      // Parse the JSON response
      let parsed: any;
      try {
        // Try to extract JSON from the response (may have markdown fences)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch {
        // If parsing fails, treat the whole response as code
        parsed = {
          explanation: 'Generated code (raw response)',
          files: [{ path: 'generated.ts', content }],
        };
      }

      const duration = Date.now() - startTime;
      this.delegationHistory.push({
        timestamp: Date.now(),
        task: request.task.substring(0, 100),
        success: true,
        tokensSaved: 0, // We don't know exact token counts but we saved orchestrator tokens
      });

      console.log(
        `[MultiModelRouter] Coder delegation completed in ${duration}ms (${coderModel})`,
      );

      return {
        success: true,
        code: JSON.stringify(parsed.files || []),
        explanation: parsed.explanation || 'Code generated',
        filesChanged: parsed.files || [],
      };
    } catch (err: any) {
      this.delegationHistory.push({
        timestamp: Date.now(),
        task: request.task.substring(0, 100),
        success: false,
        tokensSaved: 0,
      });

      console.error(`[MultiModelRouter] Coder delegation failed:`, err.message);
      return {
        success: false,
        code: '',
        explanation: `Coder model failed: ${err.message}`,
        filesChanged: [],
        error: err.message,
      };
    }
  }

  /**
   * Get the Orchestrator model config.
   */
  getOrchestratorConfig(): ModelTier {
    return this.config.orchestrator;
  }

  /**
   * Get the Coder model config.
   */
  getCoderConfig(): ModelTier | undefined {
    return this.config.coder;
  }

  /**
   * Update the Coder model at runtime.
   */
  setCoderModel(coder: ModelTier | undefined): void {
    this.config.coder = coder;
    console.log(`[MultiModelRouter] Coder model set to: ${coder ? `${coder.provider}/${coder.model}` : 'none'}`);
  }

  /**
   * Update the Orchestrator model at runtime.
   */
  setOrchestratorModel(orchestrator: ModelTier): void {
    this.config.orchestrator = orchestrator;
    console.log(`[MultiModelRouter] Orchestrator set to: ${orchestrator.provider}/${orchestrator.model}`);
  }

  /**
   * Get delegation statistics.
   */
  getStats(): {
    totalDelegations: number;
    successful: number;
    failed: number;
    avgDuration: number;
  } {
    const total = this.delegationHistory.length;
    const successful = this.delegationHistory.filter((h) => h.success).length;
    return {
      totalDelegations: total,
      successful,
      failed: total - successful,
      avgDuration: 0, // Would need to store duration to compute this
    };
  }
}
