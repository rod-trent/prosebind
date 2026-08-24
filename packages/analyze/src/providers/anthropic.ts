import Anthropic from '@anthropic-ai/sdk';
import type { GenerateRequest, GenerateResponse, LanguageModel } from '@prosebind/extract';
import { ModelUnavailableError } from '@prosebind/extract';

/**
 * Frontier analysis through the Anthropic API.
 *
 * `location` is `cloud`, and that is the whole point of the field: `assertPermitted`
 * refuses this model unless the writer has explicitly allowed their manuscript to leave
 * the machine, and announces the call when they have. Tier 2 is the only tier where
 * that question arises (DESIGN.md § 7).
 *
 * **Unverified.** This code has never been run — there were no Anthropic credentials in
 * the environment it was written in. It follows the documented SDK contract, but the
 * first person to run it should expect to fix something, and should not assume the
 * absence of a bug report means the absence of bugs.
 */
export interface AnthropicOptions {
  /** Defaults to the current flagship. */
  model?: string;
  /** Passed through to the SDK; omit to use ANTHROPIC_API_KEY or an `ant auth` profile. */
  apiKey?: string;
  maxTokens?: number;
  /** `low` | `medium` | `high` | `xhigh` | `max`. Narrative judgment warrants `high`. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

const DEFAULT_MODEL = 'claude-opus-5';

export class AnthropicModel implements LanguageModel {
  readonly location = 'cloud' as const;
  private readonly client: Anthropic;
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly effort: NonNullable<AnthropicOptions['effort']>;

  constructor(options: AnthropicOptions = {}) {
    this.modelId = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? 4000;
    this.effort = options.effort ?? 'high';
    // A bare constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
    // `ant auth login` profile — an unset env var does not mean no credentials.
    this.client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
  }

  get id(): string {
    return `anthropic:${this.modelId}`;
  }

  get describe(): string {
    return `${this.modelId} via the Anthropic API — your manuscript text is sent to Anthropic`;
  }

  async available(): Promise<boolean> {
    try {
      await this.client.models.retrieve(this.modelId);
      return true;
    } catch {
      return false;
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const started = performance.now();

    try {
      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: this.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        // Narrative judgment is exactly the "remotely complicated" case adaptive
        // thinking exists for.
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        messages: [{ role: 'user', content: request.prompt }],
      });

      // Structured outputs would be stricter, but the documented path needs a Zod
      // schema and this interface carries raw JSON Schema for Ollama's sake. The
      // response goes through the same tolerant parser the local path requires, so
      // there is one parsing path rather than two.
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      // A safety decline is a valid response, not an exception. Reading `content`
      // without checking would silently treat a refusal as an empty analysis.
      if (response.stop_reason === 'refusal') {
        throw new ModelUnavailableError(
          this.id,
          `${this.modelId} declined to analyse this passage` +
            (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'),
        );
      }

      return { text, durationMs: performance.now() - started, model: this.id };
    } catch (error) {
      if (error instanceof ModelUnavailableError) throw error;

      // Typed classes, most specific first — never string-match an error message.
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ModelUnavailableError(
          this.id,
          'Anthropic rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`. ' +
            'Tiers 0 and 1 keep working without any of this.',
        );
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ModelUnavailableError(this.id, 'Rate limited by the Anthropic API; try again shortly.');
      }
      if (error instanceof Anthropic.APIError) {
        throw new ModelUnavailableError(this.id, `Anthropic API error ${error.status}: ${error.message}`);
      }
      throw new ModelUnavailableError(this.id, (error as Error).message);
    }
  }
}
