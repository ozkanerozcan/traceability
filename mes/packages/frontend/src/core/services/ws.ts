/**
 * WebSocket client: otomatik yeniden bağlanma (exponential backoff),
 * mesaj tipine göre abone (listener) yönetimi.
 */

export interface WsMessage {
  type: string;
  payload: unknown;
}

type MessageListener = (payload: unknown) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

class WsClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners = new Map<string, Set<MessageListener>>();
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private pendingSubscriptions: { type: string; payload: unknown }[] = [];

  connect(token: string): void {
    this.token = token;
    this.shouldReconnect = true;
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(this.token)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.emit('__connected', true);
      // Bağlantı kopmadan önceki abonelikleri geri yükle
      for (const sub of this.pendingSubscriptions) {
        this.send(sub.type, sub.payload);
      }
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        this.emit(msg.type, msg.payload);
      } catch {
        // Bozuk mesajları yoksay
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.warn(`[ws] Bağlantı kapandı (code=${event.code}, reason=${event.reason || '—'})`);
      this.ws = null;
      this.emit('__connected', false);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      console.warn('[ws] Hata oluştu:', event);
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.open();
    }, this.reconnectDelay);
  }

  send(type: string, payload: unknown): void {
    // Abonelik mesajlarını sakla — reconnect sonrası tekrar gönderilir
    if (type.startsWith('subscribe:')) {
      if (!this.pendingSubscriptions.some((s) => s.type === type && JSON.stringify(s.payload) === JSON.stringify(payload))) {
        this.pendingSubscriptions.push({ type, payload });
      }
    } else if (type.startsWith('unsubscribe:')) {
      // İlgili subscribe kaydını temizle
      const subType = type.replace('unsubscribe:', 'subscribe:');
      this.pendingSubscriptions = this.pendingSubscriptions.filter(
        (s) => !(s.type === subType && JSON.stringify(s.payload) === JSON.stringify(payload))
      );
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  on(type: string, listener: MessageListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  off(type: string, listener: MessageListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, payload: unknown): void {
    this.listeners.get(type)?.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[ws] Listener hatası (${type}):`, err);
      }
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pendingSubscriptions = [];
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WsClient();