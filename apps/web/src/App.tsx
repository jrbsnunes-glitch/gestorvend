import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { GV_UNAUTHORIZED_EVENT, getToken, setToken } from './lib/api';
import { CashPage } from './pages/CashPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { Login } from './pages/Login';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { StockEntradaPage } from './pages/stock/StockEntradaPage';
import { StockFechamentoPage } from './pages/stock/StockFechamentoPage';
import { StockLocaisPage } from './pages/stock/StockLocaisPage';
import { StockMovimentosPage } from './pages/stock/StockMovimentosPage';
import { StockPainelPage } from './pages/stock/StockPainelPage';
import { StockSaidasPage } from './pages/stock/StockSaidasPage';
import { StockShell } from './pages/stock/StockShell';
import { SuppliersPage } from './pages/SuppliersPage';
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
    function onSessionExpired() {
      setTok(null);
      qc.clear();
    }
    window.addEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
    return () => window.removeEventListener(GV_UNAUTHORIZED_EVENT, onSessionExpired);
  }, []);

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
        <Route
          element={
            <AppLayout
              onLogout={() => {
                setToken(null);
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
          <Route path="vendas" element={<SalesPage />} />
          <Route path="caixa" element={<CashPage />} />
          <Route path="financeiro" element={<FinancePage />} />
          <Route path="relatorios" element={<ReportsPage />} />
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
