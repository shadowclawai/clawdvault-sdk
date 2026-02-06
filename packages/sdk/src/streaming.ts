/**
 * ClawdVault Streaming Client
 * Real-time data feeds via Server-Sent Events
 */

// Polyfill EventSource for Node.js
const getEventSource = (): typeof EventSource => {
  if (typeof EventSource !== 'undefined') {
    return EventSource;
  }
  // Node.js environment - use polyfill
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('eventsource');
};

export interface StreamTrade {
  id: string;
  type: 'buy' | 'sell';
  sol_amount: number;
  token_amount: number;
  price_sol: number;
  trader: string;
  signature?: string;
  created_at: string;
}

export interface StreamTokenUpdate {
  price_sol: number;
  market_cap_sol: number;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  graduated: boolean;
  timestamp: number;
}

export interface StreamTokenConnected extends StreamTokenUpdate {
  mint: string;
  name: string;
  symbol: string;
}

export interface StreamChatMessage {
  id: string;
  wallet: string;
  username?: string;
  message: string;
  reply_to?: string;
  created_at: string;
}

export interface StreamReaction {
  message_id: string;
  emoji: string;
  wallet: string;
}

export interface StreamingOptions {
  /** Auto-reconnect on connection loss (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
}

type EventCallback<T> = (data: T) => void;
type ErrorCallback = (error: Error) => void;
type ConnectionCallback = () => void;

export class StreamConnection {
  private eventSource: EventSource | null = null;
  private url: string;
  private options: Required<StreamingOptions>;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();
  private onConnectCallbacks: Set<ConnectionCallback> = new Set();
  private onDisconnectCallbacks: Set<ConnectionCallback> = new Set();
  private onErrorCallbacks: Set<ErrorCallback> = new Set();
  private isConnected = false;
  private isManuallyDisconnected = false;

  constructor(url: string, options: StreamingOptions = {}) {
    this.url = url;
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 3000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    };
  }

  /**
   * Connect to the stream
   */
  connect(): void {
    if (this.eventSource) {
      return; // Already connected
    }

    this.isManuallyDisconnected = false;
    const EventSourceImpl = getEventSource();
    this.eventSource = new EventSourceImpl(this.url);

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.onConnectCallbacks.forEach(cb => cb());
    };

    this.eventSource.onerror = (event) => {
      const wasConnected = this.isConnected;
      this.isConnected = false;

      if (wasConnected) {
        this.onDisconnectCallbacks.forEach(cb => cb());
      }

      this.onErrorCallbacks.forEach(cb => cb(new Error('Stream connection error')));

      // Attempt reconnect
      if (this.options.autoReconnect && !this.isManuallyDisconnected) {
        this.scheduleReconnect();
      }
    };

    // Generic event handler
    this.eventSource.onmessage = (event) => {
      this.handleEvent('message', event.data);
    };

    // Register specific event listeners
    for (const eventType of this.listeners.keys()) {
      this.eventSource.addEventListener(eventType, (event) => {
        this.handleEvent(eventType, (event as MessageEvent).data);
      });
    }
  }

  private handleEvent(eventType: string, data: string): void {
    const callbacks = this.listeners.get(eventType);
    if (!callbacks) return;

    try {
      const parsed = JSON.parse(data);
      callbacks.forEach(cb => cb(parsed));
    } catch {
      // Ignore parse errors
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.onErrorCallbacks.forEach(cb => 
        cb(new Error(`Max reconnect attempts (${this.options.maxReconnectAttempts}) reached`))
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    this.reconnectTimeout = setTimeout(() => {
      this.eventSource?.close();
      this.eventSource = null;
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from the stream
   */
  disconnect(): void {
    this.isManuallyDisconnected = true;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.isConnected) {
      this.isConnected = false;
      this.onDisconnectCallbacks.forEach(cb => cb());
    }
  }

  /**
   * Subscribe to an event type
   */
  on<T>(eventType: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
      
      // If already connected, add listener to EventSource
      if (this.eventSource) {
        this.eventSource.addEventListener(eventType, (event) => {
          this.handleEvent(eventType, (event as MessageEvent).data);
        });
      }
    }

    this.listeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  /**
   * One-time event listener
   */
  once<T>(eventType: string, callback: EventCallback<T>): void {
    const unsubscribe = this.on<T>(eventType, (data) => {
      unsubscribe();
      callback(data);
    });
  }

  /**
   * Register connection callback
   */
  onConnect(callback: ConnectionCallback): () => void {
    this.onConnectCallbacks.add(callback);
    return () => this.onConnectCallbacks.delete(callback);
  }

  /**
   * Register disconnection callback
   */
  onDisconnect(callback: ConnectionCallback): () => void {
    this.onDisconnectCallbacks.add(callback);
    return () => this.onDisconnectCallbacks.delete(callback);
  }

  /**
   * Register error callback
   */
  onError(callback: ErrorCallback): () => void {
    this.onErrorCallbacks.add(callback);
    return () => this.onErrorCallbacks.delete(callback);
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Streaming client for ClawdVault
 */
export class ClawdVaultStreaming {
  private baseUrl: string;
  private connections: Map<string, StreamConnection> = new Map();
  private options: StreamingOptions;

  constructor(baseUrl: string = 'https://clawdvault.com/api', options: StreamingOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.options = options;
  }

  /**
   * Stream trades for a token
   */
  streamTrades(mint: string): StreamConnection {
    const key = `trades:${mint}`;
    
    if (!this.connections.has(key)) {
      const conn = new StreamConnection(
        `${this.baseUrl}/stream/trades?mint=${mint}`,
        this.options
      );
      this.connections.set(key, conn);
    }
    
    return this.connections.get(key)!;
  }

  /**
   * Stream token updates (price, market cap)
   */
  streamToken(mint: string): StreamConnection {
    const key = `token:${mint}`;
    
    if (!this.connections.has(key)) {
      const conn = new StreamConnection(
        `${this.baseUrl}/stream/token?mint=${mint}`,
        this.options
      );
      this.connections.set(key, conn);
    }
    
    return this.connections.get(key)!;
  }

  /**
   * Stream chat messages
   */
  streamChat(mint: string): StreamConnection {
    const key = `chat:${mint}`;
    
    if (!this.connections.has(key)) {
      const conn = new StreamConnection(
        `${this.baseUrl}/stream/chat?mint=${mint}`,
        this.options
      );
      this.connections.set(key, conn);
    }
    
    return this.connections.get(key)!;
  }

  /**
   * Convenience: Subscribe to trades with callback
   */
  onTrades(mint: string, callback: EventCallback<StreamTrade>): { unsubscribe: () => void; connection: StreamConnection } {
    const conn = this.streamTrades(mint);
    const unsubscribe = conn.on<StreamTrade>('trade', callback);
    conn.connect();
    return { unsubscribe, connection: conn };
  }

  /**
   * Convenience: Subscribe to token price updates
   */
  onPrice(mint: string, callback: EventCallback<StreamTokenUpdate>): { unsubscribe: () => void; connection: StreamConnection } {
    const conn = this.streamToken(mint);
    const unsubscribe = conn.on<StreamTokenUpdate>('update', callback);
    conn.connect();
    return { unsubscribe, connection: conn };
  }

  /**
   * Convenience: Subscribe to chat messages
   */
  onChat(mint: string, callback: EventCallback<StreamChatMessage>): { unsubscribe: () => void; connection: StreamConnection } {
    const conn = this.streamChat(mint);
    const unsubscribe = conn.on<StreamChatMessage>('message', callback);
    conn.connect();
    return { unsubscribe, connection: conn };
  }

  /**
   * Disconnect all streams
   */
  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
  }

  /**
   * Disconnect a specific stream
   */
  disconnect(type: 'trades' | 'token' | 'chat', mint: string): void {
    const key = `${type}:${mint}`;
    const conn = this.connections.get(key);
    if (conn) {
      conn.disconnect();
      this.connections.delete(key);
    }
  }
}

/**
 * Create streaming client
 */
export function createStreaming(baseUrl?: string, options?: StreamingOptions): ClawdVaultStreaming {
  return new ClawdVaultStreaming(baseUrl, options);
}
