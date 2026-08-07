import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';
import {
  canMenu,
  type MenuAccessAction,
  type MenuAccessResponse,
} from '../lib/menu-access';

export function useMenuAccess() {
  const manager = isManager();
  const q = useQuery({
    queryKey: ['users', 'me', 'menu-access'],
    queryFn: () => api<MenuAccessResponse>('/users/me/menu-access'),
    staleTime: 60_000,
  });

  function allowed(menuKey: string, action: MenuAccessAction): boolean {
    if (manager) return true;
    return canMenu(q.data, menuKey, action);
  }

  return {
    ...q,
    isFullAccess: manager || Boolean(q.data?.isFullAccess),
    allowed,
    canView: (menuKey: string) => allowed(menuKey, 'view'),
    canCreate: (menuKey: string) => allowed(menuKey, 'create'),
    canUpdate: (menuKey: string) => allowed(menuKey, 'update'),
    canDelete: (menuKey: string) => allowed(menuKey, 'delete'),
  };
}
