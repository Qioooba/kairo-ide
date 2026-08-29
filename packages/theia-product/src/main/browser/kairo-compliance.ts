/**
 * Kairo 合规性套件 — §8.5 P3-OBS-06
 *
 * 提供审计日志、合规导出和访问控制矩阵功能。
 *
 * 功能：
 *   - 审计日志：记录所有重要用户操作
 *   - 合规导出：导出设置、Keymap、连接配置（不含密码）、审计日志、诊断数据
 *   - 访问控制矩阵：定义角色和权限，支持只读查看模式
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StorageService } from '@theia/core/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { KairoAuditLog, type AuditActionType, type AuditLogFilter } from './kairo-audit-log';

/** 用户角色定义。 */
export type UserRole = 'developer' | 'viewer' | 'admin';

/** 操作定义。 */
export type Operation =
  | 'file.edit'
  | 'file.save'
  | 'file.create'
  | 'file.delete'
  | 'build.execute'
  | 'deploy.execute'
  | 'debug.start'
  | 'debug.stop'
  | 'sql.execute'
  | 'settings.change'
  | 'keymap.change'
  | 'terminal.open'
  | 'git.commit'
  | 'audit.view'
  | 'audit.export';

/** 角色权限矩阵。 */
const ROLE_PERMISSIONS: Record<UserRole, Operation[]> = {
  developer: [
    'file.edit', 'file.save', 'file.create', 'file.delete',
    'build.execute', 'deploy.execute',
    'debug.start', 'debug.stop',
    'sql.execute',
    'settings.change', 'keymap.change',
    'terminal.open',
    'git.commit',
    'audit.view',
  ],
  viewer: [
    'audit.view',
  ],
  admin: [
    'file.edit', 'file.save', 'file.create', 'file.delete',
    'build.execute', 'deploy.execute',
    'debug.start', 'debug.stop',
    'sql.execute',
    'settings.change', 'keymap.change',
    'terminal.open',
    'git.commit',
    'audit.view', 'audit.export',
  ],
};

/** 合规导出配置。 */
export interface ComplianceExportConfig {
  /** 是否包含设置。 */
  includeSettings: boolean;
  /** 是否包含 Keymap。 */
  includeKeymaps: boolean;
  /** 是否包含连接配置（不含密码）。 */
  includeConnectionConfigs: boolean;
  /** 是否包含审计日志。 */
  includeAuditLogs: boolean;
  /** 是否包含诊断数据。 */
  includeDiagnostics: boolean;
  /** ZIP 密码保护（可选）。 */
  password?: string;
}

/** 合规导出结果。 */
export interface ComplianceExportResult {
  /** 导出数据（JSON 格式）。 */
  data: string;
  /** 导出时间。 */
  exportTime: string;
  /** 包含的模块列表。 */
  includedModules: string[];
  /** 文件大小（字节）。 */
  size: number;
}

/** 当前角色状态。 */
export interface RoleState {
  currentRole: UserRole;
  availableRoles: UserRole[];
  permissions: Operation[];
}

const STORAGE_KEY_ROLE = 'kairo.compliance.role';

@injectable()
export class KairoComplianceSuite {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;
  @inject(KairoAuditLog) protected readonly auditLog!: KairoAuditLog;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected currentRole: UserRole = 'developer';

  get role(): RoleState {
    return {
      currentRole: this.currentRole,
      availableRoles: ['developer', 'viewer', 'admin'],
      permissions: ROLE_PERMISSIONS[this.currentRole],
    };
  }

  get isReadOnly(): boolean {
    return this.currentRole === 'viewer';
  }

  get isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

  @postConstruct()
  protected init(): void {
    void this.initAsync();
  }

  protected async initAsync(): Promise<void> {
    this.logger.info('合规性套件已初始化');
    await this.loadRole();
  }

  /**
   * 检查当前角色是否有权限执行指定操作。
   */
  canPerform(operation: Operation): boolean {
    return ROLE_PERMISSIONS[this.currentRole].includes(operation);
  }

  /**
   * 切换用户角色。
   */
  async switchRole(role: UserRole): Promise<void> {
    this.currentRole = role;
    await this.storage.setData(STORAGE_KEY_ROLE, role);
    this.logger.info(`角色已切换为: ${role}`);

    await this.auditLog.log('command.execute', `switchRole:${role}`, 'success');

    const roleLabels: Record<UserRole, string> = {
      developer: this.i18n.t('compliance.role.developer'),
      viewer: this.i18n.t('compliance.role.viewer'),
      admin: this.i18n.t('compliance.role.admin'),
    };

    this.messages.info(this.i18n.t('compliance.role.switched', { role: roleLabels[role] }));

    if (role === 'viewer') {
      this.messages.warn(this.i18n.t('compliance.readonly.dialog'));
    }
  }

  /**
   * 记录审计日志。
   */
  async logAction(
    action: AuditActionType,
    target: string,
    result: 'success' | 'failure' | 'cancelled' = 'success',
    details?: string,
  ): Promise<void> {
    await this.auditLog.log(action, target, result, details);
  }

  /**
   * 导出合规数据。
   * 导出所有设置、Keymap、连接配置（不含密码）、审计日志和诊断数据。
   */
  async exportComplianceData(config: ComplianceExportConfig): Promise<ComplianceExportResult> {
    const includedModules: string[] = [];
    const exportData: Record<string, unknown> = {
      exportTime: new Date().toISOString(),
      role: this.currentRole,
    };

    // 导出设置
    if (config.includeSettings) {
      try {
        const settings = this.collectSettings();
        exportData.settings = settings;
        includedModules.push(this.i18n.t('compliance.export.settings'));
      } catch (err) {
        this.logger.warn(`导出设置失败: ${String(err)}`);
      }
    }

    // 导出 Keymap
    if (config.includeKeymaps) {
      try {
        const keymaps = this.collectKeymaps();
        exportData.keymaps = keymaps;
        includedModules.push(this.i18n.t('compliance.export.keymaps'));
      } catch (err) {
        this.logger.warn(`导出 Keymap 失败: ${String(err)}`);
      }
    }

    // 导出连接配置（不含密码）
    if (config.includeConnectionConfigs) {
      try {
        const connConfigs = this.collectConnectionConfigs();
        exportData.connectionConfigs = connConfigs;
        includedModules.push(this.i18n.t('compliance.export.connectionConfigs'));
      } catch (err) {
        this.logger.warn(`导出连接配置失败: ${String(err)}`);
      }
    }

    // 导出审计日志
    if (config.includeAuditLogs) {
      try {
        const auditData = JSON.parse(this.auditLog.exportToJSON());
        exportData.auditLogs = auditData;
        includedModules.push(this.i18n.t('compliance.export.auditLogs'));
      } catch (err) {
        this.logger.warn(`导出审计日志失败: ${String(err)}`);
      }
    }

    // 导出诊断数据
    if (config.includeDiagnostics) {
      try {
        const diagnostics = this.collectDiagnostics();
        exportData.diagnostics = diagnostics;
        includedModules.push(this.i18n.t('compliance.export.diagnostics'));
      } catch (err) {
        this.logger.warn(`导出诊断数据失败: ${String(err)}`);
      }
    }

    const jsonStr = JSON.stringify(exportData, null, 2);

    const result: ComplianceExportResult = {
      data: jsonStr,
      exportTime: new Date().toISOString(),
      includedModules,
      size: new Blob([jsonStr]).size,
    };

    await this.auditLog.log('command.execute', 'compliance.export', 'success', this.i18n.t('compliance.export.modulesDetail', { modules: includedModules.join(', ') }));

    return result;
  }

  /**
   * 获取审计日志统计信息。
   */
  getAuditStats() {
    return this.auditLog.getStats();
  }

  /**
   * 搜索审计日志。
   */
  searchAuditLogs(filter: AuditLogFilter) {
    return this.auditLog.getEntries(filter);
  }

  /**
   * 导出审计日志为 JSON。
   */
  exportAuditLogJSON(filter?: AuditLogFilter): string {
    return this.auditLog.exportToJSON(filter);
  }

  /**
   * 导出审计日志为 CSV。
   */
  exportAuditLogCSV(filter?: AuditLogFilter): string {
    return this.auditLog.exportToCSV(filter);
  }

  /**
   * 获取角色权限矩阵文档。
   */
  getAccessControlMatrix(): Record<UserRole, Operation[]> {
    return ROLE_PERMISSIONS;
  }

  // ── Internal ──────────────────────────────────────────────────

  protected collectSettings(): Record<string, unknown> {
    // 收集所有 localStorage 中的设置（排除密码相关的 key）
    const settings: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        // 跳过密码和敏感数据
        if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')) {
          continue;
        }
        try {
          const value = localStorage.getItem(key);
          if (value) {
            try {
              settings[key] = JSON.parse(value);
            } catch {
              settings[key] = value;
            }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // localStorage not available
    }
    return settings;
  }

  protected collectKeymaps(): Record<string, unknown> {
    const keymaps: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.toLowerCase().includes('keymap') || key.toLowerCase().includes('keybind')) {
          try {
            const value = localStorage.getItem(key);
            if (value) {
              try {
                keymaps[key] = JSON.parse(value);
              } catch {
                keymaps[key] = value;
              }
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // localStorage not available
    }
    return keymaps;
  }

  protected collectConnectionConfigs(): Record<string, unknown> {
    const configs: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.toLowerCase().includes('connection') || key.toLowerCase().includes('server') || key.toLowerCase().includes('host')) {
          // 跳过密码
          if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) continue;
          try {
            const value = localStorage.getItem(key);
            if (value) {
              try {
                const parsed = JSON.parse(value);
                // 移除可能的密码字段
                if (typeof parsed === 'object' && parsed !== null) {
                  delete parsed.password;
                  delete parsed.passwd;
                  delete parsed.secret;
                  delete parsed.token;
                }
                configs[key] = parsed;
              } catch {
                configs[key] = value;
              }
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // localStorage not available
    }
    return configs;
  }

  protected collectDiagnostics(): Record<string, unknown> {
    return {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
      timestamp: new Date().toISOString(),
      memoryUsage: typeof performance !== 'undefined'
        ? (performance as unknown as { memory?: string | { usedJSHeapSize: number } }).memory || 'unknown'
        : 'unknown',
    };
  }

  protected async loadRole(): Promise<void> {
    try {
      const data = await this.storage.getData<UserRole>(STORAGE_KEY_ROLE);
      if (data && ['developer', 'viewer', 'admin'].includes(data)) {
        this.currentRole = data;
      }
    } catch {
      this.currentRole = 'developer';
    }
  }
}