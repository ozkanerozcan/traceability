import { useEffect, useMemo, useRef, useState } from 'react';
import { wsClient } from '../../../core/services/ws';
import type { LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';

interface PlcDataPayload {
  plcId: number;
  tags: {
    tagId: number;
    value: number | boolean | string | null;
    quality?: 'good' | 'uncertain' | 'bad';
    timestamp: string;
  }[];
}

/**
 * Birden çok PLC'ye abone olup tüm tag değerlerini tek Map'te toplar.
 * Dashboard widget'ları (farklı PLC'lerden tag'ler) bunu kullanır.
 */
export function useLiveValues(plcIds: number[]): Map<number, LiveTagValue> {
  const [values, setValues] = useState<Map<number, LiveTagValue>>(new Map());
  const handlerRef = useRef<(payload: PlcDataPayload) => void>();

  handlerRef.current = (payload: PlcDataPayload) => {
    setValues((prev) => {
      const next = new Map(prev);
      for (const tag of payload.tags) {
        next.set(tag.tagId, { value: tag.value, quality: tag.quality, timestamp: tag.timestamp });
      }
      return next;
    });
  };

  const key = useMemo(() => [...new Set(plcIds)].sort((a, b) => a - b).join(','), [plcIds]);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(',').map(Number);
    wsClient.send('subscribe:plc', { plcIds: ids });

    const off = wsClient.on('plc:data', (payload) => {
      handlerRef.current?.(payload as PlcDataPayload);
    });

    return () => {
      off();
      wsClient.send('unsubscribe:plc', { plcIds: ids });
    };
  }, [key]);

  return values;
}
