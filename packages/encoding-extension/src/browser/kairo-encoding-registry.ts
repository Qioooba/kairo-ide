/**
 * KAIRO-RC-WEB-206 — hierarchical folder encoding overrides.
 *
 * Stock Theia's EncodingRegistry.getEncodingOverride checks
 * `resource.isEqualOrParent(override.parent)`. With Theia's URI
 * semantics (`a.isEqualOrParent(b)` is true when b is inside a)
 * that test only passes when the opened resource IS the override
 * folder (or an ancestor of it) — a file INSIDE the folder never
 * matches. Folder-level encoding overrides were therefore dead:
 * every GBK project file opened as UTF-8 mojibake unless the user
 * manually reopened it with an encoding.
 *
 * This subclass flips the comparison to
 * `override.parent.isEqualOrParent(resource)` so an override
 * registered for a folder applies to everything beneath it, which
 * is what the registry's own documentation promises ("parent").
 */

import { injectable } from '@theia/core/shared/inversify';
import { EncodingRegistry } from '@theia/core/lib/browser/encoding-registry';
import URI from '@theia/core/lib/common/uri';

@injectable()
export class KairoEncodingRegistry extends EncodingRegistry {
  protected override getEncodingOverride(resource: URI): string | undefined {
    const overrides = (this as unknown as { encodingOverrides?: { parent?: URI; encoding: string }[] }).encodingOverrides;
    if (overrides && overrides.length) {
      for (const override of overrides) {
        if (override.parent && override.parent.isEqualOrParent(resource)) {
          return override.encoding;
        }
        if (!override.parent) {
          return override.encoding;
        }
      }
    }
    return undefined;
  }
}
