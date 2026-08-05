/**
 * Pure-JS implementation of the `drivelist` package.
 *
 * The upstream `drivelist` package is a native addon that cannot be
 * compiled in this repository's Windows CI without a C++ toolchain.
 * This module lists drives without native bindings so Theia's
 * EnvVariablesServer.getDrives() can populate the file-import dialog.
 */

import fs from 'fs';
import os from 'os';

export interface DriveMountpoint {
  path: string;
  label?: string;
}

export interface DriveDescriptor {
  device: string;
  description: string;
  mountpoints: DriveMountpoint[];
  size?: number;
  isReadOnly?: boolean;
  isSystem?: boolean;
  isVirtual?: boolean;
  isRemovable?: boolean;
  isCard?: boolean;
  isSCSI?: boolean;
  isUSB?: boolean;
  isUAS?: boolean;
  busType?: string;
  busVersion?: string;
  devicePath?: string;
  raw?: string;
  error?: string;
}

function listWindowsDrives(): DriveDescriptor[] {
  const drives: DriveDescriptor[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      fs.accessSync(root, fs.constants.F_OK);
      drives.push({
        device: root,
        description: `Local Disk (${letter}:)`,
        mountpoints: [{ path: root, label: `${letter}:` }],
        isSystem: letter === 'C',
        isRemovable: letter !== 'C',
      });
    } catch {
      // Drive letter not present or not accessible.
    }
  }
  return drives;
}

function listUnixDrives(): DriveDescriptor[] {
  return [{
    device: '/',
    description: 'Root',
    mountpoints: [{ path: '/', label: '/' }],
    isSystem: true,
  }];
}

function listDrives(): DriveDescriptor[] {
  if (os.platform() === 'win32') {
    return listWindowsDrives();
  }
  return listUnixDrives();
}

/**
 * List the available drives. On Windows, probes A–Z for accessible
 * volume roots. On Unix, returns the root mount.
 */
export function list(): Promise<DriveDescriptor[]> {
  return Promise.resolve(listDrives());
}

/**
 * Compatibility wrapper that mirrors the native binding signature
 * `(error, drives) => void` for callers that pass a callback instead
 * of awaiting the returned promise.
 */
export function listCallback(
  cb: (error: Error | null, drives: DriveDescriptor[]) => void,
): void {
  cb(null, listDrives());
}

export default { list, listCallback };
