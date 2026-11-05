import { BadRequestException } from '@nestjs/common';
import { DeliveryDistrictMode } from '../generated/tenant-client';

const DEFAULT_OUT_OF_AREA_MESSAGE =
  'Ainda não entregamos no bairro {bairro}. Você pode retirar no restaurante — combinamos o horário na confirmação!';

export function normalizeDistrictName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

export function parseDistrictsJson(json: string | null | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => normalizeDistrictName(String(x ?? '')))
      .filter((x) => x.length > 0);
  } catch {
    return [];
  }
}

/** Converte texto da UI (um bairro por linha) em JSON para persistência. */
export function districtsTextToJson(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return JSON.stringify(lines);
}

export function districtsJsonToText(json: string | null | undefined): string {
  if (!json?.trim()) return '';
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return '';
    return parsed.map((x) => String(x ?? '').trim()).filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

export function formatDistrictMessage(
  template: string | null | undefined,
  bairro: string,
  cidade: string,
): string {
  const base = (template?.trim() || DEFAULT_OUT_OF_AREA_MESSAGE).slice(0, 500);
  return base.replace(/\{bairro\}/gi, bairro).replace(/\{cidade\}/gi, cidade);
}

export function isDistrictAllowed(
  mode: DeliveryDistrictMode,
  districts: string[],
  districtRaw: string,
): boolean {
  if (mode === DeliveryDistrictMode.OFF || !districts.length) return true;
  const key = normalizeDistrictName(districtRaw);
  if (!key) return mode !== DeliveryDistrictMode.ALLOWLIST;
  const hit = districts.some((d) => d === key || key.includes(d) || d.includes(key));
  if (mode === DeliveryDistrictMode.ALLOWLIST) return hit;
  if (mode === DeliveryDistrictMode.BLOCKLIST) return !hit;
  return true;
}

export type PublicDistrictPolicy = {
  mode: 'OFF' | 'ALLOWLIST' | 'BLOCKLIST';
  districts: string[];
  districtsDisplay: string[];
  message: string;
};

export function buildPublicDistrictPolicy(co: {
  deliveryDistrictMode?: DeliveryDistrictMode | null;
  deliveryDistrictsJson?: string | null;
  deliveryDistrictMessage?: string | null;
  city?: string | null;
}): PublicDistrictPolicy {
  const mode = co.deliveryDistrictMode ?? DeliveryDistrictMode.OFF;
  const modeStr =
    mode === DeliveryDistrictMode.ALLOWLIST
      ? 'ALLOWLIST'
      : mode === DeliveryDistrictMode.BLOCKLIST
        ? 'BLOCKLIST'
        : 'OFF';
  let districtsDisplay: string[] = [];
  try {
    const raw = co.deliveryDistrictsJson ? JSON.parse(co.deliveryDistrictsJson) : [];
    if (Array.isArray(raw)) {
      districtsDisplay = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    }
  } catch {
    districtsDisplay = [];
  }
  const districts = parseDistrictsJson(co.deliveryDistrictsJson);
  return {
    mode: modeStr,
    districts,
    districtsDisplay,
    message: (co.deliveryDistrictMessage?.trim() || DEFAULT_OUT_OF_AREA_MESSAGE).slice(0, 500),
  };
}

export function assertDeliveryDistrictAllowed(
  co: {
    deliveryDistrictMode?: DeliveryDistrictMode | null;
    deliveryDistrictsJson?: string | null;
    deliveryDistrictMessage?: string | null;
    city?: string | null;
  },
  districtRaw: string,
): void {
  const mode = co.deliveryDistrictMode ?? DeliveryDistrictMode.OFF;
  if (mode === DeliveryDistrictMode.OFF) return;
  const districts = parseDistrictsJson(co.deliveryDistrictsJson);
  if (!districts.length) return;

  const district = String(districtRaw ?? '').trim();
  if (!district) {
    throw new BadRequestException('Informe o bairro para entrega.');
  }
  if (!isDistrictAllowed(mode, districts, district)) {
    const message = formatDistrictMessage(
      co.deliveryDistrictMessage,
      district,
      co.city?.trim() || '',
    );
    throw new BadRequestException({
      code: 'DELIVERY_DISTRICT_NOT_COVERED',
      message,
    });
  }
}

export function formatDeliveryAddress(fields: {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
}): string {
  const street = String(fields.street ?? '').trim();
  const number = String(fields.number ?? '').trim();
  const complement = String(fields.complement ?? '').trim();
  const district = String(fields.district ?? '').trim();
  const city = String(fields.city ?? '').trim();
  const head = street
    ? number
      ? `${street}, ${number}${complement ? ` - ${complement}` : ''}`
      : `${street}${complement ? ` - ${complement}` : ''}`
    : '';
  const tail = [district, city].filter(Boolean).join(' - ');
  const full = [head, tail].filter(Boolean).join(' - ');
  return full.slice(0, 240);
}
