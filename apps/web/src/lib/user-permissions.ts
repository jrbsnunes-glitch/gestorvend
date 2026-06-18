/** Códigos alinhados ao enum `UserPermissionCode` da API. */
export type UserPermissionCode = 'SALE_DISCOUNT' | 'SALE_CANCEL' | 'FISCAL_DOC_CANCEL';

export type UserPermissionRow = {
  code: UserPermissionCode;
  label: string;
  description: string;
  enabled: boolean;
  hasPassword: boolean;
};

export type UserPermissionsResponse = {
  isAdmin: boolean;
  permissions: UserPermissionRow[];
};

export function hasUserPermission(
  data: UserPermissionsResponse | undefined,
  code: UserPermissionCode,
): boolean {
  if (!data) return false;
  if (data.isAdmin) return true;
  return data.permissions.some((p) => p.code === code && p.enabled);
}
