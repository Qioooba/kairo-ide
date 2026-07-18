import { injectable, inject } from '@theia/core/shared/inversify';
import { JAVA_LANGUAGE_ID, JAVA_LANGUAGE_NAME } from '../common/java-common';

/**
 * Java language client contribution.
 *
 * Provides the language client configuration for JDT LS.
 * When the Theia language infrastructure initializes, this
 * contribution supplies the document selector, initialization
 * options, and server configuration that drives completion,
 * hover, definition, diagnostics, and other Java language
 * features.
 */
@injectable()
export class JavaLanguageClientContribution {
    readonly id = JAVA_LANGUAGE_ID;
    readonly name = JAVA_LANGUAGE_NAME;

    get documentSelector(): string[] {
        return ['java'];
    }

    get globPatterns(): string[] {
        return ['**/*.java'];
    }

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
                        includeDecompiledSources: true,
                    },
                    signatureHelp: {
                        enabled: true,
                    },
                    implementationsCodeLens: {
                        enabled: true,
                    },
                    configuration: {
                        checkProjectSettingsExclusions: false,
                        updateBuildConfiguration: 'interactive',
                    },
                    trace: {
                        server: 'verbose',
                    },
                },
            },
        };
    }

    /**
     * Server options for the language client.
     * The actual server process is managed by the backend
     * JavaLanguageServerManager, which spawns JDT LS and
     * provides the StreamMessageReader/StreamMessageWriter.
     */
    get serverOptions(): Record<string, unknown> {
        return {
            run: {
                // The backend JavaLanguageServerManager handles
                // the actual process lifecycle. The frontend
                // connects to the streams provided by the backend.
            },
            debug: {
                // Same as run but with verbose logging enabled.
            },
        };
    }
}