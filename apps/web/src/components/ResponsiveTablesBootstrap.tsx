import { useEffect } from 'react';
import { startDataTableCardLabelsObserver } from '../lib/responsive-tables';

/** Ativa cards responsivos em todas as `.data-table` do app (mobile). */
export function ResponsiveTablesBootstrap() {
  useEffect(() => startDataTableCardLabelsObserver(), []);
  return null;
}
