# -*- coding: utf-8 -*-
import re

filepath = 'G:/spaces/kairo-ide/packages/svn-extension/src/browser/svn-contribution.ts'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports after NavigatorTreeDecorator line
old_import = "import { NavigatorTreeDecorator } from '@theia/navigator/lib/browser/navigator-decorator-service';"
new_import = """import { NavigatorTreeDecorator } from '@theia/navigator/lib/browser/navigator-decorator-service';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import { EditorContextMenu } from '@theia/editor/lib/browser/editor-menu';"""

content = content.replace(old_import, new_import, 1)

# 2. Replace registerMenus to register to both navigator and editor context menus
old_register_menus = '''  registerMenus(registry: MenuModelRegistry): void {
    const submenuPath = [...SVN_CONTEXT_MENU];

    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.UPDATE.id,
      order: '1',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.COMMIT.id,
      order: '2',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.DIFF_SHOW.id,
      order: '3',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SHOW_HISTORY.id,
      order: '4',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.ANNOTATE.id,
      order: '5',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.REFRESH.id,
      order: '6',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.ADD.id,
      order: '7',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.REVERT.id,
      order: '8',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.CLEANUP.id,
      order: '9',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.LOCK.id,
      order: '10',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.UNLOCK.id,
      order: '11',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.RESOLVE.id,
      order: '12',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.IGNORE.id,
      order: '13',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SWITCH.id,
      order: '14',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SHOW_INFO.id,
      order: '15',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.BROWSE_REPO.id,
      order: '16',
    });
  }'''

new_register_menus = '''  registerMenus(registry: MenuModelRegistry): void {
    // Register to file tree / directory tree right-click context menu
    const navigatorMenu = [...NavigatorContextMenu.MODIFICATION, 'svn'];

    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.UPDATE.id,
      order: '1',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.COMMIT.id,
      order: '2',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.DIFF_SHOW.id,
      order: '3',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.SHOW_HISTORY.id,
      order: '4',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.ANNOTATE.id,
      order: '5',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.REFRESH.id,
      order: '6',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.ADD.id,
      order: '7',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.REVERT.id,
      order: '8',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.CLEANUP.id,
      order: '9',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.LOCK.id,
      order: '10',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.UNLOCK.id,
      order: '11',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.RESOLVE.id,
      order: '12',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.IGNORE.id,
      order: '13',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.SWITCH.id,
      order: '14',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.SHOW_INFO.id,
      order: '15',
    });
    registry.registerMenuAction(navigatorMenu, {
      commandId: SvnCommands.BROWSE_REPO.id,
      order: '16',
    });

    // Register to editor / file content right-click context menu
    const editorMenu = [...EditorContextMenu.MODIFICATION, 'svn'];

    registry.registerMenuAction(editorMenu, {
      commandId: SvnCommands.DIFF_SHOW.id,
      order: '3',
    });
    registry.registerMenuAction(editorMenu, {
      commandId: SvnCommands.SHOW_HISTORY.id,
      order: '4',
    });
    registry.registerMenuAction(editorMenu, {
      commandId: SvnCommands.ANNOTATE.id,
      order: '5',
    });
    registry.registerMenuAction(editorMenu, {
      commandId: SvnCommands.ADD.id,
      order: '7',
    });
    registry.registerMenuAction(editorMenu, {
      commandId: SvnCommands.REVERT.id,
      order: '8',
    });
  }'''

content = content.replace(old_register_menus, new_register_menus, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('SVN menus patched successfully')
