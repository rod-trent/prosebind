import { FileSystemAdapter, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { ProsebindClient, type Finding } from './client.js';
import { DEFAULT_SETTINGS, ProsebindSettingTab, type ProsebindSettings } from './settings.js';
import { CONTINUITY_VIEW, ContinuityView } from './view.js';

/** Local throttle so we do not write to the pipe on every keystroke. */
const SEND_INTERVAL_MS = 250;

export default class ProsebindPlugin extends Plugin {
  override settings: ProsebindSettings = { ...DEFAULT_SETTINGS };

  private client: ProsebindClient | undefined;
  private statusBar: HTMLElement | undefined;
  private state: { state: 'starting' | 'ready' | 'failed'; detail?: string | undefined } = { state: 'starting' };
  private cached: Finding[] = [];
  private sendTimer: number | undefined;
  private version = 1;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(CONTINUITY_VIEW, (leaf: WorkspaceLeaf) => new ContinuityView(leaf, {
      findings: () => this.cached,
      vaultPath: () => this.vaultPath(),
      suppress: (finding) => this.suppress(finding),
      recheck: () => this.recheck(),
      status: () => this.state,
    }));

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass('prosebind-status');
    this.statusBar.addEventListener('click', () => void this.revealSidebar());
    this.updateStatusBar();

    this.addSettingTab(new ProsebindSettingTab(this.app, this, {
      settings: this.settings,
      saveSettings: () => this.saveSettings(),
      restart: () => this.restart(),
    }));

    this.addCommand({
      id: 'open-continuity',
      name: 'Open continuity sidebar',
      callback: () => void this.revealSidebar(),
    });
    this.addCommand({
      id: 'recheck',
      name: 'Recheck continuity',
      callback: () => void this.recheck(),
    });
    this.addCommand({
      id: 'restart-server',
      name: 'Restart language server',
      callback: () => void this.restart(),
    });

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile) void this.openFile(file);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, info) => {
        const file = info.file;
        if (!file) return;
        this.queueChange(file, editor.getValue());
      }),
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile)) return;
        // The bible is canon: when it changes the server re-checks everything, because
        // one edited attribute can change the verdict on any scene in the book.
        if (file.path.startsWith('.prosebind/')) {
          this.client?.bibleChanged(this.absolute(file.path));
        }
      }),
    );

    // Starting the server is deferred until the workspace is ready, so a slow spawn
    // never delays Obsidian's own startup.
    this.app.workspace.onLayoutReady(() => void this.start());
  }

  override async onunload(): Promise<void> {
    if (this.sendTimer !== undefined) window.clearTimeout(this.sendTimer);
    await this.client?.stop();
    this.client = undefined;
  }

  // --- lifecycle -----------------------------------------------------------

  private vaultPath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }

  private absolute(vaultRelative: string): string {
    const base = this.vaultPath();
    return base ? `${base}/${vaultRelative}` : vaultRelative;
  }

  private async start(): Promise<void> {
    const vaultPath = this.vaultPath();
    if (!vaultPath) {
      this.setState('failed', 'Prosebind needs a local vault folder.');
      return;
    }

    this.client = new ProsebindClient({
      serverPath: this.settings.serverPath,
      vaultPath,
      debounceMs: this.settings.debounceMs,
      severityFloor: this.settings.severityFloor,
      onFindings: (findings) => {
        this.cached = findings;
        this.updateStatusBar();
        this.refreshView();
      },
      onStatus: (state, detail) => this.setState(state, detail),
      onLog: (message) => console.log(`[prosebind] ${message}`),
    });

    await this.client.start();

    const active = this.app.workspace.getActiveFile();
    if (active) await this.openFile(active);
  }

  private async restart(): Promise<void> {
    await this.client?.stop();
    this.client = undefined;
    this.cached = [];
    await this.start();
  }

  private setState(state: 'starting' | 'ready' | 'failed', detail?: string): void {
    this.state = { state, detail };
    this.updateStatusBar();
    this.refreshView();

    // The only interruption this plugin permits. A silently broken tool is
    // indistinguishable from a manuscript with no problems, and that is the one
    // failure a writer must not be left to discover on their own.
    if (state === 'failed' && detail) {
      new Notice(`Prosebind: ${detail}`, 8000);
    }
  }

  // --- document sync -------------------------------------------------------

  private async openFile(file: TFile): Promise<void> {
    if (file.extension !== 'md' && file.extension !== 'txt') return;
    if (!this.client) return;
    const text = await this.app.vault.read(file);
    this.client.didOpen(this.absolute(file.path), text);
  }

  private queueChange(file: TFile, text: string): void {
    if (!this.client) return;
    if (this.sendTimer !== undefined) window.clearTimeout(this.sendTimer);
    // Two-stage: this throttle only keeps the pipe sane. The decision about when it is
    // polite to actually analyse belongs to the server.
    this.sendTimer = window.setTimeout(() => {
      this.sendTimer = undefined;
      this.client?.didChange(this.absolute(file.path), text, ++this.version);
    }, SEND_INTERVAL_MS);
  }

  // --- ui ------------------------------------------------------------------

  private updateStatusBar(): void {
    if (!this.statusBar) return;

    if (this.state.state === 'starting') {
      this.statusBar.setText('Prosebind: reading…');
      return;
    }
    if (this.state.state === 'failed') {
      this.statusBar.setText('Prosebind: not running');
      return;
    }

    const counts = { contradiction: 0, question: 0, note: 0 };
    for (const finding of this.cached) counts[finding.severity]++;
    const total = counts.contradiction + counts.question + counts.note;

    if (total === 0) {
      this.statusBar.setText('Continuity clear');
      return;
    }
    const parts: string[] = [];
    if (counts.contradiction > 0) parts.push(`${counts.contradiction}×`);
    if (counts.question > 0) parts.push(`${counts.question}?`);
    if (counts.note > 0) parts.push(`${counts.note}·`);
    this.statusBar.setText(parts.join(' '));
  }

  private refreshView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CONTINUITY_VIEW)) {
      const view = leaf.view;
      if (view instanceof ContinuityView) view.render();
    }
  }

  private async revealSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(CONTINUITY_VIEW);
    if (existing.length > 0 && existing[0]) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CONTINUITY_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async suppress(finding: Finding): Promise<void> {
    if (!finding.suppressionKey) return;
    await this.client?.suppress(finding.suppressionKey);
  }

  private async recheck(): Promise<void> {
    await this.client?.recheck();
  }

  // --- settings ------------------------------------------------------------

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<ProsebindSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
