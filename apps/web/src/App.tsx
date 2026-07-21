import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import {
  GV_AUTH_CHANGED_EVENT,
  GV_UNAUTHORIZED_EVENT,
  clearAuthStorage,
  getToken,
  scheduleAccessTokenRefresh,
} from './lib/api';
import { isAdmin } from './lib/auth';
import { CashPage } from './pages/CashPage';
import { CashPrintPage } from './pages/CashPrintPage';
import { CashPrintItemsPage } from './pages/CashPrintItemsPage';
import { CompanyPage } from './pages/CompanyPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { FinancialOverviewPage } from './pages/FinancialOverviewPage';
import { FinancialOverviewPrintPage } from './pages/FinancialOverviewPrintPage';
import { FiscalSituationsPage } from './pages/FiscalSituationsPage';
import { FinancialOverviewReportsPage } from './pages/FinancialOverviewReportsPage';
import { GeneralRegistersShell } from './pages/GeneralRegistersShell';
import { ReferentialChartPage } from './pages/ReferentialChartPage';
import { FinancePrintPage } from './pages/FinancePrintPage';
import { PartyFiscalPage } from './pages/PartyFiscalPage';
import { Login } from './pages/Login';
import { ProductReportMovementPrintPage } from './pages/ProductReportMovementPrintPage';
import { ProductReportTurnoverPrintPage } from './pages/ProductReportTurnoverPrintPage';
import { ProductReportStockPrintPage } from './pages/ProductReportStockPrintPage';
import { ProfitabilityReportPage } from './pages/ProfitabilityReportPage';
import { ProductsPage } from './pages/ProductsPage';
import { SaleReceiptPrintPage } from './pages/SaleReceiptPrintPage';
import { SalesPage } from './pages/SalesPage';
import { StockEntradaPage } from './pages/stock/StockEntradaPage';
import { StockInventarioPage } from './pages/stock/StockInventarioPage';
import { StockFechamentoPage } from './pages/stock/StockFechamentoPage';
import { StockLocaisPage } from './pages/stock/StockLocaisPage';
import { StockMovimentosPage } from './pages/stock/StockMovimentosPage';
import { StockMovPrintPage } from './pages/stock/StockMovPrintPage';
import { PortalAdminApp } from './portal/PortalAdminApp';
import { StockNfeInboxPage } from './pages/stock/StockNfeInboxPage';
import { StockPainelPage } from './pages/stock/StockPainelPage';
import { StockSaidasPage } from './pages/stock/StockSaidasPage';
import { StockShell } from './pages/stock/StockShell';
import { StockTransferenciasPage } from './pages/stock/StockTransferenciasPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { UsersPage } from './pages/UsersPage';
import { LogsPage } from './pages/LogsPage';
import './index.css';
import './styles/ui.css';
import './styles/reports-document.css';
import './styles/company-branding.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function RequireAdmin({ children }: { children: ReactNode }) {
  const allowed = useMemo(() => isAdmin(), []);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppInner() {
  const [token, setAuthTokenSnap] = useState(() => getToken());

  useEffect(() => {
    function bumpTokenFromStorage(): void {
      setAuthTokenSnap(getToken());
    }
    bumpTokenFromStorage();
    window.addEventListener(GV_AUTH_CHANGED_EVENT, bumpTokenFromStorage);
    window.addEventListener(GV_UNAUTHORIZED_EVENT, bumpTokenFromStorage);
    window.addEventListener('storage', bumpTokenFromStorage);
    return () => {
      window.removeEventListener(GV_AUTH_CHANGED_EVENT, bumpTokenFromStorage);
      window.removeEventListener(GV_UNAUTHORIZED_EVENT, bumpTokenFromStorage);
      window.removeEventListener('storage', bumpTokenFromStorage);
    };
  }, []);

  useEffect(() => {
    if (token) scheduleAccessTokenRefresh();
  }, [token]);

  useEffect(() => {
    function onSessionExpired() {
      // `api()` já chama clearAuthStorage em 401; limpamos o cache aqui antes do reload.
      qc.clear();
      window.location.assign('/');
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
          window.location.reload();
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
        <Route path="produtos/relatorio/movimentacao" element={<ProductReportMovementPrintPage />} />
        <Route path="produtos/relatorio/giro" element={<ProductReportTurnoverPrintPage />} />
        <Route path="produtos/relatorio/estoque-financeiro" element={<ProductReportStockPrintPage />} />
        <Route path="produtos/relatorio/estoque-fisico" element={<ProductReportStockPrintPage />} />
        <Route path="produtos/relatorio/estoque-minimo" element={<ProductReportStockPrintPage />} />
        <Route path="financeiro/impressao" element={<FinancePrintPage />} />
        <Route path="balanco/impressao" element={<FinancialOverviewPrintPage />} />
        <Route path="balanco/rentabilidade" element={<ProfitabilityReportPage />} />

        <Route
          element={
            <AppLayout
              onLogout={() => {
                clearAuthStorage();
                window.location.assign('/');
              }}
            />
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="clientes" element={<CustomersPage />} />
          <Route path="fornecedores" element={<SuppliersPage />} />
          <Route path="produtos" element={<ProductsPage />} />
          <Route path="cadastros" element={<GeneralRegistersShell />}>
            <Route index element={<Navigate to="situacao-fiscal" replace />} />
            <Route path="situacao-fiscal" element={<FiscalSituationsPage />} />
          </Route>
          <Route path="estoque" element={<StockShell />}>
            <Route index element={<Navigate to="painel" replace />} />
            <Route path="painel" element={<StockPainelPage />} />
            <Route path="entrada" element={<StockEntradaPage />} />
            <Route path="nfe-entrada" element={<StockNfeInboxPage />} />
            <Route path="saidas" element={<StockSaidasPage />} />
            <Route path="locais" element={<StockLocaisPage />} />
            <Route path="transferencias" element={<StockTransferenciasPage />} />
            <Route path="inventario" element={<StockInventarioPage />} />
            <Route path="movimentos" element={<StockMovimentosPage />} />
            <Route path="fechamento" element={<StockFechamentoPage />} />
          </Route>
          <Route path="caixa" element={<CashPage />} />
          <Route path="financeiro" element={<FinancePage />} />
          <Route path="notas-fiscais" element={<PartyFiscalPage />} />
          <Route path="balanco" element={<FinancialOverviewPage />} />
          <Route path="balanco/relatorios" element={<FinancialOverviewReportsPage />} />
          <Route path="balanco/plano-contas" element={<ReferentialChartPage />} />
          <Route path="empresa" element={<CompanyPage />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route
            path="logs"
            element={
              <RequireAdmin>
                <LogsPage />
              </RequireAdmin>
            }
          />
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
