import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ManagerPasswordGate } from './components/ManagerPasswordGate';
import { ResponsiveTablesBootstrap } from './components/ResponsiveTablesBootstrap';
import {
  GV_AUTH_CHANGED_EVENT,
  GV_UNAUTHORIZED_EVENT,
  clearAuthStorage,
  getToken,
  scheduleAccessTokenRefresh,
} from './lib/api';
import { hasRestaurantPlan, isAdmin, isWaiter } from './lib/auth';
import { Login } from './pages/Login';
import './index.css';
import './styles/ui.css';
import './styles/reports-document.css';
import './styles/company-branding.css';

/** Code-split: páginas pesadas só baixam quando a rota é aberta (mobile/PC). */
const PortalAdminApp = lazy(() =>
  import('./portal/PortalAdminApp').then((m) => ({ default: m.PortalAdminApp })),
);
const CashPage = lazy(() => import('./pages/CashPage').then((m) => ({ default: m.CashPage })));
const RestaurantFloorPage = lazy(() =>
  import('./pages/restaurant/RestaurantFloorPage').then((m) => ({ default: m.RestaurantFloorPage })),
);
const RestaurantTabPage = lazy(() =>
  import('./pages/restaurant/RestaurantTabPage').then((m) => ({ default: m.RestaurantTabPage })),
);
const RestaurantKitchenPrintPage = lazy(() =>
  import('./pages/restaurant/RestaurantKitchenPrintPage').then((m) => ({
    default: m.RestaurantKitchenPrintPage,
  })),
);
const RestaurantRecipesPage = lazy(() =>
  import('./pages/restaurant/RestaurantRecipesPage').then((m) => ({
    default: m.RestaurantRecipesPage,
  })),
);
const CashPrintPage = lazy(() =>
  import('./pages/CashPrintPage').then((m) => ({ default: m.CashPrintPage })),
);
const CashPrintItemsPage = lazy(() =>
  import('./pages/CashPrintItemsPage').then((m) => ({ default: m.CashPrintItemsPage })),
);
const CompanyPage = lazy(() =>
  import('./pages/CompanyPage').then((m) => ({ default: m.CompanyPage })),
);
const PrintStationsPage = lazy(() =>
  import('./pages/PrintStationsPage').then((m) => ({ default: m.PrintStationsPage })),
);
const CustomersPage = lazy(() =>
  import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const FinancePage = lazy(() =>
  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const FinancialOverviewPage = lazy(() =>
  import('./pages/FinancialOverviewPage').then((m) => ({ default: m.FinancialOverviewPage })),
);
const FinancialOverviewPrintPage = lazy(() =>
  import('./pages/FinancialOverviewPrintPage').then((m) => ({
    default: m.FinancialOverviewPrintPage,
  })),
);
const FiscalSituationsPage = lazy(() =>
  import('./pages/FiscalSituationsPage').then((m) => ({ default: m.FiscalSituationsPage })),
);
const OperationNaturesPage = lazy(() =>
  import('./pages/OperationNaturesPage').then((m) => ({ default: m.OperationNaturesPage })),
);
const FinancialOverviewReportsPage = lazy(() =>
  import('./pages/FinancialOverviewReportsPage').then((m) => ({
    default: m.FinancialOverviewReportsPage,
  })),
);
const GeneralRegistersShell = lazy(() =>
  import('./pages/GeneralRegistersShell').then((m) => ({ default: m.GeneralRegistersShell })),
);
const ReferentialChartPage = lazy(() =>
  import('./pages/ReferentialChartPage').then((m) => ({ default: m.ReferentialChartPage })),
);
const FinancePrintPage = lazy(() =>
  import('./pages/FinancePrintPage').then((m) => ({ default: m.FinancePrintPage })),
);
const PartyFiscalPage = lazy(() =>
  import('./pages/PartyFiscalPage').then((m) => ({ default: m.PartyFiscalPage })),
);
const FiscalNotesPage = lazy(() =>
  import('./pages/FiscalNotesPage').then((m) => ({ default: m.FiscalNotesPage })),
);
const FiscalNotesPrintPage = lazy(() =>
  import('./pages/FiscalNotesPrintPage').then((m) => ({ default: m.FiscalNotesPrintPage })),
);
const NfeFormPage = lazy(() =>
  import('./pages/NfeFormPage').then((m) => ({ default: m.NfeFormPage })),
);
const DanfePrintPage = lazy(() =>
  import('./pages/DanfePrintPage').then((m) => ({ default: m.DanfePrintPage })),
);
const CardsPage = lazy(() => import('./pages/CardsPage').then((m) => ({ default: m.CardsPage })));
const CardsPrintPage = lazy(() =>
  import('./pages/CardsPrintPage').then((m) => ({ default: m.CardsPrintPage })),
);
const PaymentFormsPage = lazy(() =>
  import('./pages/PaymentFormsPage').then((m) => ({ default: m.PaymentFormsPage })),
);
const ProductReportMovementPrintPage = lazy(() =>
  import('./pages/ProductReportMovementPrintPage').then((m) => ({
    default: m.ProductReportMovementPrintPage,
  })),
);
const ProductReportTurnoverPrintPage = lazy(() =>
  import('./pages/ProductReportTurnoverPrintPage').then((m) => ({
    default: m.ProductReportTurnoverPrintPage,
  })),
);
const ProductReportStockPrintPage = lazy(() =>
  import('./pages/ProductReportStockPrintPage').then((m) => ({
    default: m.ProductReportStockPrintPage,
  })),
);
const ProfitabilityReportPage = lazy(() =>
  import('./pages/ProfitabilityReportPage').then((m) => ({ default: m.ProfitabilityReportPage })),
);
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })),
);
const RequisicoesPage = lazy(() =>
  import('./pages/RequisicoesPage').then((m) => ({ default: m.RequisicoesPage })),
);
const SaleReceiptPrintPage = lazy(() =>
  import('./pages/SaleReceiptPrintPage').then((m) => ({ default: m.SaleReceiptPrintPage })),
);
const SalesPage = lazy(() => import('./pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const StockEntradaPage = lazy(() =>
  import('./pages/stock/StockEntradaPage').then((m) => ({ default: m.StockEntradaPage })),
);
const StockInventarioPage = lazy(() =>
  import('./pages/stock/StockInventarioPage').then((m) => ({ default: m.StockInventarioPage })),
);
const StockInventarioCollectorPage = lazy(() =>
  import('./pages/stock/StockInventarioCollectorPage').then((m) => ({
    default: m.StockInventarioCollectorPage,
  })),
);
const StockFechamentoPage = lazy(() =>
  import('./pages/stock/StockFechamentoPage').then((m) => ({ default: m.StockFechamentoPage })),
);
const StockLocaisPage = lazy(() =>
  import('./pages/stock/StockLocaisPage').then((m) => ({ default: m.StockLocaisPage })),
);
const StockMovimentosPage = lazy(() =>
  import('./pages/stock/StockMovimentosPage').then((m) => ({ default: m.StockMovimentosPage })),
);
const StockMovPrintPage = lazy(() =>
  import('./pages/stock/StockMovPrintPage').then((m) => ({ default: m.StockMovPrintPage })),
);
const StockInventorySummaryPrintPage = lazy(() =>
  import('./pages/stock/StockInventorySummaryPrintPage').then((m) => ({
    default: m.StockInventorySummaryPrintPage,
  })),
);
const StockInventoryDivergencePrintPage = lazy(() =>
  import('./pages/stock/StockInventoryDivergencePrintPage').then((m) => ({
    default: m.StockInventoryDivergencePrintPage,
  })),
);
const StockNfeInboxPage = lazy(() =>
  import('./pages/stock/StockNfeInboxPage').then((m) => ({ default: m.StockNfeInboxPage })),
);
const StockPainelPage = lazy(() =>
  import('./pages/stock/StockPainelPage').then((m) => ({ default: m.StockPainelPage })),
);
const StockSaidasPage = lazy(() =>
  import('./pages/stock/StockSaidasPage').then((m) => ({ default: m.StockSaidasPage })),
);
const StockShell = lazy(() =>
  import('./pages/stock/StockShell').then((m) => ({ default: m.StockShell })),
);
const StockTransferenciasPage = lazy(() =>
  import('./pages/stock/StockTransferenciasPage').then((m) => ({
    default: m.StockTransferenciasPage,
  })),
);
const SuppliersPage = lazy(() =>
  import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '40vh',
        display: 'grid',
        placeItems: 'center',
        color: '#64748b',
        fontSize: '0.95rem',
      }}
    >
      Carregando…
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const allowed = useMemo(() => isAdmin(), []);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireRestaurant({ children }: { children: ReactNode }) {
  const allowed = useMemo(() => hasRestaurantPlan(), []);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Garçom não opera PDV/caixa — redireciona para o Salão. */
function BlockWaiterFromPdv({ children }: { children: ReactNode }) {
  const blocked = useMemo(() => isWaiter(), []);
  if (blocked) return <Navigate to="/salao" replace />;
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
      qc.clear();
      window.location.assign('/');
    }
    window.addEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
    return () => window.removeEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
  }, []);

  const isPortalPath =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/portal-admin');

  if (isPortalPath) {
    return (
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/portal-admin/*" element={<PortalAdminApp />} />
          </Routes>
        </Suspense>
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
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="vendas"
            element={
              <BlockWaiterFromPdv>
                <SalesPage />
              </BlockWaiterFromPdv>
            }
          />
          <Route path="vendas/impressao" element={<SaleReceiptPrintPage />} />
          <Route
            path="salao/comanda/:tabId/cozinha"
            element={
              <RequireRestaurant>
                <RestaurantKitchenPrintPage />
              </RequireRestaurant>
            }
          />

          <Route path="caixa/impressao" element={<CashPrintPage />} />
          <Route path="caixa/impressao/itens" element={<CashPrintItemsPage />} />
          <Route path="estoque/movimentos/impressao" element={<StockMovPrintPage />} />
          <Route
            path="estoque/inventario/relatorio/resumo"
            element={<StockInventorySummaryPrintPage />}
          />
          <Route
            path="estoque/inventario/relatorio/divergencias"
            element={<StockInventoryDivergencePrintPage />}
          />
          <Route path="produtos/relatorio/movimentacao" element={<ProductReportMovementPrintPage />} />
          <Route path="produtos/relatorio/giro" element={<ProductReportTurnoverPrintPage />} />
          <Route path="produtos/relatorio/estoque-financeiro" element={<ProductReportStockPrintPage />} />
          <Route path="produtos/relatorio/estoque-fisico" element={<ProductReportStockPrintPage />} />
          <Route path="produtos/relatorio/estoque-minimo" element={<ProductReportStockPrintPage />} />
          <Route path="financeiro/impressao" element={<FinancePrintPage />} />
          <Route path="balanco/impressao" element={<FinancialOverviewPrintPage />} />
          <Route path="balanco/rentabilidade" element={<ProfitabilityReportPage />} />
          <Route path="notas-fiscais/impressao" element={<FiscalNotesPrintPage />} />
          <Route path="notas-fiscais/danfe/:id" element={<DanfePrintPage />} />
          <Route path="cartoes/impressao" element={<CardsPrintPage />} />

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
            <Route
              path="salao"
              element={
                <RequireRestaurant>
                  <RestaurantFloorPage />
                </RequireRestaurant>
              }
            />
            <Route
              path="salao/comanda/:tabId"
              element={
                <RequireRestaurant>
                  <RestaurantTabPage />
                </RequireRestaurant>
              }
            />
            <Route
              path="salao/fichas-tecnicas"
              element={
                <RequireRestaurant>
                  <RestaurantRecipesPage />
                </RequireRestaurant>
              }
            />
            <Route path="clientes" element={<CustomersPage />} />
            <Route path="fornecedores" element={<SuppliersPage />} />
            <Route path="produtos" element={<ProductsPage />} />
            <Route path="cadastros" element={<GeneralRegistersShell />}>
              <Route index element={<Navigate to="situacao-fiscal" replace />} />
              <Route path="situacao-fiscal" element={<FiscalSituationsPage />} />
              <Route path="natureza-operacao" element={<OperationNaturesPage />} />
              <Route path="formas-pagamento" element={<PaymentFormsPage />} />
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
              <Route path="inventario/:id/coletar" element={<StockInventarioCollectorPage />} />
              <Route path="movimentos" element={<StockMovimentosPage />} />
              <Route path="fechamento" element={<StockFechamentoPage />} />
            </Route>
            <Route path="requisicoes" element={<RequisicoesPage />} />
            <Route path="caixa" element={<CashPage />} />
            <Route path="cartoes" element={<CardsPage />} />
            <Route path="notas-fiscais" element={<FiscalNotesPage />} />
            <Route path="notas-fiscais/nfe/nova" element={<NfeFormPage />} />
            <Route path="notas-fiscais/nfe/:documentId/editar" element={<NfeFormPage />} />
            <Route path="notas-fiscais/parceiro" element={<PartyFiscalPage />} />
            <Route path="financeiro" element={<FinancePage />} />
            <Route path="balanco" element={<FinancialOverviewPage />} />
            <Route path="balanco/relatorios" element={<FinancialOverviewReportsPage />} />
            <Route path="balanco/plano-contas" element={<ReferentialChartPage />} />
            <Route path="empresa" element={<CompanyPage />} />
            <Route path="configuracoes/impressao" element={<PrintStationsPage />} />
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
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ResponsiveTablesBootstrap />
      <ManagerPasswordGate />
      <AppInner />
    </QueryClientProvider>
  );
}
