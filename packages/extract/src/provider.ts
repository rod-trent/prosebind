/**
 * The model layer.
 *
 * Provider-agnostic from the first commit, as DESIGN.md § 5 requires, and structured so
 * the local path stays fully functional with no cloud provider configured.
 *
 * The `location` field is not decoration. § 7 says any call that crosses the network is
 * surfaced to the writer explicitly, and that promise is only keepable if every model
 * carries where it runs. A provider that cannot answer that question does not belong
 * here.
 */

export type ModelLocation = 'local' | 'cloud';

export interface GenerateRequest {
  /** System framing. Kept separate so providers that support it can use it properly. */
  system?: string | undefined;
  prompt: string;
  /** JSON Schema the response must satisfy. Providers enforce it where they can. */
  schema?: Record<string, unknown> | undefined;
  /** Upper bound on response length, in tokens. */
  maxTokens?: number | undefined;
  /** 0 for extraction. We want the same prose to yield the same facts. */
  temperature?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface GenerateResponse {
  text: string;
  /** Wall-clock, for the tier-latency budget in § 7. */
  durationMs: number;
  model: string;
}

export interface LanguageModel {
  readonly id: string;
  readonly location: ModelLocation;
  /** Human-readable, for the "what is about to leave this machine" prompt. */
  readonly describe: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  /** Whether the model can actually be reached right now. */
  available(): Promise<boolean>;
}

export class ModelUnavailableError extends Error {
  constructor(
    readonly modelId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * Guards the network boundary.
 *
 * Tier 1 is meant to run on-device. A cloud model reaching Tier 1 is not a
 * configuration detail — it means a writer's unpublished manuscript is being sent to a
 * third party, which § 2 says is the one thing our competitors cannot honestly promise
 * against. It requires explicit consent, recorded, and it is refused by default.
 */
export interface NetworkPolicy {
  /** True only if the writer has explicitly allowed this manuscript to leave the machine. */
  readonly cloudAllowed: boolean;
  /** Called before any cloud call, so the daemon can tell the writer what is happening. */
  onCloudCall?: ((model: LanguageModel, bytes: number) => void) | undefined;
}

export const LOCAL_ONLY: NetworkPolicy = { cloudAllowed: false };

export function assertPermitted(model: LanguageModel, policy: NetworkPolicy, bytes: number): void {
  if (model.location === 'local') return;
  if (!policy.cloudAllowed) {
    throw new ModelUnavailableError(
      model.id,
      `Refusing to send manuscript text to ${model.describe}. ` +
        'Tier 1 runs on-device by default; enable cloud extraction explicitly if you want it.',
    );
  }
  policy.onCloudCall?.(model, bytes);
}

/** Extracts the first JSON object or array from a model response. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Small models like to wrap JSON in a fenced block despite being asked not to.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to a bracket scan.
  }

  const start = candidate.search(/[[{]/);
  if (start === -1) throw new SyntaxError('no JSON found in model response');

  const open = candidate.charAt(start);
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate.charAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }

  throw new SyntaxError('unbalanced JSON in model response');
}
