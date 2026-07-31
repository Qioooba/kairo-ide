/**
 * Kairo product — backend Theia module.
 *
 * KAIRO-RC-WEB-229 (backend half): the incremental save path
 * (FileService.update → DiskFileSystemProvider.updateFile) does
 * its decode/encode on the BACKEND with the backend's own
 * EncodingService — the browser-side rebind never sees it.
 * Stock Theia's encoder is lossy (iconv rewrites unrepresentable
 * chars to '?'), so an emoji typed into a GBK file and saved
 * with plain Ctrl/Cmd+S was silently written as '?' (flow-03
 * live evidence: file bytes modified, no error shown).
 *
 * Rebinding the backend EncodingService to the validating
 * KairoSafeEncodingService makes updateFile throw
 * UnrepresentableEncodingError instead: the save fails loudly,
 * the file is NOT modified, and the editor keeps its dirty flag.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { EncodingService } from '@theia/core/lib/common/encoding-service';
// Deep import: the package index pulls in browser-only modules
// (Lumino DOM) which would crash the Node backend. The safe
// service itself only touches @theia/core common code.
import { KairoSafeEncodingService } from '@kairo/encoding-extension/lib/browser/safe-encoding-service';
import { DebugAdapterContribution } from '@theia/debug/lib/common/debug-model';
import { KairoJavaDebugAdapterContribution } from './kairo-java-debug-adapter-contribution';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { KairoAgentConfigContribution } from './kairo-agent-config-contribution';
// Import plugin-ext backend module to initialize the VS Code Extension Host
import '@theia/plugin-ext/lib/main/node/plugin-ext-backend-module';
import '@theia/plugin-ext-vscode/lib/node/plugin-vscode-backend-module';
import { KairoExtensionService } from '@kairo/plugin-extension/lib/common/kairo-extension-protocol';
import { KairoExtensionServiceImpl } from '@kairo/plugin-extension/lib/node/kairo-extension-service';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  if (isBound(EncodingService)) {
    rebind(EncodingService).to(KairoSafeEncodingService).inSingletonScope();
  } else {
    bind(EncodingService).to(KairoSafeEncodingService).inSingletonScope();
  }
  bind(KairoJavaDebugAdapterContribution).toSelf().inSingletonScope();
  bind(DebugAdapterContribution).toService(KairoJavaDebugAdapterContribution);

  // Inject agent config (URL + secret) into the frontend HTML so
  // that regular browsers can also connect to the Go Runtime Agent.
  bind(KairoAgentConfigContribution).toSelf().inSingletonScope();
  bind(BackendApplicationContribution).toService(KairoAgentConfigContribution);

  // Bind Kairo extension service for VS Code extension management
  bind(KairoExtensionServiceImpl).toSelf().inSingletonScope();
  bind(KairoExtensionService).toService(KairoExtensionServiceImpl);
});
