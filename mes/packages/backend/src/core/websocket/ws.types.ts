// ─── WebSocket Mesaj Tipleri ─────────────────────────────────────────────────

// Server → Client
export interface PlcDataMessage {
  type: 'plc:data';
  payload: {
    plcId: number;
    tags: {
      tagId: number;
      value: number | boolean | string | null;
      quality?: 'good' | 'uncertain' | 'bad';
      timestamp: string;
    }[];
  };
}

export interface PlcStatusMessage {
  type: 'plc:status';
  payload: {
    plcId: number;
    status: 'online' | 'offline' | 'cert_pending';
    message?: string;
  };
}

export interface WorkOrderChangedMessage {
  type: 'workorder:changed';
  payload: {
    workOrderId: number;
    status: string;
    changedBy: string;
  };
}

export interface SystemNotificationMessage {
  type: 'system:notification';
  payload: {
    notificationType: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
  };
}

export type ServerMessage =
  | PlcDataMessage
  | PlcStatusMessage
  | WorkOrderChangedMessage
  | SystemNotificationMessage;

// Client → Server
export interface SubscribePlcMessage {
  type: 'subscribe:plc';
  payload: { plcIds: number[] };
}

export interface UnsubscribePlcMessage {
  type: 'unsubscribe:plc';
  payload: { plcIds: number[] };
}

export interface SubscribeWorkOrderMessage {
  type: 'subscribe:workorder';
  payload: { workOrderId: number };
}

export type ClientMessage =
  | SubscribePlcMessage
  | UnsubscribePlcMessage
  | SubscribeWorkOrderMessage;