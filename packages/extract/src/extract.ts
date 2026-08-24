import type { ContinuityGraph, Segment } from '@prosebind/core';
import { filterImplausible, linkExtraction } from './link.js';
import { buildExtractionPrompt, clampScene, EXTRACTION_SYSTEM } from './prompt.js';
import {
  EMPTY_EXTRACTION,
  EXTRACTION_SCHEMA,
  isEmpty,
  normalizeExtraction,
  type SceneExtraction,
} from './schema.js';
import {
  assertPermitted,
  extractJson,
  LOCAL_ONLY,
  ModelUnavailableError,
  type LanguageModel,
  type NetworkPolicy,
} from './provider.js';

export interface ExtractorOptions {
  model: LanguageModel;
  policy?: NetworkPolicy | undefined;
  /** Retry once on unparseable output. Small models occasionally emit prose instead. */
  retries?: number | undefined;
  onError?: ((segmentId: string, error: Error) => void) | undefined;
}

export interface ExtractionRecord {
  readonly segmentId: string;
  readonly hash: string;
  readonly extraction: SceneExtraction;
  readonly durationMs: number;
  /** True when the result came from cache and cost nothing. */
  readonly cached: boolean;
}

/**
 * Tier 1: turn a scene into structured claims.
 *
 * The cache is keyed by segment content hash, which extends the incremental contract
 * from § 8 across the tier boundary. Tier 0 already re-checks only what changed;
 * without the same discipline here, a model call per scene per keystroke would make
 * Tier 1 unaffordable and the whole architecture pointless.
 *
 * Failure is never fatal. A model that is missing, slow, or talking nonsense degrades
 * Tier 1 to "extracted nothing" — Tier 0 keeps running, and the writer keeps their
 * deterministic checks.
 */
export class SceneExtractor {
  private readonly cache = new Map<string, SceneExtraction>();
  private readonly policy: NetworkPolicy;

  constructor(private readonly options: ExtractorOptions) {
    this.policy = options.policy ?? LOCAL_ONLY;
  }

  get model(): LanguageModel {
    return this.options.model;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** Drop a scene's cached extraction, e.g. when its content changed. */
  invalidate(hash: string): void {
    this.cache.delete(hash);
  }

  async extract(
    segment: Segment,
    knownNames: readonly string[],
    canonical: ReadonlyMap<string, string> = new Map(),
  ): Promise<ExtractionRecord> {
    const cached = this.cache.get(segment.hash);
    if (cached) {
      return { segmentId: segment.id, hash: segment.hash, extraction: cached, durationMs: 0, cached: true };
    }

    const text = clampScene(segment.text);
    const prompt = buildExtractionPrompt({ knownNames, text, label: segment.title });

    let lastError: Error | undefined;
    const attempts = (this.options.retries ?? 1) + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        assertPermitted(this.options.model, this.policy, text.length);

        const response = await this.options.model.generate({
          system: EXTRACTION_SYSTEM,
          prompt,
          schema: EXTRACTION_SCHEMA,
          temperature: 0,
          maxTokens: 800,
        });

        // Three passes over untrusted output, in order of how much each one saves:
        //   normalize — reject anything structurally wrong
        //   link      — collapse "Elena" and "Elena Vasquez" into one person
        //   filter    — drop values that cannot be what the predicate asks for
        const extraction = filterImplausible(
          linkExtraction(normalizeExtraction(extractJson(response.text)), canonical),
        );
        this.cache.set(segment.hash, extraction);
        return {
          segmentId: segment.id,
          hash: segment.hash,
          extraction,
          durationMs: response.durationMs,
          cached: false,
        };
      } catch (error) {
        lastError = error as Error;
        // A refused network call is a policy decision, not a transient fault.
        if (error instanceof ModelUnavailableError) break;
      }
    }

    if (lastError) this.options.onError?.(segment.id, lastError);

    // Cache the empty result too. A scene the model cannot parse will not become
    // parseable on the next keystroke, and retrying it forever would burn the budget
    // that unchanged scenes are supposed to save.
    this.cache.set(segment.hash, EMPTY_EXTRACTION);
    return {
      segmentId: segment.id,
      hash: segment.hash,
      extraction: EMPTY_EXTRACTION,
      durationMs: 0,
      cached: false,
    };
  }

  /** Extract several scenes, sequentially — a local model is not helped by concurrency. */
  async extractAll(
    segments: readonly Segment[],
    knownNames: readonly string[],
  ): Promise<ExtractionRecord[]> {
    const records: ExtractionRecord[] = [];
    for (const segment of segments) {
      records.push(await this.extract(segment, knownNames));
    }
    return records;
  }
}

/** Names the model should link against: everything the bible already declares. */
export function knownNamesFrom(graph: ContinuityGraph): string[] {
  const names = new Set<string>();
  for (const entity of graph.entities) {
    names.add(entity.name);
    for (const alias of entity.aliases) names.add(alias);
  }
  return [...names];
}

export function isEmptyExtraction(extraction: SceneExtraction): boolean {
  return isEmpty(extraction);
}
