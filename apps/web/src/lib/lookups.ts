import { api } from './api';

export type CepLookup = {
  zip: string;
  street: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  ibge: string | null;
};

export type CnpjLookup = {
  document: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
};

export function lookupCep(cep: string) {
  const digits = cep.replace(/\D/g, '');
  return api<CepLookup>(`/lookups/cep/${digits}`);
}

export function lookupCnpj(cnpj: string) {
  const digits = cnpj.replace(/\D/g, '');
  return api<CnpjLookup>(`/lookups/cnpj/${digits}`);
}
