import { injectable } from '@theia/core/shared/inversify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SvnInstallation } from './svn-types';
import { parseVersionString } from './svn-parser';

const execFileAsync = promisify(execFile);

const WINDOWS_CANDIDATE_PATHS = [
  'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
  'C:\\Program Files\\CollabNet\\Subversion Client\\svn.exe',
  'C:\\Program Files\\VisualSVN\\bin\\svn.exe',
  'C:\\cygwin64\\bin\\svn.exe',
  'C:\\Program Files\\Git\\usr\\bin\\svn.exe',
  'C:\\ProgramData\\chocolatey\\bin\\svn.exe',
  'C:\\Program Files\\WANdisco\\Subversion\\bin\\svn.exe',
];

const MAC_CANDIDATE_PATHS = [
  '/usr/bin/svn',
  '/usr/local/bin/svn',
  '/opt/subversion/bin/svn',
  '/opt/homebrew/bin/svn',
];

const LINUX_CANDIDATE_PATHS = [
  '/usr/bin/svn',
  '/usr/local/bin/svn',
];

@injectable()
export class SvnDetector {
  protected cachedInstallation: SvnInstallation | undefined;
  protected userConfiguredPath: string | undefined;

  setUserConfiguredPath(p: string | undefined): void {
    this.userConfiguredPath = p;
    this.invalidateCache();
  }

  getCached(): SvnInstallation | undefined {
    return this.cachedInstallation;
  }

  invalidateCache(): void {
    this.cachedInstallation = undefined;
  }

  async detect(): Promise<SvnInstallation | undefined> {
    if (this.cachedInstallation) {
      return this.cachedInstallation;
    }

    if (this.userConfiguredPath) {
      const result = await this.validatePath(this.userConfiguredPath);
      if (result) {
        this.cachedInstallation = result;
        return result;
      }
    }

    const pathResult = await this.tryExecPath('svn', 'path');
    if (pathResult) {
      this.cachedInstallation = pathResult;
      return pathResult;
    }

    const candidates = this.getCandidatePaths();
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const result = await this.validatePath(candidate);
        if (result) {
          this.cachedInstallation = { ...result, source: 'common-location' };
          return this.cachedInstallation;
        }
      }
    }

    if (os.platform() === 'win32') {
      const regResult = await this.tryRegistryDetection();
      if (regResult) {
        this.cachedInstallation = regResult;
        return regResult;
      }
    }

    const homeDir = os.homedir();
    const scoopPath = path.join(homeDir, 'scoop', 'shims', 'svn.exe');
    if (os.platform() === 'win32' && fs.existsSync(scoopPath)) {
      const result = await this.validatePath(scoopPath);
      if (result) {
        this.cachedInstallation = { ...result, source: 'common-location' };
        return this.cachedInstallation;
      }
    }

    return undefined;
  }

  async validatePath(svnPath: string): Promise<SvnInstallation | undefined> {
    try {
      const { stdout } = await execFileAsync(svnPath, ['--version', '--quiet'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const versionStr = stdout.trim();
      const parsed = parseVersionString(versionStr);
      return {
        path: svnPath,
        version: parsed.full,
        versionMajor: parsed.major,
        versionMinor: parsed.minor,
        source: 'user-config',
      };
    } catch {
      return undefined;
    }
  }

  protected getCandidatePaths(): string[] {
    const platform = os.platform();
    switch (platform) {
      case 'win32':
        return WINDOWS_CANDIDATE_PATHS;
      case 'darwin':
        return MAC_CANDIDATE_PATHS;
      case 'linux':
        return LINUX_CANDIDATE_PATHS;
      default:
        return [];
    }
  }

  protected async tryExecPath(command: string, source: SvnInstallation['source']): Promise<SvnInstallation | undefined> {
    try {
      const { stdout } = await execFileAsync(command, ['--version', '--quiet'], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      const versionStr = stdout.trim();
      const parsed = parseVersionString(versionStr);
      return {
        path: command,
        version: parsed.full,
        versionMajor: parsed.major,
        versionMinor: parsed.minor,
        source,
      };
    } catch {
      return undefined;
    }
  }

  protected async tryRegistryDetection(): Promise<SvnInstallation | undefined> {
    try {
      const regQuery = async (keyPath: string): Promise<string | undefined> => {
        try {
          const { stdout } = await execFileAsync('reg', ['query', keyPath, '/v', 'InstallDir'], {
            timeout: 3000,
            maxBuffer: 1024 * 1024,
          });
          const match = stdout.match(/InstallDir\s+REG_SZ\s+(.+)/);
          if (match) {
            return match[1].trim();
          }
        } catch {
          return undefined;
        }
        return undefined;
      };

      const regPaths = [
        'HKLM\\SOFTWARE\\TortoiseSVN',
        'HKLM\\SOFTWARE\\Wow6432Node\\TortoiseSVN',
      ];

      for (const regPath of regPaths) {
        const installDir = await regQuery(regPath);
        if (installDir) {
          const svnExe = path.join(installDir, 'bin', 'svn.exe');
          if (fs.existsSync(svnExe)) {
            const result = await this.validatePath(svnExe);
            if (result) {
              return { ...result, source: 'registry' };
            }
          }
        }
      }
    } catch {
      // Registry not available or error
    }
    return undefined;
  }
}
