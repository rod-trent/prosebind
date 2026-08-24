import { ageArithmetic, attributeContradiction } from './attributes.js';
import { aliasCollision, nameVariant } from './naming.js';
import { povDrift, tenseDrift } from './narration.js';
import { deceasedActive, unintroducedMention } from './presence.js';
import type { Check, CheckContext, Diagnostic } from './types.js';

/**
 * Every Tier 0 check.
 *
 * All of these are deterministic and model-free. Adding one here means committing to
 * DESIGN.md § 7: if it needs a language model it belongs in Tier 1 or 2, not in this
 * list. See CONTRIBUTING.md for what a new check has to demonstrate.
 */
export const TIER0_CHECKS: readonly Check[] = [
  deceasedActive,
  nameVariant,
  attributeContradiction,
  ageArithmetic,
  unintroducedMention,
  povDrift,
  tenseDrift,
  aliasCollision,
];

export interface SuppressionSet {
  has(key: string): boolean;
}

export const NO_SUPPRESSIONS: SuppressionSet = { has: () => false };

/**
 * Run every check over the dirty segments and return what survives suppression.
 *
 * Ordering is by severity then confidence, because a sidebar the writer scans from the
 * top should put the thing most likely to be a genuine error there.
 */
export function runChecks(
  context: CheckContext,
  suppressions: SuppressionSet = NO_SUPPRESSIONS,
  checks: readonly Check[] = TIER0_CHECKS,
): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const check of checks) {
    let produced: Diagnostic[];
    try {
      produced = check.run(context);
    } catch (error) {
      // One broken check must never take the daemon down mid-session. The writer
      // keeps their other diagnostics; the failure goes to the log.
      process.emitWarning(
        `check "${check.id}" failed on ${context.doc.path}: ${(error as Error).message}`,
        'ProsebindCheckError',
      );
      continue;
    }
    for (const diagnostic of produced) {
      if (suppressions.has(diagnostic.suppressionKey)) continue;
      found.push(diagnostic);
    }
  }

  const rank: Record<Diagnostic['severity'], number> = {
    contradiction: 0,
    question: 1,
    note: 2,
  };
  return found.sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.span.start - b.span.start;
  });
}
