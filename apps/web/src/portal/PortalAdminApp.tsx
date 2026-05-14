import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { getPortalToken } from './portal-api';
import { PortalAdminLayout } from './PortalAdminLayout';
import { PortalClientsPage } from './PortalClientsPage';
import { PortalLogin } from './PortalLogin';
import './portal.css';

/**
 * Roteador do portal de licenciamento. Convive com o `App.tsx` principal
 * sob o prefixo `/portal-admin/*` (configurado pelo `BrowserRouter` raiz).
 *
 * O login vive em `/portal-admin/login`; tudo o que estiver dentro de
 * `PortalAdminLayout` exige um token armazenado em `portal_token`. Quando
 * ausente, redirecionamos para o login.
 */
export function PortalAdminApp() {
  return (
    <Routes>
      <Route path="login" element={<PortalLogin />} />
      <Route element={<RequirePortalAuth />}>
        <Route element={<PortalAdminLayout />}>
          <Route index element={<Navigate to="clientes" replace />} />
          <Route path="clientes" element={<PortalClientsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="login" replace />} />
    </Routes>
  );
}

function RequirePortalAuth() {
  const token = getPortalToken();
  if (!token) return <Navigate to="/portal-admin/login" replace />;
  return <Outlet />;
}
