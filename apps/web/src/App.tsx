import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { GV_UNAUTHORIZED_EVENT, clearAuthStorage, getToken, scheduleAccessTokenRefresh } from './lib/api';
import { CashPage } from './pages/CashPage';
import { CashPrintPage } from './pages/CashPrintPage';
import { CashPrintItemsPage } from './pages/CashPrintItemsPage';
import { CompanyPage } from './pages/CompanyPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { Login } from './pages/Login';
import { ProductsPage } from './pages/ProductsPage';
import { SaleReceiptPrintPage } from './pages/SaleReceiptPrintPage';
import { SalesPage } from './pages/SalesPage';
import { StockEntradaPage } from './pages/stock/StockEntradaPage';
import { StockFechamentoPage } from './pages/stock/StockFechamentoPage';
import { StockLocaisPage } from './pages/stock/StockLocaisPage';
import { StockMovimentosPage } from './pages/stock/StockMovimentosPage';
import { StockMovPrintPage } from './pages/stock/StockMovPrintPage';
import { PortalAdminApp } from './portal/PortalAdminApp';
import { StockPainelPage } from './pages/stock/StockPainelPage';
import { StockSaidasPage } from './pages/stock/StockSaidasPage';
import { StockShell } from './pages/stock/StockShell';
import { SuppliersPage } from './pages/SuppliersPage';
import { UsersPage } from './pages/UsersPage';
import './index.css';
import './styles/ui.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AppInner() {
  const [token, setTok] = useState(() => getToken());

  useEffect(() => {
    if (token) scheduleAccessTokenRefresh();
  }, [token]);

  useEffect(() => {
    function onSessionExpired() {
      setTok(null);
      qc.clear();
    }
    window.addEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
    return () => window.removeEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
  }, []);

  // O portal de licenciamento é totalmente isolado do app principal — vive
  // sob `/portal-admin/*` e não compartilha o token do tenant. Detectamos a
  // URL antes do `Login` para que SuperAdmins possam acessar mesmo sem
  // sessão de tenant aberta.
  const isPortalPath =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/portal-admin');

  if (isPortalPath) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/portal-admin/*" element={<PortalAdminApp />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (!token) {
    return (
      <Login
        onLoggedIn={() => {
          setTok(getToken());
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/*
          Rota /vendas fica fora do AppLayout: o PDV roda em tela cheia
          (sem sidebar) para maximizar a área útil de operação no balcão.
          O próprio shell do PDV oferece um botão "Sair" que devolve o
          usuário ao Dashboard.
        */}
        <Route path="vendas" element={<SalesPage />} />
        <Route path="vendas/impressao" element={<SaleReceiptPrintPage />} />

        {/*
          /caixa/impressao também fica fora do AppLayout para apresentar um
          documento "limpo", pronto para Ctrl+P, sem sidebar nem cabeçalho
          do app interferindo na visualização ou na impressão em papel.
        */}
        <Route path="caixa/impressao" element={<CashPrintPage />} />
        <Route path="caixa/impressao/itens" element={<CashPrintItemsPage />} />
        <Route path="estoque/movimentos/impressao" element={<StockMovPrintPage />} />

        <Route
          element={
            <AppLayout
              onLogout={() => {
                clearAuthStorage();
                setTok(null);
              }}
            />
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="clientes" element={<CustomersPage />} />
          <Route path="fornecedores" element={<SuppliersPage />} />
          <Route path="produtos" element={<ProductsPage />} />
          <Route path="estoque" element={<StockShell />}>
            <Route index element={<Navigate to="painel" replace />} />
            <Route path="painel" element={<StockPainelPage />} />
            <Route path="entrada" element={<StockEntradaPage />} />
            <Route path="saidas" element={<StockSaidasPage />} />
            <Route path="locais" element={<StockLocaisPage />} />
            <Route path="movimentos" element={<StockMovimentosPage />} />
            <Route path="fechamento" element={<StockFechamentoPage />} />
          </Route>
          <Route path="caixa" element={<CashPage />} />
          <Route path="financeiro" element={<FinancePage />} />
          <Route path="empresa" element={<CompanyPage />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AppInner />
    </QueryClientProvider>
  );
}
