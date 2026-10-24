/**
 * Carga dos clientes Náutica Balby (CSV extraído do PDF).
 *
 * Fonte: python apps/api/scripts/extract-balby-customers.py
 *        → docs/balby/CLIENTES NAUTICA BALBY.pdf
 *
 * Idempotente pelo código VR gravado em notes (`[VR:123]`). Se não achar o
 * código e houver documento, tenta o documento. Nova execução atualiza nome,
 * contato e endereço.
 *
 * Uso (na raiz, com o Postgres no ar):
 *   npm run tenant:import-balby-customers -w @gestorvend/api
 *
 * O banco padrão é gv_tenant_balby, montado a partir de TENANT_DATABASE_URL.
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';
import { validateCnpj14 } from '../src/common/cnpj.util';
import { validateCpf11 } from '../src/common/cpf.util';
import { buildTenantDatabaseUrl } from '../src/provisioning/tenant-database-name';

/* eslint-disable no-console */

const DATABASE_NAME = 'gv_tenant_balby';
const VR_TAG = (code: string) => `[VR:${code}]`;

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const isDbUrl = key === 'CENTRAL_DATABASE_URL' || key === 'TENANT_DATABASE_URL';
    if (isDbUrl || process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

type CsvRow = {
  codigo: string;
  nome: string;
  documento: string;
  telefone: string;
  email: string;
  nascimento: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  ie: string;
  rg: string;
  notesExtra: string;
};

function parseCsv(filePath: string): CsvRow[] {
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0] ?? '');
  const idx = (name: string) => header.indexOf(name);
  const iCod = idx('codigo_vr');
  const iNome = idx('nome');
  if (iCod < 0 || iNome < 0) {
    throw new Error(`Cabeçalho inválido em ${filePath}`);
  }
  const iDoc = idx('documento');
  const iTel = idx('telefone');
  const iEmail = idx('email');
  const iNasc = idx('nascimento');
  const iStreet = idx('street');
  const iNumber = idx('number');
  const iCompl = idx('complement');
  const iDist = idx('district');
  const iCity = idx('city');
  const iState = idx('state');
  const iIe = idx('ie');
  const iRg = idx('rg');
  const iNotes = idx('notes_extra');
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const codigo = (cols[iCod] ?? '').trim();
    const nome = (cols[iNome] ?? '').trim();
    if (!codigo || !nome) continue;
    rows.push({
      codigo,
      nome,
      documento: col(cols, iDoc),
      telefone: col(cols, iTel),
      email: col(cols, iEmail),
      nascimento: col(cols, iNasc),
      street: col(cols, iStreet),
      number: col(cols, iNumber),
      complement: col(cols, iCompl),
      district: col(cols, iDist),
      city: col(cols, iCity),
      state: col(cols, iState),
      ie: col(cols, iIe),
      rg: col(cols, iRg),
      notesExtra: col(cols, iNotes),
    });
  }
  return rows;
}

function col(cols: string[], i: number): string {
  if (i < 0) return '';
  return (cols[i] ?? '').trim();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

function firstPhone(raw: string): { phone: string | null; extra: string } {
  const parts = raw
    .split(/[;/|]/)
    .map((p) => p.replace(/\D/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return { phone: null, extra: '' };
  return { phone: parts[0] ?? null, extra: parts.slice(1).join(', ') };
}

function resolveDocument(raw: string): { document: string | null; invalid: string } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { document: null, invalid: '' };
  if (digits.length === 11) {
    const cpf = validateCpf11(digits);
    return cpf.ok ? { document: cpf.cpf, invalid: '' } : { document: null, invalid: raw };
  }
  if (digits.length === 14) {
    const cnpj = validateCnpj14(digits);
    return cnpj.ok ? { document: cnpj.cnpj, invalid: '' } : { document: null, invalid: raw };
  }
  return { document: null, invalid: raw };
}

function parseBirth(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function buildNotes(row: CsvRow, extraPhone: string, invalidDoc: string): string {
  const parts = [VR_TAG(row.codigo)];
  if (row.ie) parts.push(`IE: ${row.ie}`);
  if (row.rg) parts.push(`RG: ${row.rg}`);
  if (extraPhone) parts.push(`Outros telefones: ${extraPhone}`);
  if (invalidDoc) parts.push(`Documento original (inválido): ${invalidDoc}`);
  if (row.notesExtra) parts.push(row.notesExtra);
  return parts.join('\n');
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'));
  loadEnvFile(path.join(apiRoot, '.env'));

  const template = process.env.TENANT_DATABASE_URL?.trim();
  if (!template) throw new Error('TENANT_DATABASE_URL é obrigatório no .env.');
  const tenantUrl = buildTenantDatabaseUrl(template, DATABASE_NAME);
  const csvPath = path.join(repoRoot, 'docs', 'balby', 'clientes-nautica-balby.csv');
  if (!existsSync(csvPath)) {
    throw new Error(`CSV não encontrado: ${csvPath}. Rode extract-balby-customers.py antes.`);
  }

  const rows = parseCsv(csvPath);
  const db = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  let created = 0;
  let updated = 0;
  let skippedDoc = 0;
  const chunk = 80;

  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await db.$transaction(async (tx) => {
      for (const row of slice) {
        const { document, invalid } = resolveDocument(row.documento);
        if (invalid) skippedDoc++;
        const { phone, extra } = firstPhone(row.telefone);
        const notes = buildNotes(row, extra, invalid);
        const birthDate = parseBirth(row.nascimento);
        const state = emptyToNull(row.state)?.toUpperCase().slice(0, 2) ?? null;
        const data = {
          name: row.nome,
          document,
          phone,
          email: emptyToNull(row.email),
          street: emptyToNull(row.street),
          number: emptyToNull(row.number),
          complement: emptyToNull(row.complement),
          district: emptyToNull(row.district),
          city: emptyToNull(row.city),
          state,
          notes,
          birthDate,
        };

        const tag = VR_TAG(row.codigo);
        let existing = await tx.customer.findFirst({
          where: { notes: { startsWith: tag } },
          select: { id: true },
        });
        if (!existing && document) {
          existing = await tx.customer.findFirst({
            where: { document },
            select: { id: true },
          });
        }

        if (!existing) {
          await tx.customer.create({ data });
          created++;
        } else {
          await tx.customer.update({ where: { id: existing.id }, data });
          updated++;
        }
      }
    });
    console.log(`... ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }

  const total = await db.customer.count();
  console.log(`Criados: ${created}`);
  console.log(`Atualizados: ${updated}`);
  console.log(`Documentos inválidos (gravados só nas notas): ${skippedDoc}`);
  console.log(`Clientes no banco: ${total}`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
