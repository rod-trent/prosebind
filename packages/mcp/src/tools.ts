import { relative } from 'node:path';
import { LineIndex, projectOffset } from '@prosebind/core';
import type { AnalysisResult, Diagnostic, Document, Entity } from '@prosebind/core';
import type { Session } from '@prosebind/daemon';
import type { ToolDefinition, ToolResult } from './protocol.js';

export interface ToolContext {
  session: Session;
  root: string;
  /** Latest analysis. Recomputed on demand, not on every call. */
  result: () => AnalysisResult;
  refresh: () => Promise<AnalysisResult>;
}

export interface Tool {
  definition: ToolDefinition;
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult> | ToolResult;
}

// --- formatting ------------------------------------------------------------

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });
const failure = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }], isError: true });

function rel(context: ToolContext, path: string): string {
  return relative(context.root, path).split('\\').join('/') || path;
}

const indexes = new WeakMap<Document, LineIndex>();
function lineOf(doc: Document, offset: number): number {
  let index = indexes.get(doc);
  if (!index) {
    index = new LineIndex(doc.text);
    indexes.set(doc, index);
  }
  return index.positionAt(offset).line + 1;
}

function docFor(context: ToolContext, path: string): Document | undefined {
  return context.session.documents.get(path);
}

function findEntity(context: ToolContext, name: string): Entity | undefined {
  const graph = context.session.graph;
  const needle = name.trim().toLowerCase();
  return (
    graph.entities.find((e) => e.name.toLowerCase() === needle) ??
    graph.entities.find((e) => e.aliases.some((a) => a.toLowerCase() === needle)) ??
    graph.entities.find((e) => e.name.toLowerCase().includes(needle))
  );
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// --- tools -----------------------------------------------------------------

const listEntities: Tool = {
  definition: {
    name: 'list_entities',
    description:
      'List everyone and everything declared in the writer\'s continuity bible — characters, places, objects, organizations. Start here when you do not yet know who exists in this manuscript.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['character', 'place', 'object', 'organization'],
          description: 'Restrict to one kind. Omit for everything.',
        },
      },
    },
  },
  run(args, context) {
    const wanted = str(args, 'type');
    const entities = context.session.graph.entities.filter((e) => !wanted || e.type === wanted);
    if (entities.length === 0) {
      return text(
        wanted
          ? `No entities of type "${wanted}" in the bible.`
          : 'The bible declares no entities yet. The writer creates one by running "prosebind init" and editing .prosebind/bible/characters.yaml.',
      );
    }

    const lines = entities.map((entity) => {
      const mentions = context.session.graph.mentionsOf(entity.id).length;
      const aliases = entity.aliases.length > 0 ? ` (also: ${entity.aliases.join(', ')})` : '';
      return `- ${entity.name}${aliases} — ${entity.type}, ${mentions} mention${mentions === 1 ? '' : 's'}`;
    });
    return text(`${entities.length} entities:\n\n${lines.join('\n')}`);
  },
};

const describeEntity: Tool = {
  definition: {
    name: 'describe_entity',
    description:
      'Everything Prosebind knows about one character, place, object or organization: canon facts pinned by the writer, facts inferred from the prose, where they appear, and any birth or death events. Facts are labelled canon or inferred — never present an inferred fact as established.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name or alias.' } },
      required: ['name'],
    },
  },
  run(args, context) {
    const name = str(args, 'name');
    if (!name) return failure('describe_entity needs a "name".');

    const entity = findEntity(context, name);
    if (!entity) {
      const known = context.session.graph.entities.map((e) => e.name).join(', ');
      return failure(`No entity called "${name}". The bible declares: ${known || '(nothing yet)'}`);
    }

    const graph = context.session.graph;
    const lines: string[] = [`${entity.name} — ${entity.type}`];
    if (entity.aliases.length > 0) lines.push(`Also known as: ${entity.aliases.join(', ')}`);
    if (entity.born) lines.push(`Born: ${entity.born}`);

    const facts = graph.factsFor(entity.id);
    if (facts.length > 0) {
      lines.push('', 'Established:');
      for (const fact of facts) {
        lines.push(`  ${fact.predicate}: ${fact.value}  [${fact.tier}, from ${fact.provenance.file}]`);
      }
    }

    for (const [label, id] of [
      ['Introduced at', entity.introducedAt],
      ['Dies at', entity.deceasedAfter],
    ] as const) {
      if (!id) continue;
      const event = graph.event(id);
      const where = event?.position
        ? ` — ${rel(context, event.position.file)}${
            docFor(context, event.position.file)
              ? `:${lineOf(docFor(context, event.position.file)!, event.position.offset)}`
              : ''
          }`
        : ' (not pinned to a place in the prose)';
      lines.push(`${label}: ${event?.label ?? id}${event?.date ? ` (${event.date})` : ''}${where}`);
    }

    const mentions = graph.mentionsOf(entity.id);
    lines.push('', `Appears ${mentions.length} time${mentions.length === 1 ? '' : 's'}.`);
    if (mentions.length === 0) {
      lines.push('Declared in the bible but never mentioned in the manuscript — possibly cut, possibly not written yet.');
    }

    const findings = context.result().diagnostics.filter((d) => d.message.includes(entity.name));
    if (findings.length > 0) {
      lines.push('', `${findings.length} open finding${findings.length === 1 ? '' : 's'} mention them:`);
      for (const finding of findings.slice(0, 8)) lines.push(`  ${finding.severity}: ${finding.message}`);
    }

    return text(lines.join('\n'));
  },
};

const findMentions: Tool = {
  definition: {
    name: 'find_mentions',
    description:
      'Every place a character or object appears in the manuscript, with file, line, and the scene it sits in. Use this to answer "where does X show up" or to trace an arc through the book.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or alias.' },
        limit: { type: 'number', description: 'Maximum results (default 50).' },
      },
      required: ['name'],
    },
  },
  run(args, context) {
    const name = str(args, 'name');
    if (!name) return failure('find_mentions needs a "name".');
    const entity = findEntity(context, name);
    if (!entity) return failure(`No entity called "${name}".`);

    const limit = num(args, 'limit') ?? 50;
    const bySegment = new Map<string, Document>();
    for (const doc of context.session.documents.values()) {
      for (const segment of doc.segments) bySegment.set(segment.id, doc);
    }

    const rows = context.session.graph
      .mentionsOf(entity.id)
      .map((mention) => {
        const doc = bySegment.get(mention.segmentId);
        if (!doc) return undefined;
        const scene = doc.segments.find(
          (s) => s.kind === 'scene' && mention.span.start >= s.span.start && mention.span.start < s.span.end,
        );
        return {
          file: rel(context, doc.path),
          line: lineOf(doc, mention.span.start),
          surface: mention.surface,
          speaking: mention.speaking,
          scene: scene?.title,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    if (rows.length === 0) return text(`${entity.name} is never mentioned in the manuscript.`);

    const shown = rows.slice(0, limit);
    const lines = shown.map(
      (row) =>
        `${row.file}:${row.line}  "${row.surface}"${row.speaking ? ' (speaking)' : ''}${row.scene ? ` — ${row.scene}` : ''}`,
    );
    const suffix = rows.length > shown.length ? `\n\n… ${rows.length - shown.length} more.` : '';
    return text(`${entity.name}: ${rows.length} mentions\n\n${lines.join('\n')}${suffix}`);
  },
};

const listFindings: Tool = {
  definition: {
    name: 'list_findings',
    description:
      'Open continuity findings: contradictions, questions and notes, with the evidence behind each. A finding is a question worth asking, not proof of an error — deliberate inconsistency is normal fiction.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['contradiction', 'question', 'note'], description: 'Filter by severity.' },
        check: { type: 'string', description: 'Filter to one check, e.g. deceased-active.' },
        file: { type: 'string', description: 'Filter to one file (path relative to the project root).' },
      },
    },
  },
  run(args, context) {
    const severity = str(args, 'severity');
    const check = str(args, 'check');
    const file = str(args, 'file');

    let findings: readonly Diagnostic[] = context.result().diagnostics;
    if (severity) findings = findings.filter((d) => d.severity === severity);
    if (check) findings = findings.filter((d) => d.check === check);
    if (file) findings = findings.filter((d) => rel(context, d.file).includes(file));

    if (findings.length === 0) {
      return text(
        'No findings match. That means nothing in the manuscript contradicts anything else that Prosebind can check deterministically — not that the manuscript is without problems.',
      );
    }

    const lines: string[] = [];
    for (const finding of findings) {
      const doc = docFor(context, finding.file);
      const where = doc ? `${rel(context, finding.file)}:${lineOf(doc, finding.span.start)}` : rel(context, finding.file);
      lines.push(`${finding.severity.toUpperCase()} [${finding.check}] ${where}`);
      lines.push(`  ${finding.message}`);
      if (finding.detail) lines.push(`  evidence: ${finding.detail}`);
      for (const related of finding.related ?? []) {
        const relDoc = docFor(context, related.file);
        const relWhere = relDoc ? `${rel(context, related.file)}:${lineOf(relDoc, related.span.start)}` : rel(context, related.file);
        lines.push(`  conflicts with: ${related.label} — ${relWhere}`);
      }
      lines.push(`  confidence: ${finding.confidence.toFixed(2)}`);
      lines.push('');
    }
    return text(`${findings.length} finding${findings.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`);
  },
};

const timeline: Tool = {
  definition: {
    name: 'timeline',
    description:
      'The story timeline the writer declared: events in order, with dates where given and where each one happens in the prose. Events with no date and no position cannot support before/after reasoning.',
    inputSchema: { type: 'object', properties: {} },
  },
  run(_args, context) {
    const events = context.session.graph.events;
    if (events.length === 0) return text('No timeline events declared in .prosebind/bible/timeline.yaml.');

    const lines = events.map((event) => {
      const when = event.date ? event.date : 'undated';
      const position = event.position;
      const doc = position ? docFor(context, position.file) : undefined;
      const where = position
        ? `${rel(context, position.file)}${doc ? `:${lineOf(doc, position.offset)}` : ''} (pinned by ${position.via})`
        : 'not pinned to the prose';
      return `- ${event.label} — ${when} — ${where}`;
    });
    return text(`${events.length} events:\n\n${lines.join('\n')}`);
  },
};

const outline: Tool = {
  definition: {
    name: 'outline',
    description:
      'The structure of the manuscript: chapters and scenes with word counts. Use it to orient yourself in a book you have not read.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Restrict to one file.' } },
    },
  },
  run(args, context) {
    const filter = str(args, 'file');
    const lines: string[] = [];
    let words = 0;

    for (const doc of context.session.documents.values()) {
      const path = rel(context, doc.path);
      if (filter && !path.includes(filter)) continue;
      lines.push(path);
      for (const chapter of doc.segments.filter((s) => s.kind === 'chapter')) {
        lines.push(`  ${chapter.title ?? `Chapter ${chapter.ordinal + 1}`} — ${chapter.wordCount} words`);
        for (const scene of doc.segments.filter((s) => s.kind === 'scene' && s.parentId === chapter.id)) {
          lines.push(`    · ${scene.title ?? `Scene ${scene.ordinal + 1}`} (${scene.wordCount} words)`);
        }
      }
      words += doc.segments.filter((s) => s.kind === 'paragraph').reduce((n, s) => n + s.wordCount, 0);
    }

    if (lines.length === 0) return text('No manuscript files found.');
    return text(`${words.toLocaleString('en-US')} words total\n\n${lines.join('\n')}`);
  },
};

const establishedBefore: Tool = {
  definition: {
    name: 'established_before',
    description:
      'What the story has established by a given point: which timeline events have happened, and which characters have appeared. Useful for checking whether a scene can reference something yet. Note: this is world-state, not per-character knowledge — Prosebind does not yet track who knows what.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to measure from (path fragment).' },
        line: { type: 'number', description: '1-based line in that file. Defaults to the end of the file.' },
      },
      required: ['file'],
    },
  },
  run(args, context) {
    const fileArg = str(args, 'file');
    if (!fileArg) return failure('established_before needs a "file".');

    const doc = [...context.session.documents.values()].find((d) => rel(context, d.path).includes(fileArg));
    if (!doc) {
      const known = [...context.session.documents.keys()].map((p) => rel(context, p)).join(', ');
      return failure(`No file matching "${fileArg}". Known files: ${known}`);
    }

    const line = num(args, 'line');
    const index = new LineIndex(doc.text);
    const offset = line === undefined ? doc.text.length : index.offsetAt({ line: line - 1, character: 0 });
    const documents = [...context.session.documents.values()];
    const cutoff = projectOffset(documents, doc.path, offset);

    const graph = context.session.graph;

    const happened = graph.events.filter((event) => {
      const position = event.position;
      if (!position) return false;
      return projectOffset(documents, position.file, position.offset) <= cutoff;
    });

    const bySegment = new Map<string, Document>();
    for (const d of documents) for (const s of d.segments) bySegment.set(s.id, d);

    const appeared = graph.entities.filter((entity) =>
      graph.mentionsOf(entity.id).some((mention) => {
        const owner = bySegment.get(mention.segmentId);
        return owner ? projectOffset(documents, owner.path, mention.span.start) <= cutoff : false;
      }),
    );

    const lines = [
      `As of ${rel(context, doc.path)}${line !== undefined ? `:${line}` : ' (end of file)'}:`,
      '',
      `Events that have happened (${happened.length}):`,
      ...(happened.length > 0
        ? happened.map((e) => `  - ${e.label}${e.date ? ` (${e.date})` : ''}`)
        : ['  (none pinned to the prose before this point)']),
      '',
      `Characters the reader has met (${appeared.length}):`,
      ...(appeared.length > 0 ? appeared.map((e) => `  - ${e.name}`) : ['  (none)']),
      '',
      'Canon facts from the bible apply throughout unless the writer scoped them to an event.',
      '',
      'Not answered here: what any individual character knows at this point. Prosebind tracks',
      'world-state, not per-character knowledge — that is a planned capability, not a current one.',
    ];

    return text(lines.join('\n'));
  },
};

const recheck: Tool = {
  definition: {
    name: 'recheck',
    description:
      'Re-read the manuscript from disk and re-run every check. Use after the writer has edited files, or if results look stale.',
    inputSchema: { type: 'object', properties: {} },
  },
  async run(_args, context) {
    const result = await context.refresh();
    const counts = { contradiction: 0, question: 0, note: 0 };
    for (const finding of result.diagnostics) counts[finding.severity]++;
    return text(
      `Rechecked ${result.stats.documents} file${result.stats.documents === 1 ? '' : 's'}, ` +
        `${result.stats.words.toLocaleString('en-US')} words, in ${result.stats.durationMs.toFixed(0)}ms.\n` +
        `${counts.contradiction} contradictions, ${counts.question} questions, ${counts.note} notes.`,
    );
  },
};

/**
 * Every tool. All read-only on purpose: an agent must not be able to edit a writer's
 * manuscript or silently rewrite their canon. Suppressing a finding is a judgement
 * about the writer's own intent, and stays theirs to make.
 */
export const TOOLS: readonly Tool[] = [
  listFindings,
  listEntities,
  describeEntity,
  findMentions,
  timeline,
  outline,
  establishedBefore,
  recheck,
];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.definition.name === name);
}
