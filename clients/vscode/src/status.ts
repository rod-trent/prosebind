import * as vscode from 'vscode';

/**
 * The quiet channel.
 *
 * DESIGN.md § 10 is explicit: findings accumulate, they do not interrupt. VS Code's
 * native version of "a sidebar with a badge count" is the status bar plus the Problems
 * panel, so that is what we use. There are no notifications, no modal prompts, and
 * nothing that steals focus while someone is writing.
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private disposed = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'workbench.actions.view.problems';
    this.item.name = 'Prosebind';
    this.refresh();
    this.item.show();
  }

  /** Recount from VS Code's own diagnostic store — no extra protocol needed. */
  refresh(): void {
    if (this.disposed) return;

    let contradictions = 0;
    let questions = 0;
    let notes = 0;

    for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const diagnostic of diagnostics) {
        if (diagnostic.source !== 'prosebind') continue;
        switch (diagnostic.severity) {
          case vscode.DiagnosticSeverity.Warning:
            contradictions++;
            break;
          case vscode.DiagnosticSeverity.Information:
            questions++;
            break;
          default:
            notes++;
        }
      }
    }

    const total = contradictions + questions + notes;
    if (total === 0) {
      this.item.text = '$(book) Continuity clear';
      this.item.tooltip = 'Prosebind found no continuity problems.';
      this.item.backgroundColor = undefined;
      return;
    }

    const parts: string[] = [];
    if (contradictions > 0) parts.push(`${contradictions}×`);
    if (questions > 0) parts.push(`${questions}?`);
    if (notes > 0) parts.push(`${notes}·`);
    this.item.text = `$(book) ${parts.join(' ')}`;

    const lines = [
      contradictions > 0 ? `${contradictions} contradiction${contradictions === 1 ? '' : 's'}` : '',
      questions > 0 ? `${questions} question${questions === 1 ? '' : 's'}` : '',
      notes > 0 ? `${notes} note${notes === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    this.item.tooltip = `Prosebind — ${lines.join(', ')}\nClick to open the Problems panel.`;

    // Deliberately no warning background even for contradictions. A manuscript in
    // progress is supposed to have loose ends; colouring the status bar red would
    // make normal drafting feel like a broken build.
    this.item.backgroundColor = undefined;
  }

  /** Shown while the server is starting, so silence is never ambiguous. */
  setStarting(): void {
    this.item.text = '$(loading~spin) Prosebind';
    this.item.tooltip = 'Prosebind is reading your manuscript…';
  }

  setFailed(reason: string): void {
    this.item.text = '$(book) Prosebind unavailable';
    this.item.tooltip = reason;
  }

  dispose(): void {
    this.disposed = true;
    this.item.dispose();
  }
}
