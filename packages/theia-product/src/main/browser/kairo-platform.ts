/**
 * Runtime platform detection for Kairo IDE.
 *
 * Prefer Theia's application-package environment helper (works in
 * browser and Electron builds). Fall back to the desktop preload
 * marker when needed.
 */
import { environment } from '@theia/application-package/lib/environment';

/** True when running inside the Kairo Electron desktop shell. */
export function isKairoElectron(): boolean {
  try {
    if (environment.electron.is()) {
      return true;
    }
  } catch {
    // Fall through to preload probe.
  }
  return typeof (window as KairoDesktopWindow).kairoIPC !== 'undefined'
    || typeof (window as KairoDesktopWindow).electronTheiaCore !== 'undefined';
}

/** True when running in a normal browser tab (Chrome, Edge, etc.). */
export function isKairoBrowser(): boolean {
  return !isKairoElectron();
}

interface KairoDesktopWindow {
  kairoIPC?: unknown;
  electronTheiaCore?: unknown;
}
