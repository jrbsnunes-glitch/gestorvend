import { readConfig } from './config';
import {
  markCashError,
  markCashSynced,
  markSaleError,
  markSaleSynced,
  pendingCash,
  pendingCount,
  pendingSales,
  readSnapshotSummary,
  replaceSnapshot,
  type OfflineSnapshot,
} from './offline-store';

async function authToken(readToken: () => Promise<string | null>): Promise<string | null> {
  try {
    const token = await readToken();
    return token?.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export async function refreshSnapshot(readToken: () => Promise<string | null>): Promise<{ ok: boolean; error?: string }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: 'Servidor não configurado.' };
  const token = await authToken(readToken);
  if (!token) return { ok: false, error: 'Entre no sistema uma vez com internet para gravar a cópia local.' };
  const pending = await pendingCount();
  try {
    const res = await fetch(`${cfg.serverUrl}/api/offline/snapshot`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Cópia local não atualizada (HTTP ${res.status}).` };
    const snapshot = JSON.parse(text) as OfflineSnapshot;
    await replaceSnapshot(snapshot, pending > 0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao baixar a cópia local.' };
  }
}

export async function pushOutbox(readToken: () => Promise<string | null>): Promise<{
  ok: boolean;
  syncedSales: number;
  syncedCash: number;
  stockConflicts: number;
  pending: number;
  error?: string;
}> {
  const cfg = readConfig();
  if (!cfg) {
    return { ok: false, syncedSales: 0, syncedCash: 0, stockConflicts: 0, pending: await pendingCount(), error: 'Servidor não configurado.' };
  }
  const token = await authToken(readToken);
  if (!token) {
    return { ok: false, syncedSales: 0, syncedCash: 0, stockConflicts: 0, pending: await pendingCount(), error: 'Sessão expirada. Entre de novo no servidor.' };
  }
  let syncedSales = 0;
  let syncedCash = 0;
  let stockConflicts = 0;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  for (const row of await pendingSales()) {
    try {
      const res = await fetch(`${cfg.serverUrl}/api/offline/sales`, {
        method: 'POST',
        headers,
        body: row.payload,
      });
      const text = await res.text();
      const data = text
        ? (JSON.parse(text) as {
            saleId?: string;
            number?: number;
            stockConflict?: boolean;
            message?: string | string[];
          })
        : {};
      if (!res.ok) {
        const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
        await markSaleError(row.clientId, message || `HTTP ${res.status}`);
        continue;
      }
      await markSaleSynced(row.clientId, {
        saleId: String(data.saleId),
        number: Number(data.number),
        stockConflict: Boolean(data.stockConflict),
      });
      syncedSales += 1;
      if (data.stockConflict) stockConflicts += 1;
    } catch (err) {
      await markSaleError(row.clientId, err instanceof Error ? err.message : 'Falha de rede');
    }
  }
  for (const row of await pendingCash()) {
    try {
      const res = await fetch(`${cfg.serverUrl}/api/offline/cash-movements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: row.clientId,
          type: row.type,
          amount: Number(row.amount),
          reason: row.reason,
          cashSessionId: row.cashSessionId,
        }),
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as { message?: string | string[] }) : {};
      if (!res.ok) {
        const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
        await markCashError(row.clientId, message || `HTTP ${res.status}`);
        continue;
      }
      await markCashSynced(row.clientId);
      syncedCash += 1;
    } catch (err) {
      await markCashError(row.clientId, err instanceof Error ? err.message : 'Falha de rede');
    }
  }
  const pending = await pendingCount();
  const summary = await readSnapshotSummary();
  return {
    ok: pending === 0,
    syncedSales,
    syncedCash,
    stockConflicts,
    pending,
    error: pending > 0 ? `${summary.pendingSales} venda(s) e ${summary.pendingCash} movimento(s) ainda pendentes.` : undefined,
  };
}
