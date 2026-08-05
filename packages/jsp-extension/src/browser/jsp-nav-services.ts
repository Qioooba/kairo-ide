/**
 * Shared filesystem/workspace dependencies for JSP navigation providers.
 * Passed from KairoJspLanguageContribution (DI) into register* helpers —
 * providers must not be constructed with bare `new` (no injected services).
 */

import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

export interface JspNavServices {
  fileService: FileService;
  workspaceService: WorkspaceService;
}
