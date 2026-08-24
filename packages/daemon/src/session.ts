import { readFile } from 'node:fs/promises';
import { Project } from '@prosebind/core';
import type { ContinuityGraph } from '@prosebind/core';
import type { AnalysisResult, Document } from '@prosebind/core';
import { findManuscripts } from './watcher.js';

/**
 * A live analysis session over one project.
 *
 * Owns the file IO that `Project` deliberately does not, so the engine stays testable
 * with in-memory strings and the daemon stays the only thing that touches a disk.
 */
export class Session {
  private project: Project;

  private constructor(
    readonly root: string,
    project: Project,
  ) {
    this.project = project;
  }

  static async open(root: string): Promise<Session> {
    return new Session(root, await Project.open(root));
  }

  get documents(): ReadonlyMap<string, Document> {
    const map = new Map<string, Document>();
    for (const path of this.project.files) {
      const doc = this.project.document(path);
      if (doc) map.set(path, doc);
    }
    return map;
  }

  /** The continuity graph itself, for consumers that query rather than report. */
  get graph(): ContinuityGraph {
    return this.project.graph;
  }

  get bibleIssues(): ReadonlyArray<{ file: string; message: string }> {
    return this.project.bibleIssues;
  }

  get entityCount(): number {
    return this.project.graph.entities.length;
  }

  get eventCount(): number {
    return this.project.graph.events.length;
  }

  /** Read every manuscript file and analyse the lot. The cold-start path. */
  async loadAll(): Promise<AnalysisResult> {
    const paths = await findManuscripts(this.root);
    for (const path of paths) {
      const text = await readFile(path, 'utf8');
      this.project.setDocument(path, text);
    }
    return this.project.analyze();
  }

  /**
   * Re-read specific files and re-analyse only what changed inside them.
   *
   * This is the incremental path that makes watch mode cheap: a save in one chapter
   * costs the segments that actually differ, not the manuscript.
   */
  async reload(paths: readonly string[]): Promise<AnalysisResult> {
    for (const path of paths) {
      try {
        const text = await readFile(path, 'utf8');
        this.project.setDocument(path, text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.project.removeDocument(path);
        } else {
          throw error;
        }
      }
    }
    return this.project.analyze();
  }

  /**
   * Reload the bible and re-check everything.
   *
   * Deliberately a full invalidation: canon is global, so a single edited attribute can
   * change the verdict on any scene in the book. This is the one case where paying for
   * the whole manuscript is correct.
   */
  async reloadBible(): Promise<AnalysisResult> {
    const texts = new Map<string, string>();
    for (const [path, doc] of this.documents) texts.set(path, doc.text);

    this.project = await Project.open(this.root);
    for (const [path, text] of texts) this.project.setDocument(path, text);
    return this.project.analyze();
  }
}
