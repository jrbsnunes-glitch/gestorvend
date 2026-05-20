import type { ReactNode } from 'react';
import { StandardReportHeader } from './StandardReportHeader';

/**
 * Bloco aparece apenas na impressão (Ctrl+P) no topo das telas com listagens.
 */
export function ReportPrintSticker({
  documentTitle,
  documentExtras,
}: {
  documentTitle: string;
  documentExtras?: ReactNode;
}) {
  return (
    <div className="gv-report-print-only" aria-hidden>
      <div className="gv-report-sheet gv-report-sheet--embedded">
        <StandardReportHeader documentTitle={documentTitle} documentExtras={documentExtras} />
      </div>
    </div>
  );
}
