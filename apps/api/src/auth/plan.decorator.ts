import { SetMetadata } from '@nestjs/common';
import { PlanCode } from '../generated/central-client';

export const PLAN_KEY = 'plan';

/**
 * Marca uma rota como exigindo um dos planos informados (ex.: @RequiresPlan('WHATSAPP')).
 * Use junto de `PlanGuard`. A verificação consulta o tenant no banco central.
 */
export const RequiresPlan = (...plans: PlanCode[]) => SetMetadata(PLAN_KEY, plans);
