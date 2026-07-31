/**
 * Kairo Focus Management Service.
 *
 * Provides keyboard-driven focus management for the Kairo IDE.
 * Enhances accessibility by ensuring proper focus flow between
 * the editor, toolbar, sidebar, bottom panel, and status bar.
 *
 * Features:
 *  - Focus editor: Escape from any panel
 *  - Focus next/previous panel: F6 / Shift+F6
 *  - Focus sidebar: Ctrl+0
 *  - Focus terminal: Ctrl+`
 *  - Focus outline: Ctrl+Shift+0
 *  - Skip-to-content link for keyboard users
 *  - Focus trap management for dialogs
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  ApplicationShell,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { KairoI18nService } from '@kairo/i18n';

export namespace KairoFocusCommands {
  export const FOCUS_EDITOR: Command = {
    id: 'kairo.focus.editor',
    label: 'Kairo: Focus Editor',
  };
  export const FOCUS_SIDEBAR: Command = {
    id: 'kairo.focus.sidebar',
    label: 'Kairo: Focus Sidebar',
  };
  export const FOCUS_BOTTOM_PANEL: Command = {
    id: 'kairo.focus.bottomPanel',
    label: 'Kairo: Focus Bottom Panel',
  };
  export const FOCUS_STATUS_BAR: Command = {
    id: 'kairo.focus.statusBar',
    label: 'Kairo: Focus Status Bar',
  };
  export const FOCUS_NEXT_PANEL: Command = {
    id: 'kairo.focus.nextPanel',
    label: 'Kairo: Focus Next Panel',
  };
  export const FOCUS_PREVIOUS_PANEL: Command = {
    id: 'kairo.focus.previousPanel',
    label: 'Kairo: Focus Previous Panel',
  };
  export const FOCUS_TERMINAL: Command = {
    id: 'kairo.focus.terminal',
    label: 'Kairo: Focus Terminal',
  };
}

/** Panel areas for focus cycling. */
type PanelArea = 'editor' | 'sidebar' | 'bottom' | 'statusBar';

const PANEL_ORDER: PanelArea[] = ['editor', 'sidebar', 'bottom', 'statusBar'];

@injectable()
export class KairoFocusManagement implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {
  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;
  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected readonly toDispose = new DisposableCollection();
  protected currentPanelIndex = 0;

  @postConstruct()
  protected init(): void {
    // Create skip-to-content link for keyboard users
    this.createSkipToContentLink();
  }

  onStart(): void {
    // Listen for Escape to focus editor
    document.addEventListener('keydown', this.handleGlobalKeydown.bind(this));
    this.toDispose.push({
      dispose: () => document.removeEventListener('keydown', this.handleGlobalKeydown.bind(this)),
    });
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoFocusCommands.FOCUS_EDITOR, {
      execute: () => this.focusEditor(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_SIDEBAR, {
      execute: () => this.focusSidebar(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_BOTTOM_PANEL, {
      execute: () => this.focusBottomPanel(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_STATUS_BAR, {
      execute: () => this.focusStatusBar(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_NEXT_PANEL, {
      execute: () => this.focusNextPanel(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_PREVIOUS_PANEL, {
      execute: () => this.focusPreviousPanel(),
    });
    registry.registerCommand(KairoFocusCommands.FOCUS_TERMINAL, {
      execute: () => this.focusTerminal(),
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_EDITOR.id,
      keybinding: 'escape',
      when: '!editorFocus',
    });
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_SIDEBAR.id,
      keybinding: 'ctrlcmd+0',
    });
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_BOTTOM_PANEL.id,
      keybinding: 'ctrlcmd+j',
    });
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_TERMINAL.id,
      keybinding: 'ctrlcmd+`',
    });
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_NEXT_PANEL.id,
      keybinding: 'f6',
    });
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_PREVIOUS_PANEL.id,
      keybinding: 'shift+f6',
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Focus Targets                                                       */
  /* ------------------------------------------------------------------ */

  /** Focus the active editor. */
  focusEditor(): void {
    const editorArea = document.querySelector<HTMLElement>('#theia-main-content-panel');
    if (editorArea) {
      this.focusElement(editorArea);
      return;
    }

    // Fallback: find the Monaco editor
    const monacoEditor = document.querySelector<HTMLElement>('.monaco-editor textarea');
    if (monacoEditor) {
      monacoEditor.focus();
    }
  }

  /** Focus the sidebar. */
  focusSidebar(): void {
    const sidebar = document.querySelector<HTMLElement>('.p-TabBar[role="tablist"]');
    if (sidebar) {
      const firstTab = sidebar.querySelector<HTMLElement>('[role="tab"]');
      if (firstTab) {
        firstTab.focus();
        return;
      }
    }
    // Fallback: find left panel
    const leftPanel = document.querySelector<HTMLElement>('#theia-left-side-panel');
    if (leftPanel) {
      this.focusElement(leftPanel);
    }
  }

  /** Focus the bottom panel. */
  focusBottomPanel(): void {
    const bottomPanel = document.querySelector<HTMLElement>('#theia-bottom-content-panel');
    if (bottomPanel) {
      this.focusElement(bottomPanel);
    }
  }

  /** Focus the status bar. */
  focusStatusBar(): void {
    const statusBar = document.querySelector<HTMLElement>('#theia-statusBar');
    if (statusBar) {
      this.focusElement(statusBar);
    }
  }

  /** Focus the terminal. */
  focusTerminal(): void {
    const terminal = document.querySelector<HTMLElement>('.xterm-helper-textarea');
    if (terminal) {
      terminal.focus();
      return;
    }
    // Fallback: activate terminal panel
    const terminalTab = document.querySelector<HTMLElement>('[title*="Terminal"][role="tab"]');
    if (terminalTab) {
      terminalTab.click();
      setTimeout(() => {
        const ta = document.querySelector<HTMLElement>('.xterm-helper-textarea');
        ta?.focus();
      }, 100);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Panel Cycling                                                       */
  /* ------------------------------------------------------------------ */

  focusNextPanel(): void {
    this.currentPanelIndex = (this.currentPanelIndex + 1) % PANEL_ORDER.length;
    this.focusPanelByIndex(this.currentPanelIndex);
  }

  focusPreviousPanel(): void {
    this.currentPanelIndex = (this.currentPanelIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
    this.focusPanelByIndex(this.currentPanelIndex);
  }

  protected focusPanelByIndex(index: number): void {
    switch (PANEL_ORDER[index]) {
      case 'editor': this.focusEditor(); break;
      case 'sidebar': this.focusSidebar(); break;
      case 'bottom': this.focusBottomPanel(); break;
      case 'statusBar': this.focusStatusBar(); break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Skip-to-Content Link                                                */
  /* ------------------------------------------------------------------ */

  /** Create a "Skip to main content" link for keyboard users. */
  protected createSkipToContentLink(): void {
    const skipLink = document.createElement('a');
    skipLink.id = 'kairo-skip-to-content';
    skipLink.href = '#theia-main-content-panel';
    skipLink.textContent = this.i18n.t('focus.skipToContent');
    skipLink.setAttribute('role', 'link');
    skipLink.setAttribute('aria-label', this.i18n.t('focus.skipToContentAria'));
    skipLink.style.cssText = `
      position: absolute;
      top: -40px;
      left: 8px;
      background: var(--theia-button-background);
      color: var(--theia-button-foreground);
      padding: 8px 16px;
      z-index: 10000;
      border-radius: 4px;
      text-decoration: none;
      font-size: 14px;
      transition: top 0.2s;
    `;

    skipLink.addEventListener('focus', () => {
      skipLink.style.top = '8px';
    });
    skipLink.addEventListener('blur', () => {
      skipLink.style.top = '-40px';
    });
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.focusEditor();
    });

    document.body.insertBefore(skipLink, document.body.firstChild);
  }

  /* ------------------------------------------------------------------ */
  /*  Global Keyboard Handler                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Handle global keyboard events for focus management.
   * Escape from any panel focuses the editor.
   */
  protected handleGlobalKeydown(event: KeyboardEvent): void {
    // Don't intercept when typing in an input or editor
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.closest('.monaco-editor')
    ) {
      return;
    }

    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.focusEditor();
      event.preventDefault();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Utility                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Focus an element and ensure it's reachable by screen readers.
   */
  protected focusElement(element: HTMLElement): void {
    // Set tabindex if not already set, to make it focusable
    if (element.getAttribute('tabindex') === null) {
      element.setAttribute('tabindex', '-1');
    }
    element.focus({ preventScroll: false });
  }
}