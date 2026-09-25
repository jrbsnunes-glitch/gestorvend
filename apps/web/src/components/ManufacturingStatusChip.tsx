import {
  MFG_STATUS_LABEL,
  mfgStatusChipStyle,
  type MfgStatus,
} from '../lib/manufacturing-labels';

export function ManufacturingStatusChip({ status }: { status: MfgStatus }) {
  const st = mfgStatusChipStyle(status);
  return (
    <span
      className="mfg-status-chip"
      style={{
        background: st.background,
        color: st.color,
      }}
    >
      {MFG_STATUS_LABEL[status]}
    </span>
  );
}
