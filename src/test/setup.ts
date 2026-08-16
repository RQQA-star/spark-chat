// 前端测试的全局环境准备：
// 1) 引入 @testing-library/jest-dom 的 matcher 扩展（toBeInTheDocument 等）
// 2) jsdom 不实现 WebSocket，提供最小桩以免真实连接与本不该发生的网络报错
// 3) 兜底保证 globalThis.crypto.randomUUID 存在（Node 22 自带，仅为防旧环境）
// 4) jsdom 未实现布局相关方法（scrollIntoView/scrollTo），补桩以免组件 effect 抛错

import '@testing-library/jest-dom/vitest';

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  // 便于测试直接拿到最近一次实例以派发事件
  static lastInstance: MockWebSocket | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
    // 模拟异步 open
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(_data: string): void {
    /* 桩：不真正发送 */
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
  MockWebSocket as unknown as typeof WebSocket;

// Node 22 自带全局 crypto.randomUUID；此处仅作兜底
if (typeof globalThis.crypto === 'undefined' || typeof (globalThis.crypto as Crypto).randomUUID !== 'function') {
  const g = globalThis as unknown as { crypto: Crypto & { randomUUID: () => string } };
  if (!g.crypto) {
    // @ts-expect-error 最小兜底
    g.crypto = {};
  }
  g.crypto.randomUUID = (() =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })) as unknown as Crypto['randomUUID'];
}

// jsdom 不实现布局/滚动相关方法，组件 effect 调用会抛错，这里补最小桩。
// 仅在 jsdom 环境（存在 Element）下执行，避免影响 node 环境（server 测试共用本 setup）。
if (typeof Element !== 'undefined') {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo() {};
  }
}
