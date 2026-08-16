// 最小化 `ws` 模块声明：项目未安装 @types/ws（沙箱写权限受限），仅声明本服务实际用到的 API。
declare module 'ws' {
  import type { IncomingMessage } from 'http';
  import type { Server as HttpServer } from 'http';

  export interface WebSocketServerOptions {
    server?: HttpServer;
    port?: number;
    path?: string;
    noServer?: boolean;
  }

  export class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;
    readonly readyState: number;
    send(data: string | Buffer | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', listener: (data: Buffer | ArrayBuffer) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class WebSocketServer {
    constructor(options?: WebSocketServerOptions);
    readonly clients: Set<WebSocket>;
    on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    close(cb?: (err?: Error) => void): void;
  }
}
