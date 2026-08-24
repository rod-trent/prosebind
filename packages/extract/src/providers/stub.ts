import type { GenerateRequest, GenerateResponse, LanguageModel } from '../provider.js';

/**
 * A deterministic model that runs no inference.
 *
 * Not a mock bolted on for convenience — the extraction pipeline has real logic in it
 * (caching, merging, canon precedence, malformed-output handling) and all of it must be
 * testable without a GPU, without a network, and with the same result every run. Tests
 * that depend on a live model test the model, not the pipeline.
 *
 * It also serves as the null backend: with no model configured, Tier 1 degrades to
 * "extracts nothing" rather than failing, and Tier 0 carries on untouched.
 */
export class StubModel implements LanguageModel {
  readonly location = 'local' as const;
  readonly id = 'stub';
  readonly describe = 'a deterministic stub that runs no inference';

  /** Calls made, so tests can assert the cache actually prevented work. */
  calls: GenerateRequest[] = [];

  constructor(private readonly responder: (request: GenerateRequest) => string) {}

  async available(): Promise<boolean> {
    return true;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    return { text: this.responder(request), durationMs: 0, model: this.id };
  }
}

/** Always returns the same extraction, whatever the prose says. */
export function fixedExtraction(payload: unknown): StubModel {
  return new StubModel(() => JSON.stringify(payload));
}

/** Returns nothing useful, for the "no model configured" path. */
export function emptyExtraction(): StubModel {
  return new StubModel(() =>
    JSON.stringify({ characters: [], attributes: [], places: [], events: [] }),
  );
}
