/**
 * Pure-JS stub of the `drivelist` package.
 *
 * The upstream `drivelist` package is a native addon. On Windows the
 * Theia build pipeline does not have a working MSVC toolchain in this
 * repository's CI, so the addon cannot be compiled. Theia only uses
 * `drivelist.list()` to populate `EnvVariablesServer.getDrives()`, and
 * Kairo does not depend on a drive list (the user supplies a workspace
 * path explicitly), so returning an empty array is functionally
 * equivalent for Kairo's purposes.
 *
 * Behaviour intentionally matches the upstream callback API so the
 * shim is drop-in compatible with any future code that consumes
 * `drivelist.list`.
 */

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

/**
 * List the available drives. In the stub, this resolves to an empty
 * array. Callers expecting the upstream callback API can wrap the
 * returned promise.
 */
export function list(): Promise<DriveDescriptor[]> {
  return Promise.resolve([]);
}

/**
 * Compatibility wrapper that mirrors the native binding signature
 * `(error, drives) => void` for callers that pass a callback instead
 * of awaiting the returned promise.
 */
export function listCallback(
  cb: (error: Error | null, drives: DriveDescriptor[]) => void,
): void {
  cb(null, []);
}

export default { list, listCallback };
