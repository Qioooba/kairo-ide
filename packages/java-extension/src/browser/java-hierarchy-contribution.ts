/**
 * Java Hierarchy Contribution — registers commands and menus for
 * Call Hierarchy and Type Hierarchy.
 *
 * Commands:
 *   - kairo.java.callHierarchy.showIncoming
 *   - kairo.java.callHierarchy.showOutgoing
 *   - kairo.java.typeHierarchy.showSupertypes
 *   - kairo.java.typeHierarchy.showSubtypes
 *
 * Each command reads the current editor position and opens the
 * JavaHierarchyWidget in the bottom panel.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  ApplicationShell,
  WidgetManager,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import { JavaHierarchyWidget } from './java-hierarchy-widget';

export namespace JavaHierarchyCommands {
  export const SHOW_CALL_HIERARCHY_INCOMING: Command = {
    id: 'kairo.java.callHierarchy.showIncoming',
    label: 'Java: Show Call Hierarchy (Incoming Calls)',
  };
  export const SHOW_CALL_HIERARCHY_OUTGOING: Command = {
    id: 'kairo.java.callHierarchy.showOutgoing',
    label: 'Java: Show Call Hierarchy (Outgoing Calls)',
  };
  export const SHOW_TYPE_HIERARCHY_SUPERTYPES: Command = {
    id: 'kairo.java.typeHierarchy.showSupertypes',
    label: 'Java: Show Type Hierarchy (Supertypes)',
  };
  export const SHOW_TYPE_HIERARCHY_SUBTYPES: Command = {
    id: 'kairo.java.typeHierarchy.showSubtypes',
    label: 'Java: Show Type Hierarchy (Subtypes)',
  };
}

@injectable()
export class JavaHierarchyContribution implements CommandContribution, MenuContribution {
  @inject(WidgetManager)
  protected readonly widgetManager!: WidgetManager;

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_INCOMING, {
      execute: () => this.showHierarchy('call-incoming'),
    });
    registry.registerCommand(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_OUTGOING, {
      execute: () => this.showHierarchy('call-outgoing'),
    });
    registry.registerCommand(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUPERTYPES, {
      execute: () => this.showHierarchy('type-supertypes'),
    });
    registry.registerCommand(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUBTYPES, {
      execute: () => this.showHierarchy('type-subtypes'),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.EDIT, {
      commandId: JavaHierarchyCommands.SHOW_CALL_HIERARCHY_INCOMING.id,
      label: 'Show Call Hierarchy (Incoming Calls)',
      order: 'a50',
    });
    menus.registerMenuAction(CommonMenus.EDIT, {
      commandId: JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUPERTYPES.id,
      label: 'Show Type Hierarchy (Supertypes)',
      order: 'a51',
    });
  }

  protected async showHierarchy(
    mode: 'call-incoming' | 'call-outgoing' | 'type-supertypes' | 'type-subtypes',
  ): Promise<void> {
    const editorWidget = this.editorManager.currentEditor;
    if (!editorWidget) {
      return;
    }

    const editor = editorWidget.editor;
    const uri = editor.document.uri.toString();
    const cursor = editor.cursor;
    const line = cursor ? cursor.line : 0;
    const character = cursor ? cursor.character : 0;

    const widget = await this.widgetManager.getOrCreateWidget(JavaHierarchyWidget.ID) as JavaHierarchyWidget;

    try {
      this.shell.addWidget(widget, { area: 'bottom' });
    } catch (_e) {
      // Already attached
    }

    if (mode === 'call-incoming' || mode === 'call-outgoing') {
      await widget.showCallHierarchy(mode, uri, line, character);
    } else {
      await widget.showTypeHierarchy(mode, uri, line, character);
    }

    this.shell.activateWidget(widget.id);
    widget.update();
  }
}