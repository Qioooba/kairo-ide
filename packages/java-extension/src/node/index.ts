export { JdtLsManager } from './jdt-ls-manager';
export type {
  JdtLsDistribution,
  JdtLsEvent,
  JdtLsState,
  JdtLsEventListener,
  JdtLsStartError,
} from './jdt-ls-manager';
export { JdtLsService } from './jdt-ls-service';
export type { JdtLsServiceEvent } from './jdt-ls-service';
export { encodeLspMessage, LSPMessageParser } from '../common/lsp-protocol';

import { interfaces } from '@theia/core/shared/inversify';
import { JdtLsManager } from './jdt-ls-manager';
import { JdtLsService } from './jdt-ls-service';

export function bindJdtLsService(bind: interfaces.Bind): void {
  bind(JdtLsService).toSelf().inSingletonScope();
}

// Silence the unused warning for the JdtLsManager export.
void JdtLsManager;