import { useEffect, useRef, useState } from 'react';
import { wsClient } from '../../../core/services/ws';
import type { PlcWorkerStatus } from '../services/plc.service';

export interface LiveTagValue {
  value: number | boolean | string | null;
  quality?: 'good' | 'uncertain' | 'bad';
  timestamp: string;
}

interface PlcDataPayload {
  plcId: number;
  tags: {
    tagId: number;
    value: number | boolean | string | null;
    quality?: 'good' | 'uncertain' | 'bad';
    timestamp: string;
  }[];
}

interface PlcStatusPayload {
  plcId: number;
  status: PlcWorkerStatus;
  message?: string;
}

/**
 * PLC canlı veri aboneliği: bileşen mount olduğunda subscribe:plc gönderir,
 * unmount'ta aboneliği kaldırır. Gelen plc:data mesajları tagId → değer
 * haritasında toplanır.
 */
export function usePlcLiveData(plcId: number | null) {
  const [values, setValues] = useState<Map<number, LiveTagValue>>(new Map());
  const handlerRef = useRef<(payload: PlcDataPayload) => void>();

  handlerRef.current = (payload: PlcDataPayload) => {
    if (plcId === null || payload.plcId !== plcId) return;
    setValues((prev) => {
      const next = new Map(prev);
      for (const tag of payload.tags) {
        next.set(tag.tagId, { value: tag.value, quality: tag.quality, timestamp: tag.timestamp });
      }
      return next;
    });
  };

  useEffect(() => {
    if (plcId === null) return;

    wsClient.send('subscribe:plc', { plcIds: [plcId] });

    const off = wsClient.on('plc:data', (payload) => {
      handlerRef.current?.(payload as PlcDataPayload);
    });

    return () => {
      off();
      wsClient.send('unsubscribe:plc', { plcIds: [plcId] });
    };
  }, [plcId]);

  return values;
}

/**
 * Tüm PLC'lerin bağlantı durumu değişikliklerini dinler.
 * handler her plc:status mesajında çağrılır.
 */
export function usePlcStatusUpdates(
  handler: (plcId: number, status: PlcWorkerStatus, message?: string) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const off = wsClient.on('plc:status', (payload) => {
      const p = payload as PlcStatusPayload;
      handlerRef.current(p.plcId, p.status, p.message);
    });
    return off;
  }, []);
}

/** Tek bir tag'in canlı değerini kolayca okumak için yardımcı. */
export function useTagLiveValue(
  values: Map<number, LiveTagValue>,
  tagId: number
): LiveTagValue | undefined {
  return values.get(tagId);
}

export function usePlcSubscription(plcIds: number[]): void {
  const key = plcIds.join(',');
  useEffect(() => {
    if (key.length === 0) return;
    const ids = key.split(',').map(Number);
    wsClient.send('subscribe:plc', { plcIds: ids });
    return () => {
      wsClient.send('unsubscribe:plc', { plcIds: ids });
    };
  }, [key]);
}

export const formatLiveValue = (
  value: number | boolean | string | null | undefined,
  unit?: string | null
): string => {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'string') return unit ? `${value} ${unit}` : value;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
};
