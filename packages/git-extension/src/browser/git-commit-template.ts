import { injectable, inject } from '@theia/core/shared/inversify';
import { KairoI18nService } from '@kairo/i18n';
import { GitService, GitCommit as _GitCommit } from './git-service';

/** 提交类型 */
export type CommitType = 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'build' | 'chore' | 'style' | 'perf' | 'ci';

/** 提交模板 */
export interface CommitTemplate {
    /** 模板名称 */
    name: string;
    /** 模板描述 */
    description: string;
    /** 模板格式，支持占位符: {module}, {branch}, {type}, {description} */
    format: string;
}

/** 提交消息建议 */
export interface CommitSuggestion {
    message: string;
    source: string;
    timestamp: number;
}

const DEFAULT_TEMPLATES: CommitTemplate[] = [
    {
        name: '默认',
        description: '标准格式: [模块] 简短描述',
        format: '[{module}] {description}',
    },
    {
        name: 'feat',
        description: '新功能',
        format: 'feat({module}): {description}',
    },
    {
        name: 'fix',
        description: 'Bug 修复',
        format: 'fix({module}): {description}',
    },
    {
        name: 'refactor',
        description: '重构',
        format: 'refactor({module}): {description}',
    },
    {
        name: 'docs',
        description: '文档',
        format: 'docs({module}): {description}',
    },
    {
        name: 'test',
        description: '测试',
        format: 'test({module}): {description}',
    },
    {
        name: 'build',
        description: '构建/依赖',
        format: 'build({module}): {description}',
    },
];

const TEMPLATE_PREFS_KEY = 'kairo-git-commit-template-prefs';
const RECENT_COMMITS_KEY = 'kairo-git-recent-commits';
const MAX_RECENT_COMMITS = 20;

/** 模板描述的 i18n key（与 DEFAULT_TEMPLATES 顺序一一对应） */
const TEMPLATE_DESCRIPTION_KEYS: readonly string[] = [
    'git.template.default.description',
    'git.template.feat.description',
    'git.template.fix.description',
    'git.template.refactor.description',
    'git.template.docs.description',
    'git.template.test.description',
    'git.template.build.description',
];

/** 提交消息正文建议最大行长度 */
const BODY_MAX_LINE_LENGTH = 72;

@injectable()
export class GitCommitTemplateService {
    @inject(GitService) protected readonly gitService!: GitService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    protected templates: CommitTemplate[] = [...DEFAULT_TEMPLATES];
    protected selectedTemplateIndex = 0;
    protected recentCommits: CommitSuggestion[] = [];
    protected customTemplate: string = DEFAULT_TEMPLATES[0].format;

    /**
     * 翻译辅助方法。测试可能直接 new 本服务（不经 DI），此时 i18n 为 undefined，
     * 回退到 fallback（原中文文案），保证行为与未接入 i18n 时一致。
     */
    protected tr(key: string, params?: Record<string, string | number>, fallback?: string): string {
        if (!this.i18n) return fallback ?? key;
        return (this.i18n.t as (k: string, p?: Record<string, string | number>) => string)(key, params);
    }

    /** 获取所有模板 */
    getTemplates(): CommitTemplate[] {
        return this.templates.map((_, i) => this.getTemplateAt(i));
    }

    /** 获取当前选中的模板 */
    getSelectedTemplate(): CommitTemplate {
        return this.getTemplateAt(this.selectedTemplateIndex);
    }

    /** 按索引取模板，注入了 i18n 时返回翻译后的名称/描述 */
    protected getTemplateAt(index: number): CommitTemplate {
        const resolved = index >= 0 && index < this.templates.length ? index : 0;
        const tpl = this.templates[resolved];
        if (!this.i18n) return tpl;
        return {
            ...tpl,
            name: resolved === 0 ? this.tr('git.template.default.name', undefined, '默认') : tpl.name,
            description: this.tr(TEMPLATE_DESCRIPTION_KEYS[resolved], undefined, tpl.description),
        };
    }

    /** 选择模板 */
    selectTemplate(index: number): void {
        if (index >= 0 && index < this.templates.length) {
            this.selectedTemplateIndex = index;
            this.saveTemplatePreferences();
        }
    }

    /** 获取自定义模板 */
    getCustomTemplate(): string {
        return this.customTemplate;
    }

    /** 设置自定义模板 */
    setCustomTemplate(format: string): void {
        this.customTemplate = format;
        this.saveTemplatePreferences();
    }

    /** 加载偏好 */
    loadTemplatePreferences(): void {
        try {
            const stored = localStorage.getItem(TEMPLATE_PREFS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.selectedTemplateIndex = parsed.selectedTemplateIndex ?? 0;
                this.customTemplate = parsed.customTemplate ?? DEFAULT_TEMPLATES[0].format;
            }
        } catch {
            // 忽略
        }
    }

    /** 保存偏好 */
    protected saveTemplatePreferences(): void {
        try {
            localStorage.setItem(TEMPLATE_PREFS_KEY, JSON.stringify({
                selectedTemplateIndex: this.selectedTemplateIndex,
                customTemplate: this.customTemplate,
            }));
        } catch {
            // 忽略
        }
    }

    /** 生成提交消息 */
    async generateMessage(
        type: string,
        module: string = '',
        description: string = '',
    ): Promise<string> {
        const template = this.templates.find(t => t.name === type) || this.templates[0];
        let message = template.format;

        // 自动填充模块名
        if (!module) {
            module = await this.detectModule();
        }

        message = message.replace('{module}', module || 'core');
        message = message.replace('{type}', type);
        message = message.replace('{description}', description || '');
        message = message.replace('{branch}', await this.getCurrentBranch());

        return message.trim();
    }

    /** 获取当前分支名 */
    async getCurrentBranch(): Promise<string> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) return '';
        const status = await this.gitService.getStatus();
        return status.branch;
    }

    /** 自动检测模块名 */
    protected async detectModule(): Promise<string> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) return '';
        const status = await this.gitService.getStatus();
        if (status.branch) {
            // 从分支名推断模块，如 feature/user-module => user
            const parts = status.branch.split(/[/-]/);
            if (parts.length >= 2) {
                return parts[1] || parts[0];
            }
            return status.branch;
        }
        return '';
    }

    /** 加载最近提交记录作为建议 */
    async loadRecentCommits(): Promise<CommitSuggestion[]> {
        try {
            const stored = localStorage.getItem(RECENT_COMMITS_KEY);
            if (stored) {
                this.recentCommits = JSON.parse(stored) as CommitSuggestion[];
            }
        } catch {
            this.recentCommits = [];
        }

        try {
            const commits = await this.gitService.getHistory(MAX_RECENT_COMMITS);
            const fromHistory: CommitSuggestion[] = commits.map(c => ({
                message: c.message.split('\n')[0],
                source: c.author,
                timestamp: c.date.getTime(),
            }));

            // 合并已有建议和历史记录，去重
            const seen = new Set<string>();
            const merged: CommitSuggestion[] = [];
            for (const item of [...this.recentCommits, ...fromHistory]) {
                if (!seen.has(item.message) && item.message.trim()) {
                    seen.add(item.message);
                    merged.push(item);
                }
            }

            this.recentCommits = merged.slice(0, MAX_RECENT_COMMITS);
            this.saveRecentCommits();
        } catch {
            // 忽略
        }

        return this.recentCommits;
    }

    /** 记录提交消息 */
    recordCommit(message: string): void {
        const subject = message.split('\n')[0];
        this.recentCommits = [
            { message: subject, source: 'recent', timestamp: Date.now() },
            ...this.recentCommits.filter(c => c.message !== subject),
        ].slice(0, MAX_RECENT_COMMITS);
        this.saveRecentCommits();
    }

    /** 保存最近提交 */
    protected saveRecentCommits(): void {
        try {
            localStorage.setItem(RECENT_COMMITS_KEY, JSON.stringify(this.recentCommits));
        } catch {
            // 忽略
        }
    }

    /** 获取最近提交建议 */
    getRecentSuggestions(): CommitSuggestion[] {
        return this.recentCommits;
    }

    /** 获取提交消息的字符数统计 */
    getMessageStats(message: string): { charCount: number; bodyLines: { line: number; length: number; exceedsLimit: boolean }[] } {
        const charCount = message.length;
        const lines = message.split('\n');
        const bodyLines: { line: number; length: number; exceedsLimit: boolean }[] = [];

        // 跳过第一行 (subject)，从第二行开始检查正文
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            bodyLines.push({
                line: i + 1,
                length: line.length,
                exceedsLimit: line.length > BODY_MAX_LINE_LENGTH,
            });
        }

        return { charCount, bodyLines };
    }

    /** 检查是否有正文行超过建议长度 */
    hasBodyLineWarnings(message: string): boolean {
        const stats = this.getMessageStats(message);
        return stats.bodyLines.some(l => l.exceedsLimit);
    }

    /** 获取行长度警告信息 */
    getBodyLineWarnings(message: string): string[] {
        const stats = this.getMessageStats(message);
        return stats.bodyLines
            .filter(l => l.exceedsLimit)
            .map(l => this.tr(
                'git.template.lineTooLong',
                { line: l.line, length: l.length, limit: BODY_MAX_LINE_LENGTH },
                `第 ${l.line} 行长度为 ${l.length} 字符，超过建议的 ${BODY_MAX_LINE_LENGTH} 字符`,
            ));
    }
}