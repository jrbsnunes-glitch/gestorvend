import { UserPermissionCode } from '../generated/tenant-client';

export type PermissionMeta = {
  code: UserPermissionCode;
  label: string;
  description: string;
};

export const USER_PERMISSION_CATALOG: PermissionMeta[] = [
  {
    code: UserPermissionCode.SALE_DISCOUNT,
    label: 'Desconto em vendas',
    description: 'Permite aplicar desconto no total da venda no PDV (exige senha de autorização).',
  },
  {
    code: UserPermissionCode.SALE_CANCEL,
    label: 'Cancelamento de venda',
    description: 'Permite cancelar vendas concluídas e estornar estoque (exige senha de autorização).',
  },
  {
    code: UserPermissionCode.FISCAL_DOC_CANCEL,
    label: 'Cancelamento de nota fiscal',
    description: 'Permite cancelar documento fiscal vinculado à venda (exige senha de autorização).',
  },
];

export const ALL_PERMISSION_CODES = USER_PERMISSION_CATALOG.map((p) => p.code);
