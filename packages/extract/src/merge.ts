import type { ContinuityGraph, Entity, Fact, Provenance } from '@prosebind/core';
import type { SceneExtraction } from './schema.js';

/**
 * Fold an extraction into the continuity graph.
 *
 * The single rule governing this file: **extraction never becomes canon.** Every fact
 * added here is `inferred`, and `ContinuityGraph.resolveFact` already prefers canon on
 * ties, so a wrong guess cannot displace something the writer wrote down. That is § 6,
 * and it is what makes it safe to run a 4B model over someone's novel at all.
 *
 * Newly discovered characters are added to the graph so checks can use them, but marked
 * `inferred` so no interface can present them as the writer's own. Turning one into
 * canon is a decision only the writer makes — see `bootstrap`.
 */

export interface MergeReport {
  /** Inferred facts added. */
  factsAdded: number;
  /** Characters found in the prose that the bible does not declare. */
  discovered: Entity[];
  /**
   * Places where the prose disagrees with canon.
   *
   * Reported rather than applied. Canon wins, and the disagreement is exactly the kind
   * of thing the writer should look at — but it is not extraction's business to decide
   * which side is wrong.
   */
  conflicts: Array<{ entity: string; predicate: string; canon: string; observed: string }>;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve a name the model produced against entities we already know. */
function resolve(graph: ContinuityGraph, name: string): Entity | undefined {
  const needle = name.trim().toLowerCase();
  return graph.entities.find(
    (entity) =>
      entity.name.toLowerCase() === needle ||
      entity.aliases.some((alias) => alias.toLowerCase() === needle),
  );
}

export interface MergeOptions {
  graph: ContinuityGraph;
  extraction: SceneExtraction;
  /** Manuscript file the scene came from, for provenance. */
  file: string;
  segmentId: string;
  /**
   * Confidence attached to inferred facts. Deliberately well under 1: these came from a
   * small model reading one scene, and § 12 puts confidence in front of the writer.
   */
  confidence?: number;
}

export function mergeExtraction(options: MergeOptions): MergeReport {
  const { graph, extraction, file, segmentId } = options;
  const confidence = options.confidence ?? 0.6;
  const provenance: Provenance = { source: 'text', file, segmentId };

  const report: MergeReport = { factsAdded: 0, discovered: [], conflicts: [] };

  // --- characters ----------------------------------------------------------
  for (const character of extraction.characters) {
    const existing = resolve(graph, character.name);
    if (existing) {
      // Aliases the model saw are useful, but merging them into a canon entity would
      // silently edit the writer's bible. Left alone on purpose.
      continue;
    }

    const id = `inferred:${slug(character.name)}`;
    if (graph.entity(id)) continue;

    const entity: Entity = {
      id,
      name: character.name,
      type: 'character',
      tier: 'inferred',
      aliases: character.aliases,
      attributes: {},
    };
    graph.addEntity(entity);
    report.discovered.push(entity);
  }

  // --- attributes ----------------------------------------------------------
  for (const attribute of extraction.attributes) {
    const entity = resolve(graph, attribute.subject);
    if (!entity) continue;

    const canon = graph
      .factsFor(entity.id)
      .find((fact) => fact.predicate === attribute.predicate && fact.tier === 'canon');

    if (canon && canon.value.toLowerCase() !== attribute.value.toLowerCase()) {
      report.conflicts.push({
        entity: entity.name,
        predicate: attribute.predicate,
        canon: canon.value,
        observed: attribute.value,
      });
      // Still recorded. Canon wins at resolution time, and hiding the observation
      // would leave the writer unable to see why we think there is a problem.
    }

    const fact: Fact = {
      // Segment-scoped id: the same claim in two scenes is two observations, and
      // collapsing them would lose the fact that the prose repeats itself.
      id: `${entity.id}:${attribute.predicate}:${segmentId}`,
      entityId: entity.id,
      predicate: attribute.predicate,
      value: attribute.value,
      tier: 'inferred',
      confidence,
      provenance,
    };
    graph.addFact(fact);
    report.factsAdded++;
  }

  return report;
}

/** Everything Tier 1 has inferred, for review interfaces and the bootstrap. */
export function inferredEntities(graph: ContinuityGraph): Entity[] {
  return graph.entities.filter((entity) => entity.tier === 'inferred');
}

export function inferredFacts(graph: ContinuityGraph): Fact[] {
  return graph.facts.filter((fact) => fact.tier === 'inferred');
}
