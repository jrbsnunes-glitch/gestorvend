import { BadRequestException } from '@nestjs/common';
import {
  CashMovementType,
  PaymentMethod,
  type PrismaClient,
} from '../generated/tenant-client';

/** Identifica movimentos gerados pela conferência (não apagar sangrias/despesas manuais do PDV). */
export const RECON_CASH_EXPENSE_REASON_PREFIX = 'Despesa (conferência caixa)';

export type ReconciliationExpenseLineStored = {
  amount: number;
  notes: string | null;
  referentialAccountId: string;
  cashMovementId?: string;
};

export function buildReconciliationExpenseReason(notes: string | null): string {
  const n = notes?.trim();
  return n ? `${RECON_CASH_EXPENSE_REASON_PREFIX}: ${n}` : RECON_CASH_EXPENSE_REASON_PREFIX;
}

export function isReconciliationSyncedExpenseMovement(
  reason: string | null | undefined,
): boolean {
  return String(reason ?? '').startsWith(RECON_CASH_EXPENSE_REASON_PREFIX);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineFingerprint(line: {
  amount: number;
  referentialAccountId: string;
  notes: string | null;
}): string {
  return `${line.referentialAccountId}|${roundMoney(line.amount).toFixed(2)}|${line.notes ?? ''}`;
}

export function parseStoredReconciliationExpenseLines(
  raw: unknown,
): ReconciliationExpenseLineStored[] {
  if (!Array.isArray(raw)) return [];
  const out: ReconciliationExpenseLineStored[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const amtRaw = row.amount;
    const amt =
      typeof amtRaw === 'number'
        ? amtRaw
        : parseFloat(String(amtRaw ?? '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const refId =
      row.referentialAccountId != null && String(row.referentialAccountId).trim() !== ''
        ? String(row.referentialAccountId).trim()
        : null;
    if (!refId) continue;
    const notesRaw = row.notes;
    const notes =
      notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;
    const movRaw = row.cashMovementId;
    const cashMovementId =
      typeof movRaw === 'string' && movRaw.trim() !== '' ? movRaw.trim() : undefined;
    out.push({
      amount: roundMoney(amt),
      notes,
      referentialAccountId: refId,
      ...(cashMovementId ? { cashMovementId } : {}),
    });
  }
  return out;
}

/**
 * Garante um CashMovement por linha de despesa da conferência (caixa fechado).
 * Atualiza linhas existentes, cria faltantes e remove órfãs geradas pela conferência.
 */
export async function syncReconciliationExpenseMovements(
  db: PrismaClient,
  sessionId: string,
  incoming: ReconciliationExpenseLineStored[],
  previousRaw: unknown,
): Promise<{ lines: ReconciliationExpenseLineStored[]; sum: number }> {
  const previous = parseStoredReconciliationExpenseLines(previousRaw);
  const prevByFingerprint = new Map(previous.map((l) => [lineFingerprint(l), l]));
  const claimedPrevMovIds = new Set<string>();
  const out: ReconciliationExpenseLineStored[] = [];

  for (const line of incoming) {
    let movId = line.cashMovementId?.trim() || undefined;

    if (!movId) {
      const fp = lineFingerprint(line);
      const prevMatch = prevByFingerprint.get(fp);
      if (prevMatch?.cashMovementId && !claimedPrevMovIds.has(prevMatch.cashMovementId)) {
        movId = prevMatch.cashMovementId;
      }
    }

    if (movId) {
      const existing = await db.cashMovement.findFirst({
        where: { id: movId, sessionId },
      });
      if (
        existing &&
        existing.type === CashMovementType.OUT &&
        existing.method === PaymentMethod.EXPENSE &&
        isReconciliationSyncedExpenseMovement(existing.reason)
      ) {
        await db.cashMovement.update({
          where: { id: movId },
          data: {
            amount: String(line.amount.toFixed(2)),
            referentialAccountId: line.referentialAccountId,
            reason: buildReconciliationExpenseReason(line.notes),
          },
        });
        claimedPrevMovIds.add(movId);
        out.push({ ...line, cashMovementId: movId });
        continue;
      }
      movId = undefined;
    }

    const created = await db.cashMovement.create({
      data: {
        sessionId,
        type: CashMovementType.OUT,
        method: PaymentMethod.EXPENSE,
        amount: String(line.amount.toFixed(2)),
        referentialAccountId: line.referentialAccountId,
        reason: buildReconciliationExpenseReason(line.notes),
      },
    });
    claimedPrevMovIds.add(created.id);
    out.push({ ...line, cashMovementId: created.id });
  }

  for (const prev of previous) {
    const id = prev.cashMovementId;
    if (!id || claimedPrevMovIds.has(id)) continue;
    const existing = await db.cashMovement.findFirst({ where: { id, sessionId } });
    if (existing && isReconciliationSyncedExpenseMovement(existing.reason)) {
      await db.cashMovement.delete({ where: { id } });
    }
  }

  const sum = roundMoney(out.reduce((acc, l) => acc + l.amount, 0));
  return { lines: out, sum };
}

/** Remove movimentos vinculados às linhas anteriores da conferência. */
export async function clearReconciliationExpenseMovements(
  db: PrismaClient,
  sessionId: string,
  previousRaw: unknown,
): Promise<void> {
  const previous = parseStoredReconciliationExpenseLines(previousRaw);
  for (const line of previous) {
    const id = line.cashMovementId;
    if (!id) continue;
    const existing = await db.cashMovement.findFirst({ where: { id, sessionId } });
    if (existing && isReconciliationSyncedExpenseMovement(existing.reason)) {
      await db.cashMovement.delete({ where: { id } });
    }
  }
}
