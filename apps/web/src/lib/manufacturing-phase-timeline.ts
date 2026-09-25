import type { MfgStatus } from './manufacturing-labels';

export type PhaseSegment = {
  status: MfgStatus;
  startMs: number;
  endMs: number;
};

export type ScheduleHistoryRow = {
  toStatus: MfgStatus;
  createdAt: string;
};

export function buildPhaseSegments(
  history: ScheduleHistoryRow[],
  projectCreatedAt: string,
  currentStatus: MfgStatus,
  finishedAt: string | null,
  nowMs: number = Date.now(),
): PhaseSegment[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  if (!sorted.length) {
    const end =
      currentStatus === 'FINISHED' && finishedAt
        ? new Date(finishedAt).getTime()
        : nowMs;
    return [
      {
        status: currentStatus,
        startMs: new Date(projectCreatedAt).getTime(),
        endMs: end,
      },
    ];
  }

  const segments: PhaseSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    const startMs = new Date(row.createdAt).getTime();
    const next = sorted[i + 1];
    let endMs = next ? new Date(next.createdAt).getTime() : nowMs;
    if (!next) {
      if (currentStatus === 'FINISHED' && finishedAt) {
        endMs = new Date(finishedAt).getTime();
      } else if (currentStatus === 'CANCELLED') {
        endMs = startMs;
      }
    }
    if (endMs < startMs) endMs = startMs;
    segments.push({ status: row.toStatus, startMs, endMs });
  }
  return segments;
}

export function clampSegmentToRange(
  seg: PhaseSegment,
  rangeStartMs: number,
  rangeEndMs: number,
): PhaseSegment | null {
  const startMs = Math.max(seg.startMs, rangeStartMs);
  const endMs = Math.min(seg.endMs, rangeEndMs);
  if (endMs <= startMs) return null;
  return { ...seg, startMs, endMs };
}

const DAY_MS = 86_400_000;

/** Escala da barra: abertura do projeto até entrega (ou hoje), com folga nas bordas. */
export function projectTimelineRange(
  opts: {
    createdAt: string;
    promisedAt: string | null;
    finishedAt: string | null;
    segments: PhaseSegment[];
  },
  nowMs: number = Date.now(),
): { startMs: number; endMs: number } {
  let startMs = new Date(opts.createdAt).getTime();
  let endMs = nowMs;
  if (opts.promisedAt) {
    endMs = Math.max(
      endMs,
      new Date(`${opts.promisedAt.slice(0, 10)}T23:59:59.999`).getTime(),
    );
  }
  if (opts.finishedAt) {
    endMs = Math.max(endMs, new Date(opts.finishedAt).getTime());
  }
  for (const s of opts.segments) {
    startMs = Math.min(startMs, s.startMs);
    endMs = Math.max(endMs, s.endMs);
  }
  const span = Math.max(endMs - startMs, DAY_MS);
  const pad = Math.max(span * 0.04, DAY_MS * 0.5);
  return { startMs: startMs - pad, endMs: endMs + pad };
}

export function formatTimelineDay(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
