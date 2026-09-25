import { Outlet } from 'react-router-dom';
import { ManufacturingNav } from '../components/ManufacturingNav';
import { ManufacturingCreateDraftProvider } from '../context/manufacturing-create-draft';

export function ManufacturingShell() {
  return (
    <ManufacturingCreateDraftProvider>
      <ManufacturingNav />
      <Outlet />
    </ManufacturingCreateDraftProvider>
  );
}
