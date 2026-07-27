// SPDX-License-Identifier: Apache-2.0
//
// Theia JSON-RPC contract for SVN backend service.
//
// The Theia backend exposes `SvnBackendService` and the browser side
// implements `SvnFrontendClient`. This mirrors java-extension's pattern
// so every child_process / fs call happens in the Node.js backend,
// not in the browser shims which can only throw.

import type {
  SvnInstallation,
  CommandResult,
  SvnInfo,
  SvnStatus,
  SvnLogEntry,
  SvnAnnotation,
  SvnDiffResult,
  SvnCredential,
  SvnResolveChoice,
} from '../browser/svn-types';

export const SvnBackendPath = '/services/svn-backend';

/** Browser → backend: execute SVN commands. The
 *  Theia backend's SvnBackendServiceImpl implements this. */
export const SvnBackendService = Symbol('SvnBackendService');
export interface SvnBackendService {
  /** Detect SVN client installation (calls svn --version etc.). */
  $detectSvn(): Promise<SvnInstallation | undefined>;
  /** Validate a user-provided SVN path. */
  $validatePath(path: string): Promise<SvnInstallation | undefined>;
  /** Execute an arbitrary SVN command via the command queue. */
  $exec(args: string[], cwd: string, type: 'read' | 'write'): Promise<CommandResult>;
  /** Check if a directory is an SVN working copy. */
  $isWcRoot(cwd: string): Promise<boolean>;
  /** Walk up from a directory to find the WC root. */
  $findWcRoot(cwd: string): Promise<string | undefined>;
  /** Get `svn info` for a directory. */
  $getWcInfo(cwd: string): Promise<SvnInfo | undefined>;
  /** Run `svn status` and parse the XML output. */
  $getStatus(cwd: string): Promise<SvnStatus[]>;
  /** Run `svn status` for a single path. */
  $getFileStatus(cwd: string, relPath: string): Promise<SvnStatus | undefined>;
  /** Commit selected files with a message. */
  $commit(cwd: string, files: string[], message: string): Promise<CommandResult>;
  /** Update the WC (or specific files) to a revision. */
  $update(cwd: string, files: string[], revision?: string): Promise<CommandResult>;
  /** Add files to version control. */
  $add(cwd: string, files: string[]): Promise<CommandResult>;
  /** Revert local changes. */
  $revert(cwd: string, files: string[]): Promise<CommandResult>;
  /** Cleanup locks in WC. */
  $cleanup(cwd: string): Promise<CommandResult>;
  /** Delete files from WC (svn delete). */
  $delete(cwd: string, files: string[], force?: boolean): Promise<CommandResult>;
  /** Resolve conflicts with a given choice. */
  $resolve(cwd: string, files: string[], choice: SvnResolveChoice): Promise<CommandResult>;
  /** Lock files. */
  $lock(cwd: string, files: string[], message?: string, steal?: boolean): Promise<CommandResult>;
  /** Unlock files. */
  $unlock(cwd: string, files: string[], breakLock?: boolean): Promise<CommandResult>;
  /** Add patterns to svn:ignore. */
  $ignore(cwd: string, patterns: string[]): Promise<CommandResult>;
  /** Get `svn log` entries. */
  $getLog(cwd: string, files: string[], limit: number, revision?: string): Promise<SvnLogEntry[]>;
  /** Get a single log entry by revision. */
  $getLogEntry(cwd: string, revision: string): Promise<SvnLogEntry | undefined>;
  /** Annotate (blame) a file. */
  $annotate(cwd: string, relPath: string, revision?: string): Promise<SvnAnnotation[]>;
  /** Get diff for WC files. */
  $getDiff(cwd: string, files: string[], revision?: string): Promise<SvnDiffResult>;
  /** Set credentials for subsequent operations. */
  $setCredentials(creds: SvnCredential | undefined): Promise<void>;
  /** Checkout a repository into a target directory. */
  $checkout(url: string, target: string, revision?: string): Promise<CommandResult>;
  /** Cat a file at a specific revision (svn cat -r REV path). Used by Diff to load historical content. */
  $getFileAtRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult>;
  /** Export a single file at a specific revision to a local path. */
  $exportAtRevision(cwd: string, relPath: string, revision: string | number, outPath: string): Promise<CommandResult>;
  /** Revert a file to a specific revision (svn merge -r HEAD:REV path). */
  $revertToRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult>;
}

/** Backend → browser: notifications. Browser side can optionally implement this. */
export const SvnFrontendClient = Symbol('SvnFrontendClient');
export interface SvnFrontendClient {
  /** Called when the SVN service starts or finishes a command. */
  onCommandEvent?(event: { id: string; kind: 'start' | 'end' | 'error'; args: string[]; cwd: string }): void;
}
