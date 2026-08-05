/**
 * Browser keyboard guard — prevents Chrome from consuming IDE shortcuts.
 *
 * In Electron, the native shell owns Ctrl+N/W/T, F5, etc. In a normal
 * browser tab those chords are handled by Chrome before Theia's
 * KeybindingRegistry runs. We intercept them on the capture phase and
 * call preventDefault() so Kairo's IDEA keymap can handle them instead.
 *
 * Electron desktop is not affected (guard is disabled there).
 */

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { isOSX } from '@theia/core/lib/common/os';
import { isKairoBrowser } from './kairo-platform';

/** Chords that Chrome reserves globally and Kairo also uses (Windows/Linux). */
const GUARDED_CHORDS_WIN = new Set([
  // Chrome browser chrome
  'ctrl+n', 'ctrl+t', 'ctrl+w', 'ctrl+shift+t', 'ctrl+shift+n', 'ctrl+shift+w',
  'ctrl+tab', 'ctrl+shift+tab', 'ctrl+pageup', 'ctrl+pagedown',
  'f5', 'ctrl+r', 'ctrl+p', 'ctrl+shift+delete',
  // IDEA / Kairo keymap (packages/theia-product/.../kairo-idea-windows-keymap.ts)
  'ctrl+z', 'ctrl+shift+z', 'ctrl+x', 'ctrl+c', 'ctrl+v', 'ctrl+/', 'ctrl+shift+/',
  'ctrl+alt+l', 'ctrl+alt+o', 'shift+f6', 'ctrl+y', 'ctrl+d', 'ctrl+shift+w',
  'shift+enter', 'ctrl+alt+enter', 'ctrl+shift+enter', 'alt+enter', 'ctrl+space',
  'ctrl+shift+space', 'ctrl+p', 'ctrl+q', 'f2', 'shift+f2', 'ctrl+-', 'ctrl+=',
  'ctrl+shift+-', 'ctrl+shift+=', 'ctrl+shift+j', 'alt+j', 'ctrl+alt+shift+j',
  'alt+shift+insert', 'ctrl+shift+n', 'ctrl+shift+alt+n', 'ctrl+shift+a', 'ctrl+g',
  'ctrl+b', 'ctrl+shift+i', 'ctrl+alt+b', 'ctrl+shift+b', 'ctrl+u', 'alt+f7',
  'ctrl+alt+f7', 'ctrl+alt+left', 'ctrl+alt+right', 'ctrl+e', 'ctrl+shift+m',
  'f4', 'ctrl+h', 'ctrl+alt+h', 'ctrl+f12', 'ctrl+shift+e', 'ctrl+shift+backspace',
  'ctrl+shift+f', 'ctrl+shift+r', 'ctrl+f', 'ctrl+r', 'f3', 'shift+f3',
  'ctrl+f9', 'ctrl+shift+f9', 'shift+f10', 'shift+f9', 'ctrl+f2', 'ctrl+f8',
  'ctrl+shift+f8', 'f8', 'f7', 'shift+f8', 'f9', 'alt+f9',
  'ctrl+s', 'alt+f12', 'ctrl+shift+k', 'ctrl+f4', 'ctrl+shift+f12', 'ctrl+alt+s',
  'alt+right', 'alt+left', 'ctrl+shift+f4',
  'alt+1', 'alt+2', 'alt+3', 'alt+4', 'alt+5', 'alt+6', 'alt+7', 'alt+9',
  'shift+escape', 'f11', 'ctrl+f11', 'shift+f11',
  'alt+insert', 'ctrl+o', 'ctrl+i', 'ctrl+alt+t', 'ctrl+shift+delete',
  'alt+/', 'alt+shift+/', 'ctrl+alt+shift+j', 'ctrl+shift+alt+t',
  'ctrl+alt+m', 'ctrl+alt+v', 'ctrl+alt+c', 'ctrl+alt+f', 'ctrl+f6', 'ctrl+shift+c',
  'ctrl+shift+v', 'ctrl+a', 'ctrl+home', 'ctrl+end', 'ctrl+shift+home', 'ctrl+shift+end',
]);

/** Chords guarded in browser mode on macOS (Cmd-based IDEA map). */
const GUARDED_CHORDS_MAC = new Set([
  'cmd+n', 'cmd+t', 'cmd+w', 'cmd+shift+t', 'cmd+shift+n', 'cmd+shift+w',
  'cmd+tab', 'cmd+shift+tab', 'cmd+option+left', 'cmd+option+right',
  'f5', 'cmd+r', 'cmd+p', 'cmd+shift+delete',
  'cmd+z', 'cmd+shift+z', 'cmd+x', 'cmd+c', 'cmd+v', 'cmd+/',
  'cmd+alt+/', 'cmd+alt+l', 'ctrl+alt+o', 'shift+f6', 'cmd+backspace', 'cmd+d',
  'alt+up', 'alt+down', 'cmd+alt+enter', 'cmd+shift+enter', 'alt+enter',
  'ctrl+space', 'ctrl+shift+space', 'cmd+p', 'ctrl+j', 'f2', 'shift+f2',
  'cmd+-', 'cmd+=', 'cmd+shift+-', 'cmd+shift+=', 'ctrl+shift+j', 'alt+j',
  'cmd+ctrl+shift+j', 'cmd+shift+8', 'cmd+o', 'cmd+shift+o', 'cmd+alt+o',
  'cmd+shift+a', 'cmd+l', 'cmd+b', 'cmd+shift+i', 'cmd+alt+b', 'alt+f7',
  'cmd+alt+f7', 'cmd+[', 'cmd+]', 'cmd+e', 'cmd+shift+e', 'ctrl+shift+m',
  'f4', 'ctrl+h', 'cmd+f12', 'cmd+shift+f', 'cmd+shift+r', 'cmd+f', 'cmd+r',
  'cmd+g', 'cmd+shift+g', 'cmd+f9', 'cmd+shift+f9', 'ctrl+shift+r', 'ctrl+shift+d',
  'cmd+f2', 'cmd+f8', 'cmd+shift+f8', 'f8', 'f7', 'shift+f8', 'cmd+alt+r', 'alt+f9',
  'cmd+s', 'alt+f12', 'cmd+shift+k', 'cmd+w', 'ctrl+cmd+f', 'cmd+,',
  'cmd+shift+]', 'cmd+shift+[', 'cmd+shift+w',
  'cmd+1', 'cmd+2', 'cmd+3', 'cmd+4', 'cmd+5', 'cmd+6', 'cmd+7', 'cmd+9',
  'escape', 'f11', 'cmd+f11', 'shift+f11',
  'cmd+n', 'ctrl+o', 'ctrl+i', 'cmd+alt+t', 'cmd+shift+delete',
  'alt+/', 'alt+shift+/', 'cmd+alt+j', 'ctrl+t', 'cmd+alt+m', 'cmd+alt+v',
  'cmd+alt+c', 'cmd+alt+f', 'cmd+f6', 'cmd+a', 'cmd+home', 'cmd+end',
  'cmd+shift+home', 'cmd+shift+end',
]);

function normalizeKey(key: string): string {
  if (key === ' ') {
    return 'space';
  }
  if (key === 'ArrowLeft') {
    return 'left';
  }
  if (key === 'ArrowRight') {
    return 'right';
  }
  if (key === 'ArrowUp') {
    return 'up';
  }
  if (key === 'ArrowDown') {
    return 'down';
  }
  if (key === 'Backspace') {
    return 'backspace';
  }
  if (key === 'Delete') {
    return 'delete';
  }
  if (key === 'Escape') {
    return 'escape';
  }
  if (key === 'Enter') {
    return 'enter';
  }
  if (key === 'Insert') {
    return 'insert';
  }
  if (key.length === 1) {
    return key.toLowerCase();
  }
  if (/^f\d+$/i.test(key)) {
    return key.toLowerCase();
  }
  return key.toLowerCase();
}

function eventToChord(event: KeyboardEvent): string | undefined {
  if (event.isComposing || event.key === 'Process' || !event.key) {
    return undefined;
  }

  const parts: string[] = [];
  if (isOSX) {
    if (event.metaKey) {
      parts.push('cmd');
    }
    if (event.ctrlKey) {
      parts.push('ctrl');
    }
    if (event.altKey) {
      parts.push('alt');
    }
  } else {
    if (event.ctrlKey) {
      parts.push('ctrl');
    }
    if (event.metaKey) {
      parts.push('meta');
    }
    if (event.altKey) {
      parts.push('alt');
    }
  }
  if (event.shiftKey) {
    parts.push('shift');
  }

  parts.push(normalizeKey(event.key));
  return parts.join('+');
}

function shouldGuardChord(chord: string): boolean {
  const guarded = isOSX ? GUARDED_CHORDS_MAC : GUARDED_CHORDS_WIN;
  return guarded.has(chord);
}

@injectable()
export class KairoBrowserKeyboardGuardContribution implements FrontendApplicationContribution {
  protected readonly keydown = (event: KeyboardEvent): void => {
    const chord = eventToChord(event);
    if (!chord || !shouldGuardChord(chord)) {
      return;
    }
    // Let the Search Center modal handle its own Ctrl/Cmd+Shift+F typing.
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-testid="search-center-modal"]')) {
      return;
    }
    event.preventDefault();
    // Do not stopPropagation — Theia KeybindingRegistry must still receive the event.
  };

  onStart(_app: FrontendApplication): void {
    if (!isKairoBrowser()) {
      return;
    }
    window.addEventListener('keydown', this.keydown, true);
  }

  onStop(): void {
    window.removeEventListener('keydown', this.keydown, true);
  }
}
