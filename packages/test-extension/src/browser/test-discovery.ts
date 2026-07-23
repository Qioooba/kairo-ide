import { injectable, inject } from '@theia/core/shared/inversify';
import { TestStore, TestItem } from './test-store';

/**
 * JUnit test discovery service.
 *
 * Scans Java source files in the workspace for:
 * - JUnit 4: @Test annotation (org.junit.Test)
 * - JUnit 3: extends TestCase (junit.framework.TestCase)
 *
 * Builds a hierarchical TestItem tree (package → class → method)
 * and populates it into the TestStore.
 */
@injectable()
export class TestDiscoveryService {
    @inject(TestStore)
    private readonly store!: TestStore;

    /**
     * Discover JUnit tests from raw Java source content.
     * Populates the TestStore with a hierarchical tree of test items.
     *
     * @param sourceFiles Map of file path → source content
     */
    discoverFromSources(sourceFiles: Map<string, string>): void {
        const items: TestItem[] = [];
        const packageMap = new Map<string, string>(); // packageName → itemId

        for (const [filePath, content] of sourceFiles) {
            if (!filePath.endsWith('.java')) continue;
            const parsed = this.parseTestClass(content, filePath);
            if (!parsed) continue;

            const className = parsed.className;
            const pkg = this.extractPackage(content);
            const pkgName = pkg || '(default)';
            const pkgId = `pkg:${pkgName}`;
            const classId = `class:${className}`;

            // Ensure package item exists
            if (!packageMap.has(pkgName)) {
                packageMap.set(pkgName, pkgId);
                items.push({
                    id: pkgId,
                    kind: 'package',
                    label: pkgName,
                    qualifiedName: pkgName,
                    parentId: null,
                    children: [classId],
                    status: 'idle',
                    filePath: undefined,
                });
            } else {
                const pkgItem = items.find(i => i.id === pkgId);
                if (pkgItem && !pkgItem.children.includes(classId)) {
                    pkgItem.children.push(classId);
                }
            }

            // Create class item
            const classItem: TestItem = {
                id: classId,
                kind: 'class',
                label: parsed.simpleName,
                qualifiedName: className,
                parentId: pkgId,
                children: [],
                status: 'idle',
                filePath,
                line: parsed.classLine,
            };

            // Create method items
            for (const method of parsed.methods) {
                const methodId = `method:${className}#${method.name}`;
                classItem.children.push(methodId);
                items.push({
                    id: methodId,
                    kind: 'method',
                    label: method.name,
                    qualifiedName: `${className}.${method.name}`,
                    parentId: classId,
                    children: [],
                    status: 'idle',
                    filePath,
                    line: method.line,
                });
            }

            items.push(classItem);
        }

        // Update the store with discovered items
        this.store.updateItems(items);
    }

    /**
     * Parse a Java source file to determine if it's a JUnit test class.
     */
    parseTestClass(content: string, filePath: string): {
        className: string;
        simpleName: string;
        framework: 'junit3' | 'junit4';
        methods: { name: string; line: number }[];
        classLine?: number;
    } | undefined {
        let framework: 'junit3' | 'junit4' | undefined;
        const methods: { name: string; line: number }[] = [];

        // Check for JUnit 4: @Test annotation
        const hasTestAnnotation = /@Test\b/.test(content);
        const hasJunit4Import = /import\s+org\.junit\.Test\b/.test(content)
            || /import\s+org\.junit\.\*/.test(content);

        // Check for JUnit 3: extends TestCase
        const hasTestCaseExtends = /extends\s+TestCase\b/.test(content);
        const hasJunit3Import = /import\s+junit\.framework\.TestCase\b/.test(content)
            || /import\s+junit\.framework\.\*/.test(content);

        if (hasTestAnnotation || hasJunit4Import) {
            framework = 'junit4';
        } else if (hasTestCaseExtends || hasJunit3Import) {
            framework = 'junit3';
        }

        if (!framework) {
            // Check for test method naming patterns (testXxx)
            if (/public\s+void\s+test\w+\s*\(/.test(content)) {
                framework = 'junit3';
            } else {
                return undefined;
            }
        }

        // Extract class name
        const classMatch = content.match(/(?:public\s+)?class\s+(\w+)/);
        const simpleName = classMatch ? classMatch[1] : filePath.split(/[/\\]/).pop()?.replace('.java', '') ?? 'Unknown';
        const className = this.filePathToClassName(filePath, simpleName);
        const classLine = classMatch ? this.lineNumberOf(content, classMatch.index!) : undefined;

        // Extract methods for JUnit 4: methods with @Test
        if (framework === 'junit4') {
            const testMethodRegex = /@Test\b[\s\S]*?public\s+void\s+(\w+)\s*\(/g;
            let m: RegExpExecArray | null;
            while ((m = testMethodRegex.exec(content)) !== null) {
                const name = m[1];
                if (!methods.some(mt => mt.name === name)) {
                    methods.push({ name, line: this.lineNumberOf(content, m.index) });
                }
            }
        }

        // Extract methods for JUnit 3: methods starting with "test"
        if (framework === 'junit3') {
            const testMethodPattern = /public\s+void\s+(test\w+)\s*\(/g;
            let m: RegExpExecArray | null;
            while ((m = testMethodPattern.exec(content)) !== null) {
                const name = m[1];
                if (!methods.some(mt => mt.name === name)) {
                    methods.push({ name, line: this.lineNumberOf(content, m.index) });
                }
            }
        }

        if (methods.length === 0) return undefined;

        return { className, simpleName, framework, methods, classLine };
    }

    /**
     * Extract the package name from Java source content.
     */
    extractPackage(content: string): string | undefined {
        const match = content.match(/package\s+([\w.]+)\s*;/);
        return match ? match[1] : undefined;
    }

    /**
     * Convert a file path to a fully qualified class name.
     */
    filePathToClassName(filePath: string, simpleName: string): string {
        const normalized = filePath.replace(/\\/g, '/');
        const pkg = this.extractPackageFromContent(normalized);
        if (pkg) return `${pkg}.${simpleName}`;

        // Try to derive from src structure
        const srcMatch = normalized.match(/(?:src\/(?:test|main)\/java\/)(.+)/);
        if (srcMatch) {
            return srcMatch[1].replace(/\.java$/, '').replace(/\//g, '.');
        }
        return simpleName;
    }

    /**
     * Try to extract package from file path (not content).
     */
    private extractPackageFromContent(_filePath: string): string | undefined {
        // We need the actual file content for this — handled by parseTestClass
        return undefined;
    }

    /**
     * Calculate the 1-based line number for a given character index.
     */
    lineNumberOf(content: string, charIndex: number): number {
        let line = 1;
        for (let i = 0; i < charIndex && i < content.length; i++) {
            if (content[i] === '\n') line++;
        }
        return line;
    }
}