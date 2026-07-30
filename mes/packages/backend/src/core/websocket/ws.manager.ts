import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from './ws.types.js';

interface ClientState {
  socket: WebSocket;
  userId: number;
  username: string;
  plcSubscriptions: Set<number>;
  workOrderSubscriptions: Set<number>;
}

/**
 * WebSocket Manager: bağlantı, oda (subscription) ve broadcast yönetimi.
 * Kimlik doğrulama: ws://host:3000/ws?token=JWT — geçersiz token 4001 ile kapatılır.
 */
export class WsManager {
  private clients = new Set<ClientState>();

  /**
   * Bir client PLC'ye abone olduğunda çağrılır.
   * WorkerManager bu hook'a kaydolup önbellekteki son değerleri (lastValues)
   * yeni aboneye anında replay eder — böylece statik/subscribe tag'ler
   * sayfa açıldığında "—" yerine son bilinen değeri gösterir.
   */
  public onPlcSubscribed?: (plcId: number, send: (message: ServerMessage) => void) => void;

  register(app: FastifyInstance): void {
    app.get('/ws', { websocket: true }, (socket, request) => {
      const token = (request.query as { token?: string }).token;

      let userId = 0;
      let username = '';
      try {
        if (!token) throw new Error('missing token');
        const decoded = app.jwt.verify<{ sub: number; username: string }>(token);
        userId = decoded.sub;
        username = decoded.username;
      } catch {
        socket.close(4001, 'Unauthorized');
        return;
      }

      const client: ClientState = {
        socket,
        userId,
        username,
        plcSubscriptions: new Set(),
        workOrderSubscriptions: new Set(),
      };
      this.clients.add(client);
      app.log.info(`[ws] Bağlantı: ${username} (toplam: ${this.clients.size})`);

      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          this.handleClientMessage(client, msg);
        } catch {
          // Hatalı formatlı mesajları yoksay
        }
      });

      socket.on('close', () => {
        this.clients.delete(client);
        app.log.info(`[ws] Ayrıldı: ${username} (toplam: ${this.clients.size})`);
      });
    });
  }

  private handleClientMessage(client: ClientState, msg: ClientMessage): void {
    switch (msg.type) {
      case 'subscribe:plc':
        for (const id of msg.payload.plcIds) {
          client.plcSubscriptions.add(id);
          this.onPlcSubscribed?.(id, (message) => {
            if (client.socket.readyState === client.socket.OPEN) {
              client.socket.send(JSON.stringify(message));
            }
          });
        }
        break;
      case 'unsubscribe:plc':
        for (const id of msg.payload.plcIds) client.plcSubscriptions.delete(id);
        break;
      case 'subscribe:workorder':
        client.workOrderSubscriptions.add(msg.payload.workOrderId);
        break;
    }
  }

  /** Tüm bağlı client'lara mesaj gönderir. */
  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(data);
      }
    }
  }

  /** Yalnızca belirli PLC'ye abone olmuş client'lara gönderir. */
  broadcastToPlcSubscribers(plcId: number, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (
        client.plcSubscriptions.has(plcId) &&
        client.socket.readyState === client.socket.OPEN
      ) {
        client.socket.send(data);
      }
    }
  }

  /** Yalnızca belirli iş emrine abone olmuş client'lara gönderir. */
  broadcastToWorkOrderSubscribers(workOrderId: number, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (
        client.workOrderSubscriptions.has(workOrderId) &&
        client.socket.readyState === client.socket.OPEN
      ) {
        client.socket.send(data);
      }
    }
  }

  closeAll(): void {
    for (const client of this.clients) {
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const wsManager = new WsManager();