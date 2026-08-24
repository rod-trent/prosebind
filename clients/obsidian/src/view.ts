import { ItemView, MarkdownView, TFile, type WorkspaceLeaf } from 'obsidian';
import type { Finding } from './client.js';

export const CONTINUITY_VIEW = 'prosebind-continuity';

export interface ViewHost {
  findings(): Finding[];
  vaultPath(): string;
  suppress(finding: Finding): Promise<void>;
  recheck(): Promise<void>;
  status(): { state: 'starting' | 'ready' | 'failed'; detail?: string | undefined };
}

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  contradiction: 'contradiction',
  question: 'question',
  note: 'note',
};

/**
 * The continuity sidebar.
 *
 * VS Code has a Problems panel; Obsidian does not, so DESIGN.md § 10's "sidebar with a
 * badge count" has to be built here. It is the quiet channel: findings accumulate, and
 * nothing about this view interrupts a writer mid-sentence. There are no notices, no
 * modals, and no focus stealing.
 */
export class ContinuityView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: ViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return CONTINUITY_VIEW;
  }

  getDisplayText(): string {
    return 'Continuity';
  }

  override getIcon(): string {
    return 'book-open';
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('prosebind-view');

    const status = this.host.status();
    if (status.state !== 'ready') {
      const banner = root.createDiv({ cls: 'prosebind-banner' });
      banner.setText(
        status.state === 'starting'
          ? 'Reading your manuscript…'
          : `Prosebind is not running. ${status.detail ?? ''}`.trim(),
      );
      if (status.state === 'failed') banner.addClass('prosebind-banner-failed');
      return;
    }

    const findings = this.host.findings();

    const header = root.createDiv({ cls: 'prosebind-header' });
    const counts = tally(findings);
    header.createSpan({
      cls: 'prosebind-summary',
      text:
        findings.length === 0
          ? 'No continuity findings.'
          : [
              counts.contradiction > 0 ? `${counts.contradiction} contradiction${counts.contradiction === 1 ? '' : 's'}` : '',
              counts.question > 0 ? `${counts.question} question${counts.question === 1 ? '' : 's'}` : '',
              counts.note > 0 ? `${counts.note} note${counts.note === 1 ? '' : 's'}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
    });

    const recheck = header.createEl('button', { text: 'Recheck', cls: 'prosebind-recheck' });
    recheck.addEventListener('click', () => void this.host.recheck());

    if (findings.length === 0) {
      root.createDiv({
        cls: 'prosebind-empty',
        text: 'Nothing here contradicts anything else. That is not the same as nothing being wrong.',
      });
      return;
    }

    for (const [path, group] of groupByFile(findings)) {
      const section = root.createDiv({ cls: 'prosebind-file' });
      section.createDiv({ cls: 'prosebind-file-name', text: this.relative(path) });

      for (const finding of group) {
        const item = section.createDiv({ cls: `prosebind-finding prosebind-${finding.severity}` });

        const line = item.createDiv({ cls: 'prosebind-finding-head' });
        line.createSpan({ cls: 'prosebind-mark', text: mark(finding.severity) });
        line.createSpan({ cls: 'prosebind-message', text: finding.message });

        const meta = item.createDiv({ cls: 'prosebind-meta' });
        meta.createSpan({ text: `line ${finding.line + 1} · ${finding.check} · ${SEVERITY_LABEL[finding.severity]}` });

        if (finding.detail) item.createDiv({ cls: 'prosebind-detail', text: finding.detail });

        for (const related of finding.related) {
          const link = item.createDiv({ cls: 'prosebind-related' });
          link.setText(`↳ ${related.label} — ${this.relative(related.path)}:${related.line + 1}`);
          link.addEventListener('click', (event) => {
            event.stopPropagation();
            void this.reveal(related.path, related.line);
          });
        }

        const actions = item.createDiv({ cls: 'prosebind-actions' });
        const dismiss = actions.createEl('button', { text: 'Mark as intentional' });
        dismiss.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.host.suppress(finding);
        });

        item.addEventListener('click', () => void this.reveal(finding.path, finding.line));
      }
    }
  }

  private relative(absolute: string): string {
    const base = this.host.vaultPath();
    const normalised = absolute.split('\\').join('/');
    const root = base.split('\\').join('/');
    return normalised.startsWith(root) ? normalised.slice(root.length).replace(/^\//, '') : normalised;
  }

  /** Open the file and put the cursor on the offending line. */
  private async reveal(absolute: string, line: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.relative(absolute));
    if (!(file instanceof TFile)) return;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }
}

function mark(severity: Finding['severity']): string {
  if (severity === 'contradiction') return '×';
  if (severity === 'question') return '?';
  return '·';
}

function tally(findings: Finding[]): Record<Finding['severity'], number> {
  const counts: Record<Finding['severity'], number> = { contradiction: 0, question: 0, note: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

function groupByFile(findings: Finding[]): Array<[string, Finding[]]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = map.get(finding.path);
    if (bucket) bucket.push(finding);
    else map.set(finding.path, [finding]);
  }
  return [...map.entries()];
}
