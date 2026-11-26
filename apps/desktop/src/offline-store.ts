import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';

export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SnapshotProduct = {
  variantId: string;
  name: string;
  controlNumber: number;
  sku: string;
  barcode: string | null;
  price: string;
  stockQty: number;
  isService: boolean;
};

export type SnapshotCustomer = {
  id: string;
  name: string;
  document: string | null;
  creditLimit: string;
  requisitionLimit: string;
};

export type OfflineSnapshot = {
  capturedAt: string;
  company: { id: string; tradeName: string; legalName: string; cnpj: string } | null;
  payments: string[];
  cashSession: { id: string; controlNumber: number; openedAt: string } | null;
  products: SnapshotProduct[];
  customers: SnapshotCustomer[];
};

export type LocalSaleInput = {
  customerId?: string | null;
  receiptNote?: string | null;
  items: Array<{ variantId: string; quantity: number; unitPrice: number; name: string }>;
  payments: Array<{ method: string; amount: number }>;
};

type Store = {
  db: Database;
  persist: () => void;
};

let opening: Promise<Store> | null = null;

function dbPath(): string {
  return path.join(app.getPath('userData'), 'offline.sqlite');
}

async function openStore(): Promise<Store> {
  const wasmDir = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist'),
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist'),
  ].find((dir) => fs.existsSync(path.join(dir, 'sql-wasm.wasm')));
  if (!wasmDir) throw new Error('Arquivo sql-wasm.wasm não encontrado.');
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file),
  });
  const file = dbPath();
  const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS products (
      variant_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      control_number INTEGER,
      sku TEXT,
      barcode TEXT,
      price TEXT NOT NULL,
      stock_qty REAL NOT NULL,
      is_service INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT,
      credit_limit TEXT,
      requisition_limit TEXT
    );
    CREATE TABLE IF NOT EXISTS company (
      id TEXT PRIMARY KEY,
      trade_name TEXT,
      legal_name TEXT,
      cnpj TEXT
    );
    CREATE TABLE IF NOT EXISTS cash_session (
      id TEXT PRIMARY KEY,
      control_number INTEGER,
      opened_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox_sales (
      client_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      server_number INTEGER,
      server_id TEXT,
      stock_conflict INTEGER,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox_cash (
      client_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount TEXT NOT NULL,
      reason TEXT,
      cash_session_id TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );
  `);
  const persist = () => {
    const data = db.export();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data));
  };
  persist();
  return { db, persist };
}

function store(): Promise<Store> {
  if (!opening) opening = openStore();
  return opening;
}

function meta(db: Database, key: string): string | null {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  stmt.bind([key]);
  const value = stmt.step() ? String(stmt.getAsObject().value ?? '') : null;
  stmt.free();
  return value;
}

export async function snapshotAgeMs(): Promise<number | null> {
  const { db } = await store();
  const at = meta(db, 'capturedAt');
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

export async function snapshotIsFresh(): Promise<boolean> {
  const age = await snapshotAgeMs();
  return age != null && age >= 0 && age <= SNAPSHOT_MAX_AGE_MS;
}

export async function readSnapshotSummary(): Promise<{
  capturedAt: string | null;
  fresh: boolean;
  companyName: string | null;
  productCount: number;
  pendingSales: number;
  pendingCash: number;
  cashOpen: boolean;
}> {
  const { db } = await store();
  const capturedAt = meta(db, 'capturedAt');
  const age = capturedAt ? Date.now() - Date.parse(capturedAt) : null;
  const company = db.exec('SELECT trade_name FROM company LIMIT 1');
  const products = db.exec('SELECT COUNT(*) AS n FROM products');
  const sales = db.exec("SELECT COUNT(*) AS n FROM outbox_sales WHERE status = 'pending'");
  const cash = db.exec("SELECT COUNT(*) AS n FROM outbox_cash WHERE status = 'pending'");
  const session = db.exec('SELECT COUNT(*) AS n FROM cash_session');
  const cell = (result: ReturnType<Database['exec']>) => Number(result[0]?.values[0]?.[0] ?? 0);
  return {
    capturedAt,
    fresh: age != null && age >= 0 && age <= SNAPSHOT_MAX_AGE_MS,
    companyName: company[0]?.values[0]?.[0] != null ? String(company[0].values[0][0]) : null,
    productCount: cell(products),
    pendingSales: cell(sales),
    pendingCash: cell(cash),
    cashOpen: cell(session) > 0,
  };
}

export async function replaceSnapshot(snapshot: OfflineSnapshot, preserveStock: boolean): Promise<void> {
  const { db, persist } = await store();
  const previousStock = new Map<string, number>();
  let previousCash: { id: string; controlNumber: number; openedAt: string } | null = null;
  if (preserveStock) {
    const stmt = db.prepare('SELECT variant_id, stock_qty FROM products');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      previousStock.set(String(row.variant_id), Number(row.stock_qty));
    }
    stmt.free();
    const cash = rows(db, 'SELECT id, control_number, opened_at FROM cash_session LIMIT 1');
    if (cash[0]) {
      previousCash = {
        id: String(cash[0].id),
        controlNumber: Number(cash[0].control_number),
        openedAt: String(cash[0].opened_at),
      };
    }
  }
  db.run('BEGIN');
  try {
    db.run('DELETE FROM products');
    db.run('DELETE FROM customers');
    db.run('DELETE FROM company');
    db.run('DELETE FROM cash_session');
    const insertProduct = db.prepare(
      `INSERT INTO products (variant_id, name, control_number, sku, barcode, price, stock_qty, is_service)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of snapshot.products) {
      const stock = preserveStock && previousStock.has(p.variantId) ? previousStock.get(p.variantId)! : p.stockQty;
      insertProduct.run([
        p.variantId,
        p.name,
        p.controlNumber,
        p.sku,
        p.barcode,
        p.price,
        stock,
        p.isService ? 1 : 0,
      ]);
    }
    insertProduct.free();
    const insertCustomer = db.prepare(
      `INSERT INTO customers (id, name, document, credit_limit, requisition_limit) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const c of snapshot.customers) {
      insertCustomer.run([c.id, c.name, c.document, c.creditLimit, c.requisitionLimit]);
    }
    insertCustomer.free();
    if (snapshot.company) {
      db.run('INSERT INTO company (id, trade_name, legal_name, cnpj) VALUES (?, ?, ?, ?)', [
        snapshot.company.id,
        snapshot.company.tradeName,
        snapshot.company.legalName,
        snapshot.company.cnpj,
      ]);
    }
    const cashToKeep = previousCash ?? snapshot.cashSession;
    if (cashToKeep) {
      db.run('INSERT INTO cash_session (id, control_number, opened_at) VALUES (?, ?, ?)', [
        cashToKeep.id,
        cashToKeep.controlNumber,
        cashToKeep.openedAt,
      ]);
    }
    db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      'capturedAt',
      snapshot.capturedAt,
    ]);
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
  persist();
}

function rows(db: Database, sql: string, params: SqlValue[] = []): Array<Record<string, SqlValue>> {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out: Array<Record<string, SqlValue>> = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export async function searchProducts(query: string): Promise<
  Array<{ variantId: string; name: string; sku: string; price: string; stockQty: number; isService: boolean }>
> {
  const { db } = await store();
  const q = `%${query.trim()}%`;
  const list = rows(
    db,
    `SELECT variant_id, name, sku, price, stock_qty, is_service FROM products
     WHERE ? = '%%' OR name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR CAST(control_number AS TEXT) LIKE ?
     ORDER BY name LIMIT 40`,
    [q, q, q, q, q],
  );
  return list.map((r) => ({
    variantId: String(r.variant_id),
    name: String(r.name),
    sku: String(r.sku ?? ''),
    price: String(r.price),
    stockQty: Number(r.stock_qty),
    isService: Number(r.is_service) === 1,
  }));
}

export async function searchCustomers(query: string): Promise<SnapshotCustomer[]> {
  const { db } = await store();
  const q = `%${query.trim()}%`;
  const list = rows(
    db,
    `SELECT id, name, document, credit_limit, requisition_limit FROM customers
     WHERE ? = '%%' OR name LIKE ? OR ifnull(document, '') LIKE ?
     ORDER BY name LIMIT 20`,
    [q, q, q],
  );
  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    document: r.document == null ? null : String(r.document),
    creditLimit: String(r.credit_limit ?? '0'),
    requisitionLimit: String(r.requisition_limit ?? '0'),
  }));
}

export async function cashSessionId(): Promise<string | null> {
  const { db } = await store();
  const list = rows(db, 'SELECT id FROM cash_session LIMIT 1');
  return list[0] ? String(list[0].id) : null;
}

export async function enqueueSale(input: LocalSaleInput): Promise<{ clientId: string; total: string }> {
  const { db, persist } = await store();
  if (!input.items.length) throw new Error('Inclua ao menos um produto.');
  const total = input.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const paid = input.payments.reduce((s, p) => s + p.amount, 0);
  if (paid + 0.02 < total) throw new Error('Pagamento insuficiente.');
  for (const it of input.items) {
    const found = rows(db, 'SELECT stock_qty, is_service, name FROM products WHERE variant_id = ?', [
      it.variantId,
    ]);
    if (!found[0]) throw new Error('Produto não está na cópia local.');
    if (Number(found[0].is_service) !== 1 && Number(found[0].stock_qty) + 0.0001 < it.quantity) {
      throw new Error(`Estoque local insuficiente de ${String(found[0].name)}.`);
    }
  }
  const clientId = crypto.randomUUID();
  const payload = {
    clientSaleId: clientId,
    customerId: input.customerId ?? null,
    cashSessionId: await cashSessionId(),
    receiptNote: input.receiptNote ?? null,
    items: input.items.map((it) => ({
      variantId: it.variantId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
    payments: input.payments,
  };
  db.run('BEGIN');
  try {
    for (const it of input.items) {
      db.run('UPDATE products SET stock_qty = stock_qty - ? WHERE variant_id = ? AND is_service = 0', [
        it.quantity,
        it.variantId,
      ]);
    }
    db.run(
      `INSERT INTO outbox_sales (client_id, payload, created_at, status, server_number, server_id, stock_conflict, error)
       VALUES (?, ?, ?, 'pending', NULL, NULL, 0, NULL)`,
      [clientId, JSON.stringify(payload), new Date().toISOString()],
    );
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
  persist();
  return { clientId, total: total.toFixed(2) };
}

export async function enqueueCash(input: { type: 'IN' | 'OUT'; amount: number; reason?: string }): Promise<string> {
  const { db, persist } = await store();
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Valor inválido.');
  const session = await cashSessionId();
  if (!session) throw new Error('Não há caixa aberto na cópia local.');
  const clientId = crypto.randomUUID();
  db.run(
    `INSERT INTO outbox_cash (client_id, type, amount, reason, cash_session_id, created_at, status, error)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
    [clientId, input.type, input.amount.toFixed(2), input.reason ?? '', session, new Date().toISOString()],
  );
  persist();
  return clientId;
}

export async function pendingSales(): Promise<
  Array<{ clientId: string; payload: string; createdAt: string; error: string | null }>
> {
  const { db } = await store();
  return rows(db, `SELECT client_id, payload, created_at, error FROM outbox_sales WHERE status = 'pending' ORDER BY created_at`).map(
    (r) => ({
      clientId: String(r.client_id),
      payload: String(r.payload),
      createdAt: String(r.created_at),
      error: r.error == null ? null : String(r.error),
    }),
  );
}

export async function pendingCash(): Promise<
  Array<{ clientId: string; type: string; amount: string; reason: string; cashSessionId: string | null; error: string | null }>
> {
  const { db } = await store();
  return rows(
    db,
    `SELECT client_id, type, amount, reason, cash_session_id, error FROM outbox_cash WHERE status = 'pending' ORDER BY created_at`,
  ).map((r) => ({
    clientId: String(r.client_id),
    type: String(r.type),
    amount: String(r.amount),
    reason: String(r.reason ?? ''),
    cashSessionId: r.cash_session_id == null ? null : String(r.cash_session_id),
    error: r.error == null ? null : String(r.error),
  }));
}

export async function markSaleSynced(
  clientId: string,
  result: { saleId: string; number: number; stockConflict: boolean },
): Promise<void> {
  const { db, persist } = await store();
  db.run(
    `UPDATE outbox_sales SET status = 'synced', server_id = ?, server_number = ?, stock_conflict = ?, error = NULL WHERE client_id = ?`,
    [result.saleId, result.number, result.stockConflict ? 1 : 0, clientId],
  );
  persist();
}

export async function markSaleError(clientId: string, error: string): Promise<void> {
  const { db, persist } = await store();
  db.run(`UPDATE outbox_sales SET error = ? WHERE client_id = ? AND status = 'pending'`, [error.slice(0, 500), clientId]);
  persist();
}

export async function markCashSynced(clientId: string): Promise<void> {
  const { db, persist } = await store();
  db.run(`UPDATE outbox_cash SET status = 'synced', error = NULL WHERE client_id = ?`, [clientId]);
  persist();
}

export async function markCashError(clientId: string, error: string): Promise<void> {
  const { db, persist } = await store();
  db.run(`UPDATE outbox_cash SET error = ? WHERE client_id = ? AND status = 'pending'`, [error.slice(0, 500), clientId]);
  persist();
}

export async function pendingCount(): Promise<number> {
  const summary = await readSnapshotSummary();
  return summary.pendingSales + summary.pendingCash;
}
