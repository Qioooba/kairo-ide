// Widget factory IDs for the Kairo views. Kept in a standalone
// module so consumers (e.g. kairo-views-contribution) can reference
// the IDs without pulling in the full frontend module — which
// transitively loads monaco and breaks plain-node unit tests.

export const KAIRO_SERVERS_FACTORY_ID = 'kairo-server-view';
export const KAIRO_BUILDS_FACTORY_ID = 'kairo-build-view';
export const KAIRO_DEPLOYMENTS_FACTORY_ID = 'kairo-deployments';
export const KAIRO_LOGS_FACTORY_ID = 'kairo-log-viewer';
export const KAIRO_IMPORT_WIZARD_FACTORY_ID = 'kairo-import-wizard';
export const KAIRO_PROJECT_SELECTOR_FACTORY_ID = 'kairo-project-selector';
export const KAIRO_RUN_CONFIGURATIONS_FACTORY_ID = 'kairo-run-configurations';
export const KAIRO_PROBLEMS_FACTORY_ID = 'kairo-problems';
export const KAIRO_TOOLBAR_FACTORY_ID = 'kairo-toolbar';
export const KAIRO_KEYMAP_FACTORY_ID = 'kairo-keymap';
export const KAIRO_LOCAL_HISTORY_FACTORY_ID = 'kairo-local-history';
export const KAIRO_TESTS_FACTORY_ID = 'kairo-test-tree';
export const KAIRO_MAVEN_FACTORY_ID = 'kairo-maven-view';
export const KAIRO_TODO_FACTORY_ID = 'kairo-todo-view';
export const KAIRO_PERF_FACTORY_ID = 'kairo-perf-dashboard';
export const KAIRO_SQL_CONSOLE_FACTORY_ID = 'kairo-sql-console';
export const KAIRO_REMOTE_FACTORY_ID = 'kairo-remote';
export const KAIRO_SHORTCUTS_FACTORY_ID = 'kairo-shortcuts';
export const KAIRO_DEBUG_VARIABLES_FACTORY_ID = 'kairo-debug-variables';
export const KAIRO_DEBUG_CALLSTACK_FACTORY_ID = 'kairo-debug-callstack';
export const KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID = 'kairo-debug-breakpoints';
export const KAIRO_DEBUG_TOOLBAR_FACTORY_ID = 'kairo-debug-toolbar';
export const KAIRO_DEBUG_CONSOLE_FACTORY_ID = 'kairo-debug-console';
export const KAIRO_DEBUG_WATCH_FACTORY_ID = 'kairo-debug-watch';
export const KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID = 'kairo-debug-module-selector';
export const KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID = 'kairo-debug-condition-editor';
export const KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID = 'kairo-debug-hotswap-status';
