import { BadRequestException } from '@nestjs/common';
import { StockLocationKind } from '../generated/tenant-client';

export const RESERVATION_LOCATION_CODE = 'RESERVA';

export function isReservationLocationKind(kind: string | null | undefined): boolean {
  return kind === 'SALES_RESERVATION' || kind === StockLocationKind.SALES_RESERVATION;
}

export const OPERATIONAL_LOCATION_WHERE = {
  NOT: { kind: StockLocationKind.SALES_RESERVATION },
} as const;

export function assertOperationalStockLocation(
  loc: { id?: string; kind?: string; name?: string; code?: string } | null,
  label = 'Local',
): asserts loc is { id: string; kind?: string; name?: string; code?: string } {
  if (!loc) {
    throw new BadRequestException(`${label} de estoque não encontrado.`);
  }
  if (isReservationLocationKind(loc.kind)) {
    throw new BadRequestException(
      'O local Reserva é exclusivo das reservas de venda e não pode ser usado nesta operação.',
    );
  }
}

type LocationDelegate = {
  findUnique: (args: {
    where: { code: string };
  }) => Promise<{ id: string; code: string; name: string; kind: string } | null>;
  create: (args: {
    data: { code: string; name: string; isDefault: boolean; kind: StockLocationKind };
  }) => Promise<{ id: string; code: string; name: string; kind: string }>;
  update: (args: {
    where: { id: string };
    data: { kind: StockLocationKind; isDefault: boolean };
  }) => Promise<{ id: string; code: string; name: string; kind: string }>;
};

export async function ensureReservationLocation(db: { stockLocation: LocationDelegate }): Promise<{
  id: string;
  code: string;
  name: string;
}> {
  const existing = await db.stockLocation.findUnique({ where: { code: RESERVATION_LOCATION_CODE } });
  if (existing) {
    if (!isReservationLocationKind(existing.kind)) {
      await db.stockLocation.update({
        where: { id: existing.id },
        data: { kind: StockLocationKind.SALES_RESERVATION, isDefault: false },
      });
    }
    return existing;
  }
  return db.stockLocation.create({
    data: {
      code: RESERVATION_LOCATION_CODE,
      name: 'Reserva',
      isDefault: false,
      kind: StockLocationKind.SALES_RESERVATION,
    },
  });
}
