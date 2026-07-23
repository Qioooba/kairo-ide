# Kairo IDE 键盘快捷键参考

> 基于 Theia 1.73.x 的快捷键体系。Kairo IDE 自定义快捷键标记为 `kairo.*`。
> Windows/Linux 使用 Ctrl，macOS 使用 Cmd（⌘）。

## 通用 (General)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Command Palette | `Ctrl+Shift+p` | `Cmd+Shift+p` | `workbench.action.showCommands` |
| Quick Open | `Ctrl+p` | `Cmd+p` | `workbench.action.quickOpen` |
| Toggle Panel | `Ctrl+j` | `Cmd+j` | `workbench.action.togglePanel` |
| Toggle Sidebar | `Ctrl+b` | `Cmd+b` | `workbench.action.toggleSidebar` |
| Toggle Maximized Panel | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | `workbench.action.toggleMaximizedPanel` |
| Close Active Editor | `Ctrl+w` | `Cmd+w` | `workbench.action.closeActiveEditor` |
| Close All Editors | `Ctrl+k Ctrl+w` | `Cmd+k Cmd+w` | `workbench.action.closeAllEditors` |
| Reopen Closed Editor | `Ctrl+Shift+t` | `Cmd+Shift+t` | `workbench.action.reopenClosedEditor` |
| Toggle Terminal | `Ctrl+`` | `Cmd+`` | `workbench.action.terminal.toggleTerminal` |
| Open Keyboard Shortcuts | `Ctrl+k Ctrl+s` | `Cmd+k Cmd+s` | `keybindings:open` |

## 搜索 (Search)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| kairo.find.symbol | `Ctrl+Alt+Shift+n` | `Cmd+Option+Shift+n` | `kairo.find.symbol` |
| Find in Editor | `Ctrl+f` | `Cmd+f` | `actions.find` |
| Search in Workspace | `Ctrl+Shift+f` | `Cmd+Shift+f` | `search.action.openSearch` |
| Replace in Workspace | `Ctrl+Shift+h` | `Cmd+Shift+h` | `search.action.replaceAll` |
| Find References | `Shift+f12` | `Shift+f12` | `editor.action.referenceSearch.trigger` |

## 编辑 (Editor)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Save | `Ctrl+s` | `Cmd+s` | `core.save` |
| Save All | `Ctrl+k s` | `Cmd+k s` | `core.saveAll` |
| Undo | `Ctrl+z` | `Cmd+z` | `core.undo` |
| Redo | `Ctrl+Shift+z` | `Cmd+Shift+z` | `core.redo` |
| Cut | `Ctrl+x` | `Cmd+x` | `editor.action.clipboardCutAction` |
| Copy | `Ctrl+c` | `Cmd+c` | `editor.action.clipboardCopyAction` |
| Paste | `Ctrl+v` | `Cmd+v` | `editor.action.clipboardPasteAction` |
| Find and Replace in Editor | `Ctrl+h` | `Cmd+h` | `editor.action.startFindReplaceAction` |
| Select All | `Ctrl+a` | `Cmd+a` | `editor.action.selectAll` |
| Toggle Comment | `Ctrl+/` | `Cmd+/` | `editor.action.commentLine` |
| Toggle Block Comment | `Ctrl+Shift+/` | `Cmd+Shift+/` | `editor.action.blockComment` |
| Indent | `Ctrl+]` | `Cmd+]` | `editor.action.indentLines` |
| Outdent | `Ctrl+[` | `Cmd+[` | `editor.action.outdentLines` |
| Move Line Up | `Alt+↑` | `Option+↑` | `editor.action.moveLinesUpAction` |
| Move Line Down | `Alt+↓` | `Option+↓` | `editor.action.moveLinesDownAction` |
| Copy Line Up | `Shift+Alt+↑` | `Shift+Option+↑` | `editor.action.copyLinesUpAction` |
| Copy Line Down | `Shift+Alt+↓` | `Shift+Option+↓` | `editor.action.copyLinesDownAction` |
| Delete Line | `Ctrl+Shift+k` | `Cmd+Shift+k` | `editor.action.deleteLines` |
| Insert Line Above | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | `editor.action.insertLineBefore` |
| Insert Line Below | `Ctrl+Enter` | `Cmd+Enter` | `editor.action.insertLineAfter` |
| Format Document | `Shift+Alt+f` | `Shift+Option+f` | `editor.action.formatDocument` |
| Rename Symbol | `f2` | `f2` | `editor.action.rename` |
| Quick Fix | `Ctrl+.` | `Cmd+.` | `editor.action.quickFix` |
| Go to Bracket | `Ctrl+Shift+\` | `Cmd+Shift+\` | `editor.action.goToMatchingBracket` |
| Trigger Suggest | `Ctrl+Space` | `Cmd+Space` | `editor.action.triggerSuggest` |
| Parameter Hints | `Ctrl+Shift+Space` | `Cmd+Shift+Space` | `editor.action.triggerParameterHints` |
| Toggle Word Wrap | `Alt+z` | `Option+z` | `editor.action.toggleWordWrap` |
| Zoom In | `Ctrl+=` | `Cmd+=` | `editor.action.fontZoomIn` |
| Zoom Out | `Ctrl+-` | `Cmd+-` | `editor.action.fontZoomOut` |
| Reset Zoom | `Ctrl+0` | `Cmd+0` | `editor.action.fontZoomReset` |
| Go to Definition | `f12` | `f12` | `editor.action.revealDefinition` |
| Peek Definition | `Alt+f12` | `Option+f12` | `editor.action.peekDefinition` |
| Go to Declaration | `Ctrl+f12` | `Cmd+f12` | `editor.action.revealDeclaration` |
| Go to Type Definition | `Ctrl+Shift+f12` | `Cmd+Shift+f12` | `editor.action.goToTypeDefinition` |
| Go to Implementation | `Ctrl+f12` | `Cmd+f12` | `editor.action.goToImplementation` |
| Show Hover | `Ctrl+k Ctrl+i` | `Cmd+k Cmd+i` | `editor.action.showHover` |
| Next Problem | `f8` | `f8` | `editor.action.marker.next` |
| Previous Problem | `Shift+f8` | `Shift+f8` | `editor.action.marker.prev` |

## 导航 (Navigation)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Navigate Back | `Ctrl+Alt+-` | `Cmd+Option+-` | `workbench.action.navigateBack` |
| Navigate Forward | `Ctrl+Shift+-` | `Cmd+Shift+-` | `workbench.action.navigateForward` |
| Show Call Hierarchy | `Shift+Alt+h` | `Shift+Option+h` | `references-view.showCallHierarchy` |
| Show Type Hierarchy | `Shift+Alt+t` | `Shift+Option+t` | `references-view.showTypeHierarchy` |

## 调试 (Debug)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Start Debugging | `f5` | `f5` | `workbench.action.debug.start` |
| Continue | `f5` | `f5` | `workbench.action.debug.continue` |
| Pause | `f6` | `f6` | `workbench.action.debug.pause` |
| Step Over | `f10` | `f10` | `workbench.action.debug.stepOver` |
| Step Into | `f11` | `f11` | `workbench.action.debug.stepInto` |
| Step Out | `Shift+f11` | `Shift+f11` | `workbench.action.debug.stepOut` |
| Stop Debugging | `Shift+f5` | `Shift+f5` | `workbench.action.debug.stop` |
| Restart Debugging | `Ctrl+Shift+f5` | `Cmd+Shift+f5` | `workbench.action.debug.restart` |
| Toggle Breakpoint | `f9` | `f9` | `editor.debug.action.toggleBreakpoint` |
| Show Debug View | `Ctrl+Shift+d` | `Cmd+Shift+d` | `workbench.action.debug.configure` |

## Git

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Stage | `Ctrl+Shift+a g` | `Cmd+Shift+a g` | `git.stage` |
| Stage All | `Ctrl+Shift+a a` | `Cmd+Shift+a a` | `git.stageAll` |
| Commit | `Ctrl+Enter` | `Cmd+Enter` | `git.commit` |

## Java 重构 (Refactoring)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Organize Imports | `Shift+Alt+o` | `Shift+Option+o` | `java.action.organizeImports` |
| Extract Method | `Ctrl+Shift+Alt+m` | `Cmd+Shift+Option+m` | `java.action.refactor.extractMethod` |
| Safe Delete | `Alt+Delete` | `Option+Delete` | `java.action.safeDelete` |

## 其他 (Other)

| 功能 | Windows/Linux | macOS | 命令 ID |
|------|--------------|------|--------|
| Open Workspace | `Ctrl+o` | `Cmd+o` | `workspace:open` |
| Open File | `Ctrl+o` | `Cmd+o` | `workspace:openFile` |

