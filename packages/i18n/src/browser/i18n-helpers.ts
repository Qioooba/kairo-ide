import type { interfaces } from '@theia/core/shared/inversify';
import { I18nServiceSymbol, type I18nService } from '../common';

/**
 * Helper to get the I18nService from an Inversify container.
 * Use this in factory functions where you can't use @inject directly.
 */
export function getI18nService(container: interfaces.Container): I18nService {
  return container.get<I18nService>(I18nServiceSymbol);
}
