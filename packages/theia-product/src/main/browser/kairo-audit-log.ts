/**
 * 审计日志服务 — §8.5 P3-OBS-06
 *
 * 独立的审计日志服务，将所有重要用户操作记录到 localStorage。
 * 自动轮转防止存储溢出。
 *
 * 功能：
 *   - 记录所有重要用户操作
 *   - 自动轮转（超过 10000 条时）
 *   - 搜索和过滤审计日志
 *   - 本地存储，不传输到外部
 *   - 导出为 JSON/CSV
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { StorageService } from '@theia/core/lib/browser';

/** 审计日志条目。 */
export interface AuditLogEntry {
  /** 唯一 ID。 */
  id: string;
  /** ISO 8601 时间戳。 */
  timestamp: string;
  /** 用户标识（匿名化）。 */
  user: string;
  /** 操作类型。 */
  action: AuditActionType;
  /** 操作目标（文件路径、命令等）。 */
  target: string;
  /** 操作结果。 */
  result: 'success' | 'failure' | 'cancelled';
  /** 额外的详细信息。 */
  details?: string;
}

/** 审计日志操作类型。 */
export type AuditActionType =
  | 'file.open'
  | 'file.save'
  | 'file.close'
  | 'file.create'
  | 'file.delete'
  | 'build.start'
  | 'build.end'
  | 'deploy.start'
  | 'deploy.end'
  | 'debug.start'
  | 'debug.stop'
  | 'sql.execute'
  | 'sql.query'
  | 'command.execute'
  | 'settings.change'
  | 'project.open'
  | 'project.close'
  | 'search.execute'
  | 'git.commit'
  | 'git.push'
  | 'git.pull'
  | 'terminal.open'
  | 'terminal.close';

/** 审计日志过滤器。 */
export interface AuditLogFilter {
  /** 按操作类型过滤。 */
  actions?: AuditActionType[];
  /** 按时间范围过滤（起始时间 ISO 字符串）。 */
  startTime?: string;
  /** 按时间范围过滤（结束时间 ISO 字符串）。 */
  endTime?: string;
  /** 按目标过滤（模糊匹配）。 */
  targetFilter?: string;
  /** 按结果过滤。 */
  result?: 'success' | 'failure' | 'cancelled';
  /** 搜索关键词（匹配操作、目标、详情）。 */
  search?: string;
}

/** 审计日志配置。 */
export interface AuditLogConfig {
  /** 最大条目数。 */
  maxEntries: number;
  /** 保留天数。 */
  retentionDays: number;
  /** 是否启用。 */
  enabled: boolean;
}

/** 审计日志统计信息。 */
export interface AuditLogStats {
  /** 总条目数。 */
  totalEntries: number;
  /** 按操作类型分组的计数。 */
  entriesByAction: Record<string, number>;
  /** 最旧条目的时间。 */
  oldestEntry?: string;
  /** 最新条目的时间。 */
  newestEntry?: string;
  /** 是否已启用。 */
  enabled: boolean;
}

const STORAGE_KEY = 'kairo.audit.log';
const STORAGE_KEY_CONFIG = 'kairo.audit.log.config';
const MAX_ENTRIES_DEFAULT = 10_000;
const RETENTION_DAYS_DEFAULT = 30;

@injectable()
export class KairoAuditLog {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(StorageService) protected readonly storage!: StorageService;

  protected entries: AuditLogEntry[] = [];
  protected config: AuditLogConfig = {
    maxEntries: MAX_ENTRIES_DEFAULT,
    retentionDays: RETENTION_DAYS_DEFAULT,
    enabled: true,
  };
  protected entryCounter = 0;

  get auditConfig(): Readonly<AuditLogConfig> {
    return this.config;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  @postConstruct()
  protected async init(): Promise<void> {
    this.logger.info('审计日志服务已初始化');
    await this.loadConfig();
    await this.loadEntries();
    await this.enforceRetention();
  }

  /**
   * 记录一条审计日志。
   */
  async log(
    action: AuditActionType,
    target: string,
    result: 'success' | 'failure' | 'cancelled' = 'success',
    details?: string,
  ): Promise<void> {
    if (!this.config.enabled) return;

    this.entryCounter++;

    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${this.entryCounter}`,
      timestamp: new Date().toISOString(),
      user: 'local-user', // 匿名化用户标识
      action,
      target,
      result,
      details,
    };

    this.entries.push(entry);

    // 自动轮转
    if (this.entries.length > this.config.maxEntries) {
      const excess = this.entries.length - this.config.maxEntries;
      this.entries = this.entries.slice(excess);
      this.logger.info(`审计日志已轮转，移除了 ${excess} 条旧记录`);
    }

    // 每 100 条持久化一次
    if (this.entries.length % 100 === 0) {
      await this.persistEntries();
    }
  }

  /**
   * 获取所有审计日志条目。
   */
  getEntries(filter?: AuditLogFilter): AuditLogEntry[] {
    let result = [...this.entries];

    if (filter) {
      if (filter.actions && filter.actions.length > 0) {
        result = result.filter(e => filter.actions!.includes(e.action));
      }
      if (filter.startTime) {
        result = result.filter(e => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        result = result.filter(e => e.timestamp <= filter.endTime!);
      }
      if (filter.targetFilter) {
        const term = filter.targetFilter.toLowerCase();
        result = result.filter(e => e.target.toLowerCase().includes(term));
      }
      if (filter.result) {
        result = result.filter(e => e.result === filter.result);
      }
      if (filter.search) {
        const term = filter.search.toLowerCase();
        result = result.filter(e =>
          e.action.toLowerCase().includes(term) ||
          e.target.toLowerCase().includes(term) ||
          (e.details && e.details.toLowerCase().includes(term)),
        );
      }
    }

    // 按时间倒序排列
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return result;
  }

  /**
   * 获取审计日志统计信息。
   */
  getStats(): AuditLogStats {
    const entriesByAction: Record<string, number> = {};
    for (const entry of this.entries) {
      entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;
    }

    return {
      totalEntries: this.entries.length,
      entriesByAction,
      oldestEntry: this.entries[0]?.timestamp,
      newestEntry: this.entries[this.entries.length - 1]?.timestamp,
      enabled: this.config.enabled,
    };
  }

  /**
   * 导出审计日志为 JSON。
   */
  exportToJSON(filter?: AuditLogFilter): string {
    const entries = this.getEntries(filter);
    return JSON.stringify(
      {
        exportTime: new Date().toISOString(),
        totalEntries: entries.length,
        config: this.config,
        entries,
      },
      null,
      2,
    );
  }

  /**
   * 导出审计日志为 CSV。
   */
  exportToCSV(filter?: AuditLogFilter): string {
    const entries = this.getEntries(filter);
    const header = '时间,操作,目标,结果,详情\n';
    const rows = entries.map(e => {
      const details = e.details ? `"${e.details.replace(/"/g, '""')}"` : '';
      return `${e.timestamp},${e.action},${e.target},${e.result},${details}`;
    }).join('\n');
    return header + rows;
  }

  /**
   * 启用或禁用审计日志。
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.config.enabled = enabled;
    await this.persistConfig();
    this.logger.info(`审计日志已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * 设置最大条目数。
   */
  async setMaxEntries(maxEntries: number): Promise<void> {
    this.config.maxEntries = maxEntries;
    await this.persistConfig();
    await this.enforceRetention();
  }

  /**
   * 设置保留天数。
   */
  async setRetentionDays(days: number): Promise<void> {
    this.config.retentionDays = days;
    await this.persistConfig();
    await this.enforceRetention();
  }

  /**
   * 清除所有审计日志。
   */
  async clearAll(): Promise<void> {
    this.entries = [];
    this.entryCounter = 0;
    await this.persistEntries();
    this.logger.info('审计日志已清除');
  }

  /**
   * 强制持久化当前日志。
   */
  async flush(): Promise<void> {
    await this.persistEntries();
  }

  // ── Internal ──────────────────────────────────────────────────

  protected async enforceRetention(): Promise<void> {
    if (this.config.retentionDays <= 0) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);
    const cutoffStr = cutoff.toISOString();

    const originalLength = this.entries.length;
    this.entries = this.entries.filter(e => e.timestamp >= cutoffStr);

    if (originalLength !== this.entries.length) {
      this.logger.info(`审计日志保留策略：移除了 ${originalLength - this.entries.length} 条过期记录`);
      await this.persistEntries();
    }
  }

  protected async persistEntries(): Promise<void> {
    try {
      await this.storage.setData(STORAGE_KEY, this.entries);
    } catch {
      // Storage not available
    }
  }

  protected async loadEntries(): Promise<void> {
    try {
      const data = await this.storage.getData<AuditLogEntry[]>(STORAGE_KEY);
      if (data && Array.isArray(data)) {
        this.entries = data;
        this.entryCounter = this.entries.length;
      }
    } catch {
      this.entries = [];
    }
  }

  protected async persistConfig(): Promise<void> {
    try {
      await this.storage.setData(STORAGE_KEY_CONFIG, this.config);
    } catch {
      // Storage not available
    }
  }

  protected async loadConfig(): Promise<void> {
    try {
      const data = await this.storage.getData<AuditLogConfig>(STORAGE_KEY_CONFIG);
      if (data) {
        this.config = {
          ...data,
          maxEntries: data.maxEntries ?? MAX_ENTRIES_DEFAULT,
          retentionDays: data.retentionDays ?? RETENTION_DAYS_DEFAULT,
          enabled: data.enabled ?? true,
        };
      }
    } catch {
      this.config = {
        maxEntries: MAX_ENTRIES_DEFAULT,
        retentionDays: RETENTION_DAYS_DEFAULT,
        enabled: true,
      };
    }
  }
}