import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { JAVA_LANGUAGE_ID, JAVA_LANGUAGE_NAME } from '../common/java-common';

/**
 * Java language client contribution.
 *
 * Provides the language client configuration for JDT LS.
 * Registers the `java` document selector, initialization options,
 * diagnostic collection, and LSP feature providers (completion,
 * definition, hover).
 *
 * The actual server process is managed by the backend
 * KairoJavaLanguageServerContribution, which spawns JDT LS
 * and provides StreamMessageReader/StreamMessageWriter.
 */
@injectable()
export class KairoJavaLanguageClientContribution {
    readonly id = JAVA_LANGUAGE_ID;
    readonly name = JAVA_LANGUAGE_NAME;

    @inject(ILogger)
    private readonly logger!: ILogger;

    /** Document selector for Java files. */
    get documentSelector(): string[] {
        return ['java'];
    }

    /** Glob patterns for Java file discovery. */
    get globPatterns(): string[] {
        return ['**/*.java'];
    }

    /**
     * JDT LS initialization options.
     * sourceLevel and targetLevel default to '1.6' for legacy
     * project compatibility (JRE 17 runs JDT LS, but target
     * project source can be Java 6).
     */
    get initializationOptions(): Record<string, unknown> {
        return {
            extendedClientCapabilities: {
                progressReportProvider: true,
                classFileContentsSupport: true,
                overrideMethodsPromptSupport: true,
                hashCodeEqualsPromptSupport: true,
                advancedOrganizeImportsSupport: true,
                generateToStringPromptSupport: true,
                advancedGenerateAccessorsSupport: true,
                generateConstructorsPromptSupport: true,
                generateDelegateMethodsPromptSupport: true,
            },
            settings: {
                java: {
                    completion: {
                        enabled: true,
                        guessMethodArguments: true,
                        favoriteStaticMembers: [
                            'org.junit.Assert.*',
                            'org.junit.Assume.*',
                            'java.util.Objects.requireNonNull',
                        ],
                    },
                    import: {
                        enabled: true,
                    },
                    format: {
                        enabled: true,
                    },
                    codeGeneration: {
                        toString: {
                            template: '${object.className} [${member.name()}=${member.value}, ${otherMembers}]',
                        },
                    },
                    references: {
                        includeDecompiledSources: false,
                    },
                    signatureHelp: {
                        enabled: true,
                    },
                    implementationsCodeLens: {
                        enabled: false,
                    },
                    symbols: {
                        includeSourceMethodDeclarations: true,
                    },
                    configuration: {
                        checkProjectSettingsExclusions: false,
                        updateBuildConfiguration: 'interactive',
                    },
                    trace: {
                        server: 'off',
                    },
                },
            },
        };
    }

    /**
     * Returns the diagnostic collection owner.
     * The diagnostic collection is created by the language client
     * infrastructure and populated with JDT LS diagnostics.
     */
    get diagnosticCollectionName(): string {
        return 'kairo-java-diagnostics';
    }

    /**
     * Returns the completion provider configuration.
     * Completion is triggered on '.' and 'Ctrl+Space'.
     */
    get completionProvider(): {
        resolveProvider: boolean;
        triggerCharacters: string[];
    } {
        return {
            resolveProvider: true,
            triggerCharacters: ['.', '@', '#', '*'],
        };
    }

    /**
     * Returns the definition provider configuration.
     * F12 / Go to Definition is enabled.
     */
    get definitionProvider(): boolean {
        return true;
    }

    /**
     * Returns the hover provider configuration.
     * Hover shows type information and documentation.
     */
    get hoverProvider(): boolean {
        return true;
    }

    /**
     * Returns the server options for the language client.
     * The actual server process is managed by the backend
     * KairoJavaLanguageServerContribution.
     */
    get serverOptions(): Record<string, unknown> {
        return {
            run: {
                command: 'kairo-java',
            },
            debug: {
                command: 'kairo-java',
                args: ['--debug'],
            },
        };
    }
}