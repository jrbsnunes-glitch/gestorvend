/**
 * Cupom em texto ESC/POS (42 colunas, CP850, fonte A).
 * A térmica desenha o glifo dela — sem foto da tela, sem corte e sem letra duplicada.
 */

export const ESCPOS_COLS = 42;

export type ReceiptTicket = {
  title: string;
  legal: string;
  companyLines: string[];
  headlines: string[];
  banners: string[];
  metas: Array<{ left: string; right: string }>;
  items: Array<{ name: string; sku: string; qty: string; total: string }>;
  totals: Array<{ left: string; right: string; emph?: boolean }>;
  payments: Array<{ left: string; right: string }>;
  notes?: string;
  foot: string[];
};

const CP850: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  '¿': 0xa8,
  ã: 0xc6,
  Ã: 0xc7,
  õ: 0xe4,
  Õ: 0xe5,
  '°': 0xf8,
  '²': 0xfd,
};

function normalizeChars(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function normalizeReceiptText(text: string): string {
  return normalizeChars(text).replace(/\s+/g, ' ').trim();
}

function encodeCp850(text: string): Buffer {
  const clean = normalizeChars(text);
  const out: number[] = [];
  for (const ch of clean) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const mapped = CP850[ch];
    if (mapped != null) {
      out.push(mapped);
      continue;
    }
    out.push(0x3f);
  }
  return Buffer.from(out);
}

function wrapLine(text: string, width: number): string[] {
  const clean = normalizeReceiptText(text);
  if (!clean) return [];
  if (clean.length <= width) return [clean];
  const words = clean.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      if (w.length <= width) {
        cur = w;
      } else {
        for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      }
      continue;
    }
    if (`${cur} ${w}`.length <= width) cur = `${cur} ${w}`;
    else {
      lines.push(cur);
      if (w.length <= width) cur = w;
      else {
        for (let i = 0; i < w.length; i += width) {
          if (i + width >= w.length) cur = w.slice(i);
          else lines.push(w.slice(i, i + width));
        }
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function pairLine(left: string, right: string, width = ESCPOS_COLS): string[] {
  const L = normalizeReceiptText(left);
  const R = normalizeReceiptText(right);
  if (!L && !R) return [];
  if (!R) return wrapLine(L, width);
  if (L.length + 1 + R.length <= width) {
    return [L + ' '.repeat(width - L.length - R.length) + R];
  }
  return [...wrapLine(L, Math.max(8, width - R.length - 1)), R.padStart(width, ' ')];
}

function dash(): string {
  return '-'.repeat(ESCPOS_COLS);
}

export function buildEscPosText(ticket: ReceiptTicket): Buffer {
  const chunks: Buffer[] = [
    Buffer.from([0x1b, 0x40]), // init
    Buffer.from([0x1b, 0x74, 0x02]), // CP850
    Buffer.from([0x1b, 0x4d, 0x00]), // fonte A (12x24)
    Buffer.from([0x1d, 0x57, 0x00, 0x02]), // área útil 512 dots
    Buffer.from([0x1b, 0x33, 0x26]), // entrelinha um pouco maior
    Buffer.from([0x1b, 0x61, 0x01]), // centro
  ];

  const pushTxt = (s: string) => {
    const line = normalizeChars(s).replace(/\s+$/g, '');
    if (!line.trim()) return;
    chunks.push(encodeCp850(line), Buffer.from([0x0a]));
  };
  const pushWrapped = (s: string, width = ESCPOS_COLS) => {
    for (const line of wrapLine(s, width)) pushTxt(line);
  };
  const setAlign = (n: 0 | 1 | 2) => {
    chunks.push(Buffer.from([0x1b, 0x61, n]));
  };
  const setBold = (on: boolean) => {
    chunks.push(Buffer.from([0x1b, 0x45, on ? 0x01 : 0x00]));
  };
  const setSize = (n: number) => {
    chunks.push(Buffer.from([0x1d, 0x21, n]));
  };

  if (ticket.title) {
    const title = ticket.title.toUpperCase();
    const compact = title.length <= 20;
    setBold(true);
    setSize(compact ? 0x11 : 0x01);
    pushWrapped(title, compact ? 20 : ESCPOS_COLS);
    setSize(0x00);
    setBold(false);
  }
  if (ticket.legal) pushWrapped(ticket.legal);
  for (const line of ticket.companyLines) pushWrapped(line);

  setAlign(0);
  pushTxt(dash());

  if (ticket.headlines.length) {
    setAlign(1);
    setBold(true);
    for (const line of ticket.headlines) pushWrapped(line);
    setBold(false);
    setAlign(0);
  }
  for (const b of ticket.banners) {
    setAlign(1);
    setBold(true);
    pushWrapped(b.toUpperCase());
    setBold(false);
    setAlign(0);
  }

  for (const m of ticket.metas) {
    for (const line of pairLine(m.left, m.right)) pushTxt(line);
  }

  if (ticket.items.length) {
    pushTxt(dash());
    setBold(true);
    pushTxt('ITENS');
    setBold(false);
    for (const it of ticket.items) {
      pushWrapped(it.name);
      if (it.sku) pushWrapped(it.sku);
      for (const line of pairLine(it.qty, it.total)) pushTxt(line);
    }
  }

  if (ticket.totals.length) {
    pushTxt(dash());
    for (const row of ticket.totals) {
      if (row.emph) {
        setBold(true);
        setSize(0x01);
        for (const line of pairLine(row.left.toUpperCase(), row.right)) pushTxt(line);
        setSize(0x00);
        setBold(false);
      } else {
        for (const line of pairLine(row.left, row.right)) pushTxt(line);
      }
    }
  }

  if (ticket.payments.length) {
    pushTxt(dash());
    setBold(true);
    pushTxt('PAGAMENTOS');
    setBold(false);
    for (const p of ticket.payments) {
      for (const line of pairLine(p.left, p.right)) pushTxt(line);
    }
  }

  if (ticket.notes?.trim()) {
    pushTxt(dash());
    pushWrapped(`Obs. ${ticket.notes}`);
  }

  if (ticket.foot.length) {
    pushTxt(dash());
    setAlign(1);
    for (const f of ticket.foot) pushWrapped(f);
    setAlign(0);
  }

  chunks.push(Buffer.from([0x0a, 0x0a]));
  chunks.push(Buffer.from([0x1b, 0x64, 0x04]));
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10]));
  return Buffer.concat(chunks);
}

/** Só para conferência local: devolve o cupom em ASCII, sem os comandos. */
export function previewEscPosText(ticket: ReceiptTicket): string {
  const payload = buildEscPosText(ticket);
  const lines: string[] = [];
  let buf = '';
  for (let i = 0; i < payload.length; i++) {
    const b = payload[i];
    if (b === 0x1b || b === 0x1d) {
      const next = payload[i + 1];
      i += next === 0x21 || next === 0x56 || next === 0x57 ? 3 : 2;
      if (next === 0x56) i += 1;
      continue;
    }
    if (b === 0x0a) {
      lines.push(buf);
      buf = '';
      continue;
    }
    if (b >= 0x20 && b < 0x7f) buf += String.fromCharCode(b);
    else if (b === 0xc6) buf += 'a';
    else if (b === 0x87) buf += 'c';
    else buf += '?';
  }
  if (buf) lines.push(buf);
  return lines.filter((l) => l.trim() || l.includes(' ')).join('\n');
}

export const EXTRACT_RECEIPT_TICKET_JS = `
(() => {
  const a = document.querySelector('article.sale-receipt-doc');
  if (!a) return null;
  const raw = a.getAttribute('data-gv-ticket');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.title || (parsed.items && parsed.items.length))) return parsed;
    } catch (e) {}
  }
  const tx = (el) => (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
  const all = (sel, root) => Array.from((root || a).querySelectorAll(sel)).map(tx).filter(Boolean);
  const header = a.querySelector('header');
  const metas = Array.from(a.querySelectorAll('.sale-receipt-meta')).map((el) => {
    const kids = Array.from(el.children).map(tx);
    return { left: kids[0] || '', right: kids[1] || '' };
  }).filter((m) => m.left || m.right);
  const items = Array.from(a.querySelectorAll('.sale-receipt-items > li')).map((li) => {
    const desc = li.querySelector('.sale-receipt-item-desc:not(.sale-receipt-item-sku)');
    const sku = li.querySelector('.sale-receipt-item-sku');
    const qtyKids = Array.from((li.querySelector('.sale-receipt-item-qty') || li).children).map(tx);
    return {
      name: tx(desc) || tx(li),
      sku: tx(sku),
      qty: qtyKids[0] || '',
      total: qtyKids[1] || '',
    };
  });
  const totals = Array.from(a.querySelectorAll('.sale-receipt-totals-row')).map((row) => {
    const kids = Array.from(row.children).map(tx);
    return {
      left: kids[0] || '',
      right: kids[1] || '',
      emph: row.classList.contains('is-total') || row.classList.contains('is-sold'),
    };
  });
  const payments = Array.from(a.querySelectorAll('.sale-receipt-payments > li')).map((li) => {
    const kids = Array.from(li.children).map(tx);
    return { left: kids[0] || '', right: kids[1] || '' };
  });
  const headlines = [];
  for (const el of a.querySelectorAll('.sale-receipt-center.sale-receipt-sub, .sale-receipt-fiscal-note')) {
    if (header && header.contains(el)) continue;
    const v = tx(el);
    if (v) headlines.push(v);
  }
  const notesEl = Array.from(a.querySelectorAll('.sale-receipt-sub')).find((el) =>
    /^Obs\\.?\\s/i.test(tx(el)),
  );
  const foot = [];
  const footRoot = a.querySelector('.sale-receipt-foot');
  if (footRoot) {
    for (const p of footRoot.querySelectorAll('p')) {
      const v = tx(p);
      if (v) foot.push(v);
    }
  }
  const nfceKey = tx(a.querySelector('.sale-receipt-nfce-key'));
  if (nfceKey) foot.unshift(nfceKey);
  return {
    title: all('.sale-receipt-title')[0] || '',
    legal: header ? all('.sale-receipt-legal', header)[0] || '' : '',
    companyLines: header ? all('.sale-receipt-sub', header) : [],
    headlines,
    banners: all('.sale-receipt-banner'),
    metas,
    items,
    totals,
    payments,
    notes: notesEl ? tx(notesEl).replace(/^Obs\\.?\\s*/i, '') : '',
    foot,
  };
})()
`;
