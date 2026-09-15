/**
 * Inversify ContainerModule for Kairo Highlighting Extension.
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { TokenizerOwnerRegistry } from './tokenizer-owner-registry';
import { HighlightingService } from './highlighting-service';
import { HighlightingDiagnosticsService } from './highlighting-diagnostics';

export function bindHighlightingExtension(bind: interfaces.Bind): void {
  bind(TokenizerOwnerRegistry).toSelf().inSingletonScope();

  bind(HighlightingService).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(HighlightingService);

  bind(HighlightingDiagnosticsService).toSelf().inSingletonScope();
  bind(CommandContribution).toService(HighlightingDiagnosticsService);
}

export default new ContainerModule((bind: interfaces.Bind) => {
  bindHighlightingExtension(bind);
});
