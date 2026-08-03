import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createScaleController,
  readScaleStationConfig,
  type ScaleMode,
  type ScaleReading,
  type UsePosScaleResult,
} from './pos-scale';

export function usePosScale(opts: {
  mode: ScaleMode;
  autoConfirmMs?: number;
  enabled?: boolean;
}): UsePosScaleResult {
  const station = readScaleStationConfig();
  const controller = useMemo(
    () =>
      createScaleController({
        mode: opts.mode,
        autoConfirmMs: opts.autoConfirmMs,
        agentUrl: station.agentUrl,
        baudRate: station.baudRate,
        enabled: opts.enabled,
      }),
    // Recria só quando o modo muda; config de estação é lida no create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.mode],
  );

  const [reading, setReading] = useState<ScaleReading>(() => controller.snapshot());

  useEffect(() => {
    return controller.subscribe(() => setReading(controller.snapshot()));
  }, [controller]);

  useEffect(() => {
    if (!opts.enabled) return;
    if (opts.mode !== 'AGENT') return;
    const id = window.setInterval(() => {
      void controller.pollAgent();
    }, 500);
    return () => window.clearInterval(id);
  }, [controller, opts.enabled, opts.mode]);

  useEffect(() => {
    return () => {
      void controller.disconnect();
    };
  }, [controller]);

  const connectSerial = useCallback(() => controller.connectSerial(), [controller]);
  const disconnect = useCallback(() => controller.disconnect(), [controller]);
  const request = useCallback(() => controller.request(), [controller]);
  const setManualWeight = useCallback(
    (kg: number | null) => controller.setManualWeight(kg),
    [controller],
  );

  return {
    ...reading,
    connectSerial,
    disconnect,
    request,
    setManualWeight,
  };
}
