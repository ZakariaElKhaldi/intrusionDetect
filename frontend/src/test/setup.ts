import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class WebSocketStub {
  static OPEN = 1;
  readyState = WebSocketStub.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(_url: string) {
    setTimeout(() => this.onopen?.(new Event("open")), 0);
  }
  close() {}
  send() {}
}

Object.defineProperty(globalThis, "WebSocket", { value: WebSocketStub, writable: true });
