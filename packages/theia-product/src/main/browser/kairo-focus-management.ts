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
  export const HIDE_ACTIVE_PANEL: Command = {
    id: 'kairo.hideActivePanel',
    label: 'Kairo: Hide Active Panel',
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

  protected readonly globalKeydownHandler = (event: KeyboardEvent): void => this.handleGlobalKeydown(event);

  onStart(): void {
    // Listen for Escape to focus editor. Must run at CAPTURE phase: widgets
    // such as the file tree consume plain Escape at target level (cancel
    // type-ahead) and never let it reach the bubble phase, which silently
    // disabled the TC-CMD-003 contract. Inputs/dialogs keep native Escape
    // handling via the target guards in handleGlobalKeydown
    // (BUG-20260826-303 contract preserved).
    document.addEventListener('keydown', this.globalKeydownHandler, true);
    this.toDispose.push({
      dispose: () => document.removeEventListener('keydown', this.globalKeydownHandler, true),
    });
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoFocusCommands.FOCUS_EDITOR, {
      execute: () => this.focusEditor(),
    });
    registry.registerCommand(KairoFocusCommands.HIDE_ACTIVE_PANEL, {
      execute: () => this.hideActivePanel(),
      isEnabled: () => true,
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
    // IDEA: Escape focuses the editor / hides active tool window.
    // Do NOT bind Shift+F6 (Rename), Ctrl/Cmd+J, Ctrl/Cmd+`, or Ctrl/Cmd+0 —
    // those are VS Code leftovers that steal IDEA chords.
    //
    // BUG-20260826-303: do NOT register Escape → FOCUS_EDITOR as a keybinding.
    // The KeybindingRegistry listens on document CAPTURE and swallows the
    // event (preventDefault + stopPropagation) after dispatching, which
    // prevented dialogs from ever receiving Escape (Cancel/ESC dead). The
    // global keydown handler below implements the same behavior with proper
    // target checks (inputs/dialogs excluded) at bubble phase.
    keybindings.registerKeybinding({
      command: KairoFocusCommands.FOCUS_NEXT_PANEL.id,
      keybinding: 'f6',
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

  /**
   * IDEA Shift+Escape: hide the active tool window. Hides the bottom
   * panel when visible, otherwise collapses the focused side panel.
   */
  async hideActivePanel(): Promise<void> {
    const shell = this.shell as unknown as {
      bottomPanel?: { isHidden?: boolean; setHidden?(v: boolean): void };
      leftPanelHandler?: { collapse?(): Promise<void> | void };
      rightPanelHandler?: { collapse?(): Promise<void> | void };
    };
    if (shell.bottomPanel && !shell.bottomPanel.isHidden && typeof shell.bottomPanel.setHidden === 'function') {
      shell.bottomPanel.setHidden(true);
      return;
    }
    // Fall back to whichever side panel currently holds focus.
    const active = this.shell.activeWidget;
    const inLeft = active ? !!active.node.closest('#theia-left-side-panel') : false;
    if (inLeft && shell.leftPanelHandler?.collapse) {
      await shell.leftPanelHandler.collapse();
      return;
    }
    const inRight = active ? !!active.node.closest('#theia-right-side-panel') : false;
    if (inRight && shell.rightPanelHandler?.collapse) {
      await shell.rightPanelHandler.collapse();
    }
  }

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
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    // Don't intercept when typing in an input or editor, and let Theia
    // dialogs and role=dialog overlays (Find Action, …) own their Escape.
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.closest('.monaco-editor') ||
      target.closest('#theia-dialog-shell') ||
      target.closest('[role="dialog"]')
    ) {
      return;
    }
    this.focusEditor();
    event.preventDefault();
    event.stopPropagation();
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