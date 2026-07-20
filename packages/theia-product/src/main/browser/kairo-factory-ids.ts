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
