import type { GenerateRequest, GenerateResponse, LanguageModel } from '../provider.js';
import { ModelUnavailableError } from '../provider.js';

/**
 * Local inference through Ollama.
 *
 * The default Tier 1 backend, and the reason the privacy claim in DESIGN.md § 2 is
 * honest rather than aspirational: the manuscript reaches a model on the writer's own
 * machine and nothing leaves it. `location` is `local` and that is load-bearing, not a
 * label — see `assertPermitted`.
 */
export interface OllamaOptions {
  /** Model tag, e.g. `gemma3:4b`. Small on purpose: § 7 budgets Tier 1 at sub-second. */
  model: string;
  host?: string;
  /** Hard ceiling per call, so one bad scene cannot stall a writing session. */
  timeoutMs?: number;
}

const DEFAULT_HOST = 'http://127.0.0.1:11434';

export class OllamaModel implements LanguageModel {
  readonly location = 'local' as const;
  private readonly host: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OllamaOptions) {
    this.host = (options.host ?? DEFAULT_HOST).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get id(): string {
    return `ollama:${this.options.model}`;
  }

  get describe(): string {
    return `${this.options.model} running locally via Ollama (${this.host})`;
  }

  async available(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const names = (body.models ?? []).map((m) => m.name ?? '');
      // Accept an exact tag, or the bare name when the caller omitted `:latest`.
      return names.some((name) => name === this.options.model || name.split(':')[0] === this.options.model.split(':')[0]);
    } catch {
      return false;
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const started = performance.now();

    const body: Record<string, unknown> = {
      model: this.options.model,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: request.temperature ?? 0,
        num_predict: request.maxTokens ?? 800,
      },
    };
    if (request.system) body['system'] = request.system;
    // Ollama constrains decoding to a schema when given one, which is far more
    // reliable than asking a small model nicely for valid JSON.
    if (request.schema) body['format'] = request.schema;

    const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
    if (request.signal) signals.push(request.signal);

    let response: Response;
    try {
      response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      throw new ModelUnavailableError(
        this.id,
        `could not reach Ollama at ${this.host}: ${(error as Error).message}. ` +
          'Is it running? Tier 1 needs a local model; Tier 0 keeps working without one.',
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ModelUnavailableError(
        this.id,
        `Ollama returned ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as { response?: string };
    return {
      text: payload.response ?? '',
      durationMs: performance.now() - started,
      model: this.id,
    };
  }
}

/** Models Ollama currently has pulled, for diagnostics and setup guidance. */
export async function listOllamaModels(host = DEFAULT_HOST): Promise<string[]> {
  try {
    const response = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}
