import type { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { KairoI18nService } from './kairo-i18n-service';
import { I18nServiceSymbol } from '../common/i18n-types';
import { KairoI18nFrontendContribution } from './kairo-i18n-frontend-contribution';
import { KairoI18nPreferenceContribution } from './kairo-i18n-preferences';

export * from './i18n-helpers';

/**
 * Bind the Kairo i18n service, preference schema, and frontend contribution
 * into the Inversify container. Call this from the product's bind function
 * (e.g. bindKairoFrontend in kairo-product-frontend-module.ts).
 *
 * Accepts full Inversify bind/unbind/isBound/rebind signature for consistency
 * with other Kairo extension binding functions.
 */
export function bindKairoI18n(
  bind: interfaces.Bind,
  _unbind?: interfaces.Unbind,
  _isBound?: interfaces.IsBound,
  _rebind?: interfaces.Rebind,
): void {
  bind(KairoI18nService).toSelf().inSingletonScope();
  bind(I18nServiceSymbol).toService(KairoI18nService);
  bind(KairoI18nFrontendContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoI18nFrontendContribution);
  bind(PreferenceContribution).toConstantValue(KairoI18nPreferenceContribution);
}

export { KairoI18nService, KairoI18nFrontendContribution, KairoI18nPreferenceContribution };
