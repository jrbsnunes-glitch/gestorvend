import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PdvTerminalRole } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export async function assertCashAllowedForTerminalHeader(
  tenantPrisma: TenantPrismaService,
  tenantSlug: string,
  terminalNumberRaw: string | undefined,
  action: 'open' | 'close',
): Promise<void> {
  const raw = String(terminalNumberRaw ?? '').trim();
  if (!raw) return;

  const number = Math.floor(Number(raw));
  if (!Number.isFinite(number) || number < 1) {
    throw new BadRequestException('Número de PDV inválido.');
  }

  const db = await tenantPrisma.getClient(tenantSlug);
  const row = await db.pdvTerminal.findFirst({
    where: { number, isActive: true },
    select: { role: true, name: true, number: true },
  });
  if (!row) return;

  if (row.role === PdvTerminalRole.SATELLITE) {
    const verb = action === 'open' ? 'Abrir' : 'Fechar';
    throw new ForbiddenException(
      `${verb} caixa não é permitido no PDV secundário nº ${row.number}. Use o PDV mestre.`,
    );
  }
}
