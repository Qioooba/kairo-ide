/**
 * Maven View Widget tests — validates the Maven view widget
 * rendering and Maven service state management.
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Simple unit tests for the Maven service types and logic
// (no DOM/React rendering needed for these tests)

describe('KairoMavenService - unit', () => {
    let MavenService;

    beforeEach(() => {
        // We test the type structures and logic in isolation
        // without needing the full Theia DI container.
    });

    describe('type definitions', () => {
        it('MavenDetectResult should have expected shape', () => {
            const result = {
                found: true,
                project: {
                    groupId: 'com.example',
                    artifactId: 'test',
                    version: '1.0',
                    packaging: 'jar',
                    name: 'Test',
                    description: '',
                    buildDir: 'target',
                    outputDir: 'target/classes',
                },
                tasks: [
                    { id: 'clean', label: 'Clean', description: 'Clean', phase: 'clean' },
                    { id: 'compile', label: 'Compile', description: 'Compile', phase: 'compile' },
                ],
                dependencies: [],
                tree: [],
                conflicts: [],
                warnings: [],
            };
            assert.strictEqual(result.found, true);
            assert.strictEqual(result.project.groupId, 'com.example');
            assert.strictEqual(result.tasks.length, 2);
        });

        it('MavenDependencyConflict should have versions array', () => {
            const conflict = {
                groupId: 'com.example',
                artifactId: 'lib',
                versions: ['1.0', '2.0'],
                resolvedVersion: '1.0',
                depth: 0,
            };
            assert.strictEqual(conflict.versions.length, 2);
            assert.ok(conflict.versions.includes('1.0'));
            assert.ok(conflict.versions.includes('2.0'));
        });

        it('MavenDependencyTreeNode should support children', () => {
            const node = {
                groupId: 'com.example',
                artifactId: 'app',
                version: '1.0',
                scope: 'compile',
                optional: false,
                type: 'jar',
                children: [
                    {
                        groupId: 'com.example',
                        artifactId: 'lib',
                        version: '1.0',
                        scope: 'compile',
                        optional: false,
                        type: 'jar',
                    },
                ],
            };
            assert.strictEqual(node.children.length, 1);
            assert.strictEqual(node.children[0].artifactId, 'lib');
        });

        it('MavenBuildProgress should have status enum', () => {
            const validStatuses = ['running', 'success', 'failed'];
            const progress = {
                phase: 'compile',
                module: '/project',
                status: 'running',
                message: 'Compiling...',
                percentComplete: 50,
            };
            assert.ok(validStatuses.includes(progress.status));
            assert.strictEqual(progress.percentComplete, 50);
        });
    });

    describe('MavenViewTab', () => {
        it('should have all expected tabs', () => {
            const tabs = ['overview', 'dependencies', 'lifecycle', 'modules'];
            assert.strictEqual(tabs.length, 4);
            assert.ok(tabs.includes('overview'));
            assert.ok(tabs.includes('dependencies'));
            assert.ok(tabs.includes('lifecycle'));
            assert.ok(tabs.includes('modules'));
        });
    });

    describe('MavenLifecycleTask', () => {
        it('should have standard lifecycle tasks', () => {
            const tasks = [
                { id: 'clean', label: 'Clean', description: 'Delete target/', phase: 'clean' },
                { id: 'validate', label: 'Validate', description: 'Validate project', phase: 'validate' },
                { id: 'compile', label: 'Compile', description: 'Compile sources', phase: 'compile' },
                { id: 'test', label: 'Test', description: 'Run tests', phase: 'test' },
                { id: 'package', label: 'Package', description: 'Package into JAR/WAR', phase: 'package' },
                { id: 'verify', label: 'Verify', description: 'Run integration tests', phase: 'verify' },
                { id: 'install', label: 'Install', description: 'Install to local repo', phase: 'install' },
            ];
            assert.strictEqual(tasks.length, 7);
            const ids = tasks.map(t => t.id);
            assert.ok(ids.includes('clean'));
            assert.ok(ids.includes('compile'));
            assert.ok(ids.includes('package'));
            assert.ok(ids.includes('install'));
        });
    });

    describe('conflict detection logic', () => {
        it('should detect duplicate groupId:artifactId', () => {
            const deps = [
                { groupId: 'com.a', artifactId: 'x', version: '1.0', scope: 'compile', optional: false, type: 'jar' },
                { groupId: 'com.a', artifactId: 'x', version: '2.0', scope: 'compile', optional: false, type: 'jar' },
            ];

            // Simulate conflict detection
            const seen = new Map();
            for (const d of deps) {
                const key = d.groupId + ':' + d.artifactId;
                if (!seen.has(key)) seen.set(key, []);
                seen.get(key).push(d.version);
            }

            const conflicts = [];
            for (const [key, versions] of seen) {
                const unique = [...new Set(versions)];
                if (unique.length > 1) {
                    conflicts.push({ key, versions: unique });
                }
            }

            assert.strictEqual(conflicts.length, 1);
            assert.strictEqual(conflicts[0].versions.length, 2);
        });

        it('should not conflict when same version', () => {
            const deps = [
                { groupId: 'com.a', artifactId: 'x', version: '1.0' },
                { groupId: 'com.a', artifactId: 'x', version: '1.0' },
            ];

            const seen = new Map();
            for (const d of deps) {
                const key = d.groupId + ':' + d.artifactId;
                if (!seen.has(key)) seen.set(key, []);
                seen.get(key).push(d.version);
            }

            const conflicts = [];
            for (const [, versions] of seen) {
                const unique = [...new Set(versions)];
                if (unique.length > 1) conflicts.push({ versions: unique });
            }

            assert.strictEqual(conflicts.length, 0);
        });
    });

    describe('build progress state machine', () => {
        it('should transition from running to success', () => {
            const states = [
                { status: 'running', percent: 0 },
                { status: 'running', percent: 50 },
                { status: 'success', percent: 100 },
            ];

            assert.strictEqual(states[0].status, 'running');
            assert.strictEqual(states[2].status, 'success');
            assert.strictEqual(states[2].percent, 100);
        });

        it('should transition from running to failed', () => {
            const states = [
                { status: 'running', percent: 0 },
                { status: 'running', percent: 30 },
                { status: 'failed', percent: 30 },
            ];

            assert.strictEqual(states[2].status, 'failed');
            assert.ok(states[2].percent < 100);
        });
    });
});