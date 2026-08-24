import { createHash } from 'node:crypto';
import { countWords, normalize } from '../text.js';
import type { Document, Segment, SegmentKind } from './types.js';

/** Thematic breaks writers actually use, including the dinkus. */
const SCENE_BREAK = /^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|⁂|#|<hr\s*\/?>)[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/;
/** "Chapter Twelve", "CHAPTER 12", "Part Three" — common in plain .txt manuscripts. */
const PROSE_CHAPTER = /^[ \t]*((?:chapter|part|book)\s+[\divxlcm]+|(?:chapter|part|book)\s+\w+)[ \t]*$/i;

export function hashText(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex').slice(0, 16);
}

interface Line {
  text: string;
  start: number;
  end: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      let end = i;
      if (end > start && text.charCodeAt(end - 1) === 13) end--;
      lines.push({ text: text.slice(start, end), start, end });
      start = i + 1;
    }
  }
  return lines;
}

/** Strips YAML frontmatter so `---` at the top is never mistaken for a scene break. */
function takeFrontmatter(text: string): { frontmatter: string | undefined; offset: number } {
  if (!text.startsWith('---')) return { frontmatter: undefined, offset: 0 };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: undefined, offset: 0 };
  const close = text.indexOf('\n', end + 1);
  const stop = close === -1 ? text.length : close + 1;
  return { frontmatter: text.slice(3, end).trim(), offset: stop };
}

function makeId(path: string, kind: SegmentKind, ordinal: number, hash: string): string {
  return `${path}#${kind}:${ordinal}:${hash.slice(0, 8)}`;
}

/**
 * Parse a manuscript into chapters, scenes and paragraphs.
 *
 * Deliberately forgiving: a plain .txt file with no markup still yields one chapter,
 * scenes split on blank-line-separated thematic breaks, and paragraphs. Writers should
 * not have to mark up their draft to get continuity checking.
 */
export function segmentDocument(path: string, text: string): Document {
  const { frontmatter, offset } = takeFrontmatter(text);
  const lines = splitLines(text).filter((l) => l.start >= offset);

  const segments: Segment[] = [];
  let chapterOrdinal = 0;
  let sceneOrdinal = 0;
  let paragraphOrdinal = 0;

  let chapterId: string | undefined;
  let chapterStart = offset;
  let chapterTitle: string | undefined;

  let sceneId: string | undefined;
  let sceneStart = offset;

  let paraLines: Line[] = [];

  const flushParagraph = (): void => {
    if (paraLines.length === 0) return;
    const first = paraLines[0]!;
    const last = paraLines[paraLines.length - 1]!;
    const body = text.slice(first.start, last.end);
    if (body.trim().length === 0) {
      paraLines = [];
      return;
    }
    const hash = hashText(body);
    segments.push({
      id: makeId(path, 'paragraph', paragraphOrdinal, hash),
      kind: 'paragraph',
      span: { start: first.start, end: last.end },
      text: body,
      hash,
      parentId: sceneId,
      ordinal: paragraphOrdinal++,
      title: undefined,
      wordCount: countWords(body),
    });
    paraLines = [];
  };

  const flushScene = (end: number): void => {
    flushParagraph();
    if (end <= sceneStart) return;
    const body = text.slice(sceneStart, end);
    if (body.trim().length === 0) return;
    const hash = hashText(body);
    const id = makeId(path, 'scene', sceneOrdinal, hash);
    // Scenes are emitted after their paragraphs exist, so re-parent them now.
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i]!;
      if (s.kind !== 'paragraph') break;
      if (s.parentId === sceneId) {
        segments[i] = { ...s, parentId: id };
      }
    }
    segments.push({
      id,
      kind: 'scene',
      span: { start: sceneStart, end },
      text: body,
      hash,
      parentId: chapterId,
      ordinal: sceneOrdinal++,
      title: firstSentence(body),
      wordCount: countWords(body),
    });
    sceneId = id;
  };

  const flushChapter = (end: number): void => {
    flushScene(end);
    if (end <= chapterStart) return;
    const body = text.slice(chapterStart, end);
    if (body.trim().length === 0) return;
    const hash = hashText(body);
    const id = makeId(path, 'chapter', chapterOrdinal, hash);
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i]!;
      if (s.kind === 'chapter') break;
      if (s.kind === 'scene' && s.parentId === chapterId) segments[i] = { ...s, parentId: id };
    }
    segments.push({
      id,
      kind: 'chapter',
      span: { start: chapterStart, end },
      text: body,
      hash,
      parentId: undefined,
      ordinal: chapterOrdinal++,
      title: chapterTitle,
      wordCount: countWords(body),
    });
    chapterId = id;
  };

  for (const line of lines) {
    const heading = HEADING.exec(line.text);
    const isProseChapter = PROSE_CHAPTER.test(line.text);
    const isChapterBreak = (heading !== null && heading[1]!.length <= 2) || isProseChapter;
    const isSceneBreak = SCENE_BREAK.test(line.text) || (heading !== null && heading[1]!.length >= 3);

    if (isChapterBreak) {
      flushChapter(line.start);
      chapterStart = line.start;
      sceneStart = line.start;
      chapterTitle = heading ? heading[2]!.trim() : line.text.trim();
      continue;
    }

    if (isSceneBreak) {
      flushScene(line.start);
      sceneStart = line.end;
      continue;
    }

    if (line.text.trim().length === 0) {
      flushParagraph();
      continue;
    }

    paraLines.push(line);
  }

  flushChapter(text.length);

  return { path, text, segments, frontmatter };
}

function firstSentence(text: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return undefined;
  const stop = trimmed.search(/[.!?]["'”’]?\s/);
  const raw = stop === -1 ? trimmed : trimmed.slice(0, stop + 1);
  return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
}

/** Convenience: the segments of one kind, in document order. */
export function segmentsOfKind(doc: Document, kind: SegmentKind): Segment[] {
  return doc.segments.filter((s) => s.kind === kind).sort((a, b) => a.span.start - b.span.start);
}

/** The scene containing an offset, if any. */
export function sceneAt(doc: Document, offset: number): Segment | undefined {
  return doc.segments.find(
    (s) => s.kind === 'scene' && offset >= s.span.start && offset < s.span.end,
  );
}

/** The chapter containing an offset, if any. */
export function chapterAt(doc: Document, offset: number): Segment | undefined {
  return doc.segments.find(
    (s) => s.kind === 'chapter' && offset >= s.span.start && offset < s.span.end,
  );
}
