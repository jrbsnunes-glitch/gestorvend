import { SetMetadata } from '@nestjs/common';
import { TenantModuleAddon } from '../generated/central-client';

export const MODULE_KEY = 'module';

/**
 * Marca uma rota como exigindo um módulo adicional contratado no portal
 * (ex.: @RequiresModule(TenantModuleAddon.SERVICE_ORDER)).
 * Use junto de `ModuleGuard`.
 */
export const RequiresModule = (...modules: TenantModuleAddon[]) =>
  SetMetadata(MODULE_KEY, modules);
