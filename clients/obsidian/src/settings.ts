import { PluginSettingTab, Setting, type App } from 'obsidian';

export interface ProsebindSettings {
  serverPath: string;
  debounceMs: number;
  severityFloor: 'contradiction' | 'question' | 'note';
}

export const DEFAULT_SETTINGS: ProsebindSettings = {
  serverPath: 'prosebind-lsp',
  // Matches the server's own default. DESIGN.md § 10: nothing is analysed while the
  // writer is still typing.
  debounceMs: 900,
  severityFloor: 'note',
};

export interface SettingsHost {
  settings: ProsebindSettings;
  saveSettings(): Promise<void>;
  restart(): Promise<void>;
}

export class ProsebindSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin: any,
    private readonly host: SettingsHost,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Language server path')
      .setDesc(
        'Path to the prosebind-lsp executable. If a bare name fails, use an absolute path — ' +
          'Obsidian does not always inherit the PATH from your shell, which is the usual reason ' +
          'a globally installed binary works in a terminal but not here.',
      )
      .addText((text) =>
        text
          .setPlaceholder('prosebind-lsp')
          .setValue(this.host.settings.serverPath)
          .onChange(async (value) => {
            this.host.settings.serverPath = value.trim() || DEFAULT_SETTINGS.serverPath;
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Quiet period')
      .setDesc(
        'Milliseconds after your last keystroke before anything is analysed. Prosebind never ' +
          'reports findings while you are typing.',
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 3000, 100)
          .setValue(this.host.settings.debounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.host.settings.debounceMs = value;
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Show')
      .setDesc('Lowest severity to report. Narrow this while drafting if loose ends are distracting.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('contradiction', 'Contradictions only')
          .addOption('question', 'Contradictions and questions')
          .addOption('note', 'Everything')
          .setValue(this.host.settings.severityFloor)
          .onChange(async (value) => {
            this.host.settings.severityFloor = value as ProsebindSettings['severityFloor'];
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Restart language server')
      .setDesc('Apply a changed path, or recover after a failure.')
      .addButton((button) =>
        button.setButtonText('Restart').onClick(async () => {
          await this.host.restart();
          this.display();
        }),
      );

    const note = containerEl.createEl('p', { cls: 'setting-item-description' });
    note.setText(
      'Prosebind needs a continuity bible in your vault: a .prosebind folder created by ' +
        'running "prosebind init" there. It never writes prose, and makes no network calls.',
    );
  }
}
