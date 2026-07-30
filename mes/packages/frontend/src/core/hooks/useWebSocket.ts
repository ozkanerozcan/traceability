import { useEffect } from 'react';
import { wsClient } from '../services/ws';
import { useAppStore } from '../store/appStore';

/**
 * WebSocket bağlantı durumunu izler ve appStore'a yansıtır.
 * Mesaj dinlemek için useWsMessage kullanılır.
 */
export function useWebSocket() {
  const wsConnected = useAppStore((s) => s.wsConnected);
  const setWsConnected = useAppStore((s) => s.setWsConnected);

  useEffect(() => {
    // Mount'ta mevcut durumla senkronla — listener bağlanmadan ÖNCE WS
    // açılmış olabilir (restore akışı hızlıysa), aksi halde rozet yanlış kalır.
    setWsConnected(wsClient.isConnected);

    const off = wsClient.on('__connected', (payload) => {
      setWsConnected(payload === true);
    });
    return off;
  }, [setWsConnected]);

  return wsConnected;
}

/**
 * Belirli bir WS mesaj tipini dinler.
 * Kullanım: useWsMessage<{ plcId: number }>('plc:data', (p) => ...)
 */
export function useWsMessage<TPayload = unknown>(
  type: string,
  handler: (payload: TPayload) => void
): void {
  useEffect(() => {
    const off = wsClient.on(type, (payload) => handler(payload as TPayload));
    return off;
  }, [type, handler]);
}