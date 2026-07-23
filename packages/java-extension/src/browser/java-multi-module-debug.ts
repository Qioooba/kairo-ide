/**
 * 多模块调试管理器 — §8.3 P3-ADVDBG-04
 *
 * 支持同时调试多个 Tomcat 实例或 Web 模块。每个调试会话拥有：
 *   - 独立的调试端口（自动分配或用户配置）
 *   - 独立的断点集合
 *   - 独立的线程列表
 *   - 独立的变量视图
 *
 * 会话管理：启动/停止单个会话，停止所有会话。
 * 调试工具栏中的会话选择器。
 *
 * ⚠️ 实验性功能 — Phase 3
 * 最大并发调试会话数：3
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StorageService } from '@theia/core/lib/browser';

/** 调试会话状态。 */
export type DebugSessionState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'crashed';

/** 单个调试会话配置。 */
export interface DebugSessionConfig {
  /** 会话名称（用于显示）。 */
  name: string;
  /** 调试端口。0 表示自动分配。 */
  port: number;
  /** 模块名称。 */
  moduleName: string;
  /** 主机地址。 */
  host: string;
  /** 是否在启动时自动连接。 */
  autoConnect: boolean;
}

/** 单个调试会话。 */
export interface DebugSession {
  /** 唯一会话 ID。 */
  id: string;
  /** 会话配置。 */
  config: DebugSessionConfig;
  /** 当前状态。 */
  state: DebugSessionState;
  /** 断点列表（文件:行号 格式）。 */
  breakpoints: string[];
  /** 当前线程 ID。 */
  activeThreadId?: number;
  /** 所有线程 ID。 */
  threadIds: number[];
  /** 创建时间。 */
  createdAt: string;
  /** 错误信息。 */
  error?: string;
}

/** 多模块调试管理器配置。 */
export interface MultiModuleDebugConfig {
  /** 最大并发会话数。 */
  maxSessions: number;
  /** 端口范围起始。 */
  portRangeStart: number;
  /** 端口范围结束。 */
  portRangeEnd: number;
}

/** 会话列表。 */
export interface DebugSessionList {
  sessions: DebugSession[];
  activeSessionId: string | null;
}

const MAX_SESSIONS = 3;
const PORT_RANGE_START = 5005;
const PORT_RANGE_END = 5010;
const STORAGE_KEY = 'kairo.multiModuleDebug.sessions';
const STORAGE_KEY_ACTIVE = 'kairo.multiModuleDebug.activeSession';

@injectable()
export class MultiModuleDebugManager {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;

  protected readonly onDidChangeSessionsEmitter = new Emitter<DebugSession[]>();
  readonly onDidChangeSessions: Event<DebugSession[]> = this.onDidChangeSessionsEmitter.event;

  protected readonly onDidChangeActiveSessionEmitter = new Emitter<string | null>();
  readonly onDidChangeActiveSession: Event<string | null> = this.onDidChangeActiveSessionEmitter.event;

  protected readonly onDidChangeSessionStateEmitter = new Emitter<{ sessionId: string; state: DebugSessionState }>();
  readonly onDidChangeSessionState: Event<{ sessionId: string; state: DebugSessionState }> = this.onDidChangeSessionStateEmitter.event;

  protected sessions: DebugSession[] = [];
  protected activeSessionId: string | null = null;
  protected config: MultiModuleDebugConfig = {
    maxSessions: MAX_SESSIONS,
    portRangeStart: PORT_RANGE_START,
    portRangeEnd: PORT_RANGE_END,
  };
  protected sessionCounter = 0;

  get sessionList(): DebugSessionList {
    return { sessions: [...this.sessions], activeSessionId: this.activeSessionId };
  }

  get activeSession(): DebugSession | undefined {
    if (!this.activeSessionId) return undefined;
    return this.sessions.find(s => s.id === this.activeSessionId);
  }

  get isExperimental(): boolean {
    return true;
  }

  @postConstruct()
  protected async init(): Promise<void> {
    this.logger.info('[多模块调试] ⚠️ 实验性功能已初始化。最大并发会话数: ' + MAX_SESSIONS);
    await this.loadSessions();
    this.showExperimentalWarning();
  }

  /**
   * 创建新的调试会话。
   */
  async createSession(config: Partial<DebugSessionConfig> = {}): Promise<DebugSession> {
    if (this.sessions.length >= this.config.maxSessions) {
      throw new Error(`已达到最大并发调试会话数 (${this.config.maxSessions})。请先停止其他会话。`);
    }

    this.sessionCounter++;
    const defaultName = `调试会话 ${this.sessionCounter}`;
    const port = config.port || this.allocatePort();

    const session: DebugSession = {
      id: `debug-session-${Date.now()}-${this.sessionCounter}`,
      config: {
        name: config.name || defaultName,
        port,
        moduleName: config.moduleName || '默认模块',
        host: config.host || 'localhost',
        autoConnect: config.autoConnect ?? true,
      },
      state: 'idle',
      breakpoints: [],
      threadIds: [],
      createdAt: new Date().toISOString(),
    };

    this.sessions.push(session);

    // 如果是第一个会话，自动激活
    if (this.sessions.length === 1) {
      this.activeSessionId = session.id;
    }

    await this.persistSessions();
    this.onDidChangeSessionsEmitter.fire([...this.sessions]);
    this.logger.info(`[多模块调试] 创建会话: ${session.config.name} (端口: ${port})`);

    return session;
  }

  /**
   * 启动指定的调试会话。
   */
  async startSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    if (session.state === 'running' || session.state === 'paused') {
      this.logger.warn(`[多模块调试] 会话已在运行中: ${session.config.name}`);
      return;
    }

    this.updateSessionState(sessionId, 'starting');

    try {
      // 模拟启动流程（实际实现中会连接 JVM 调试端口）
      await this.simulateStartup(session);

      this.updateSessionState(sessionId, 'running');
      this.logger.info(`[多模块调试] 会话已启动: ${session.config.name} (端口: ${session.config.port})`);
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      this.updateSessionState(sessionId, 'crashed');
      throw err;
    }
  }

  /**
   * 停止指定的调试会话。
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    this.updateSessionState(sessionId, 'stopping');

    // 模拟停止流程
    await this.simulateShutdown(session);

    session.state = 'stopped';
    session.threadIds = [];
    this.onDidChangeSessionStateEmitter.fire({ sessionId, state: 'stopped' });

    if (this.activeSessionId === sessionId) {
      // 自动切换到另一个运行中的会话
      const running = this.sessions.find(s => s.id !== sessionId && s.state === 'running');
      this.activeSessionId = running?.id || null;
      this.onDidChangeActiveSessionEmitter.fire(this.activeSessionId);
    }

    await this.persistSessions();
    this.onDidChangeSessionsEmitter.fire([...this.sessions]);
    this.logger.info(`[多模块调试] 会话已停止: ${session.config.name}`);
  }

  /**
   * 停止所有调试会话。
   */
  async stopAll(): Promise<void> {
    const runningSessions = this.sessions.filter(
      s => s.state === 'running' || s.state === 'paused' || s.state === 'starting',
    );

    for (const session of runningSessions) {
      try {
        await this.stopSession(session.id);
      } catch (err) {
        this.logger.warn(`[多模块调试] 停止会话失败 ${session.config.name}: ${String(err)}`);
      }
    }

    this.logger.info('[多模块调试] 所有会话已停止');
  }

  /**
   * 删除指定的调试会话。
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    // 如果正在运行，先停止
    if (session.state === 'running' || session.state === 'paused') {
      await this.stopSession(sessionId);
    }

    this.sessions = this.sessions.filter(s => s.id !== sessionId);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
      this.onDidChangeActiveSessionEmitter.fire(this.activeSessionId);
    }

    await this.persistSessions();
    this.onDidChangeSessionsEmitter.fire([...this.sessions]);
    this.logger.info(`[多模块调试] 会话已删除: ${session.config.name}`);
  }

  /**
   * 切换活跃的调试会话。
   */
  setActiveSession(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      this.logger.warn(`[多模块调试] 会话不存在: ${sessionId}`);
      return;
    }

    this.activeSessionId = sessionId;
    this.persistActiveSession();
    this.onDidChangeActiveSessionEmitter.fire(sessionId);
    this.logger.info(`[多模块调试] 活跃会话切换为: ${session.config.name}`);
  }

  /**
   * 暂停指定的调试会话。
   */
  pauseSession(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (session.state === 'running') {
      this.updateSessionState(sessionId, 'paused');
    }
  }

  /**
   * 恢复指定的调试会话。
   */
  resumeSession(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (session.state === 'paused') {
      this.updateSessionState(sessionId, 'running');
    }
  }

  /**
   * 为会话添加断点。
   */
  addBreakpoint(sessionId: string, filePath: string, line: number): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const bpKey = `${filePath}:${line}`;
    if (!session.breakpoints.includes(bpKey)) {
      session.breakpoints.push(bpKey);
      this.onDidChangeSessionsEmitter.fire([...this.sessions]);
    }
  }

  /**
   * 为会话移除断点。
   */
  removeBreakpoint(sessionId: string, filePath: string, line: number): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const bpKey = `${filePath}:${line}`;
    session.breakpoints = session.breakpoints.filter(b => b !== bpKey);
    this.onDidChangeSessionsEmitter.fire([...this.sessions]);
  }

  /**
   * 获取所有会话。
   */
  getSessions(): DebugSession[] {
    return [...this.sessions];
  }

  /**
   * 获取运行中的会话数。
   */
  getRunningCount(): number {
    return this.sessions.filter(s => s.state === 'running' || s.state === 'paused').length;
  }

  /**
   * 显示实验性功能警告。
   */
  showExperimentalWarning(): void {
    this.messages.warn(
      '⚠️ 多模块调试是实验性功能 (Phase 3)\n\n' +
      '已知限制：\n' +
      '• 最大并发会话数: 3\n' +
      '• 仅支持 JDWP 远程调试协议\n' +
      '• 每个模块需要独立的调试端口\n' +
      '• 断点同步可能延迟\n\n' +
      '此功能仍在开发中，可能不稳定。',
    );
  }

  // ── Internal ──────────────────────────────────────────────────

  protected updateSessionState(sessionId: string, state: DebugSessionState): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.state = state;
    this.onDidChangeSessionStateEmitter.fire({ sessionId, state });
    this.onDidChangeSessionsEmitter.fire([...this.sessions]);
  }

  protected allocatePort(): number {
    const usedPorts = new Set(this.sessions.map(s => s.config.port));
    for (let port = this.config.portRangeStart; port <= this.config.portRangeEnd; port++) {
      if (!usedPorts.has(port)) return port;
    }
    // 所有端口都在使用中，返回最大端口 + 1
    return this.config.portRangeEnd + 1;
  }

  protected async simulateStartup(session: DebugSession): Promise<void> {
    // 模拟启动延迟（实际实现中会建立 JDWP 连接）
    await new Promise(resolve => setTimeout(resolve, 500));
    session.threadIds = [1]; // 模拟主线程
  }

  protected async simulateShutdown(_session: DebugSession): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  protected async persistSessions(): Promise<void> {
    try {
      await this.storage.setData(STORAGE_KEY, this.sessions);
    } catch {
      // Storage not available
    }
  }

  protected async persistActiveSession(): Promise<void> {
    try {
      await this.storage.setData(STORAGE_KEY_ACTIVE, this.activeSessionId);
    } catch {
      // Storage not available
    }
  }

  protected async loadSessions(): Promise<void> {
    try {
      const data = await this.storage.getData<DebugSession[]>(STORAGE_KEY);
      if (data && Array.isArray(data)) {
        this.sessions = data.map(s => ({
          ...s,
          state: s.state === 'running' || s.state === 'paused' ? 'stopped' : s.state,
        }));
      }
      const activeId = await this.storage.getData<string>(STORAGE_KEY_ACTIVE);
      if (activeId && this.sessions.some(s => s.id === activeId)) {
        this.activeSessionId = activeId;
      }
    } catch {
      this.sessions = [];
      this.activeSessionId = null;
    }
  }
}