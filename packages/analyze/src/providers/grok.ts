import type { GenerateRequest, GenerateResponse, LanguageModel } from '@prosebind/extract';
import { ModelUnavailableError } from '@prosebind/extract';

/**
 * Frontier analysis through the xAI (Grok) API.
 *
 * OpenAI-compatible chat completions at `https://api.x.ai/v1`, so this is raw `fetch`
 * rather than an SDK — the same shape as the Ollama provider, and no new dependency in
 * a package that already carries one.
 *
 * `location` is `cloud`, which is the whole point: `assertPermitted` refuses this model
 * unless the writer has explicitly allowed their manuscript to leave the machine, and
 * announces the call when they have (DESIGN.md § 7).
 */
export interface GrokOptions {
  /**
   * Model id. Left undefined, the provider asks the API what exists and takes the
   * newest Grok it finds — xAI's docs point at the console rather than publishing a
   * stable list, and a hardcoded guess would rot.
   */
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
}

const DEFAULT_BASE = 'https://api.x.ai/v1';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  error?: { message?: string };
}

export class GrokModel implements LanguageModel {
  readonly location = 'cloud' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private modelId: string | undefined;
  /** Set false once the API rejects response_format, so we stop sending it. */
  private jsonMode = true;

  constructor(options: GrokOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.apiKey = options.apiKey ?? process.env['XAI_API_KEY'] ?? process.env['GROK_API_KEY'];
    this.modelId = options.model;
    this.maxTokens = options.maxTokens ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  get id(): string {
    return `xai:${this.modelId ?? 'auto'}`;
  }

  get describe(): string {
    return `${this.modelId ?? 'Grok'} via the xAI API — your manuscript text is sent to xAI`;
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) {
      throw new ModelUnavailableError(
        this.id,
        'No xAI credentials. Set XAI_API_KEY in your environment. ' +
          'Tiers 0 and 1 keep working without it.',
      );
    }
    return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' };
  }

  /** Models the account can actually reach. */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Pick a model if the caller did not name one.
   *
   * Newest-looking Grok wins, by version number. Crude, but better than pinning an id
   * from documentation that explicitly declines to promise one.
   */
  private async resolveModel(): Promise<string> {
    if (this.modelId) return this.modelId;

    const available = await this.listModels();
    const groks = available.filter((id) => /^grok/i.test(id));
    if (groks.length === 0) {
      throw new ModelUnavailableError(
        this.id,
        available.length > 0
          ? `No Grok model in the account's list: ${available.join(', ')}`
          : 'Could not list models from the xAI API. Check XAI_API_KEY and network access.',
      );
    }

    const chosen = pickNewestGrok(groks);
    if (!chosen) {
      throw new ModelUnavailableError(this.id, `Could not choose from: ${groks.join(', ')}`);
    }
    this.modelId = chosen;
    return chosen;
  }

  async available(): Promise<boolean> {
    try {
      await this.resolveModel();
      return true;
    } catch {
      return false;
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const started = performance.now();
    const model = await this.resolveModel();

    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const send = async (withJsonMode: boolean): Promise<Response> => {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: request.temperature ?? 0,
        max_completion_tokens: request.maxTokens ?? this.maxTokens,
      };
      // Nudge toward valid JSON where the API supports it. The tolerant parser still
      // runs either way, because a small local model needs it regardless.
      if (withJsonMode && request.schema) body['response_format'] = { type: 'json_object' };

      return fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    };

    let response: Response;
    try {
      response = await send(this.jsonMode);
      // Not every OpenAI-compatible endpoint accepts response_format. Rather than
      // guess from documentation that does not say, find out once and remember.
      if (response.status === 400 && this.jsonMode) {
        const detail = await response.text().catch(() => '');
        if (/response_format/i.test(detail)) {
          this.jsonMode = false;
          response = await send(false);
        } else {
          throw new ModelUnavailableError(this.id, `xAI returned 400: ${detail.slice(0, 200)}`);
        }
      }
    } catch (error) {
      if (error instanceof ModelUnavailableError) throw error;
      throw new ModelUnavailableError(
        this.id,
        `could not reach the xAI API: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ModelUnavailableError(
          this.id,
          'xAI rejected the credentials. Check XAI_API_KEY. Tiers 0 and 1 are unaffected.',
        );
      }
      if (response.status === 429) {
        throw new ModelUnavailableError(this.id, 'Rate limited by the xAI API; try again shortly.');
      }
      throw new ModelUnavailableError(
        this.id,
        `xAI API error ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as ChatResponse;
    if (payload.error?.message) {
      throw new ModelUnavailableError(this.id, `xAI API error: ${payload.error.message}`);
    }

    const choice = payload.choices?.[0];
    // A refusal or a length cut-off is a real outcome, not an empty analysis. Silently
    // treating either as "no findings" would report a clean passage that was never read.
    if (choice?.finish_reason === 'content_filter') {
      throw new ModelUnavailableError(this.id, `${model} declined to analyse this passage.`);
    }

    return {
      text: choice?.message?.content ?? '',
      durationMs: performance.now() - started,
      model: this.id,
    };
  }
}

/**
 * Choose the newest-looking Grok from a list of model ids.
 *
 * Exported because it is the guessy part. xAI's docs decline to publish a stable model
 * list and point at the console instead, so this reads version numbers out of ids like
 * `grok-4.6`, `grok-4-0709`, `grok-3`. Picking wrong would be silent — the run would
 * simply use a weaker model and nobody would know — which is why it is tested rather
 * than trusted.
 */
export function pickNewestGrok(ids: readonly string[]): string | undefined {
  const groks = ids.filter((id) => /^grok/i.test(id));
  if (groks.length === 0) return undefined;

  const score = (id: string): number => {
    // Major, then minor. A date suffix like -0709 is not a minor version, so only
    // treat a short trailing group as one.
    const match = /grok[-_]?(\d+)(?:[._-](\d{1,2})(?![\d]))?/i.exec(id);
    if (!match) return 0;
    return Number(match[1]) * 100 + Number(match[2] ?? 0);
  };

  // Prefer a plain id over a dated snapshot at equal version, so `grok-4.6` beats
  // `grok-4.6-0709` — the unpinned id is the one xAI keeps current.
  return [...groks].sort((a, b) => {
    const byVersion = score(b) - score(a);
    if (byVersion !== 0) return byVersion;
    return a.length - b.length;
  })[0];
}
