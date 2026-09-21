/**
 * The renderer depends on this, not on Playwright directly.
 *
 * Two reasons. Tests run without a real Chromium, which keeps the suite fast
 * and runnable in CI. And the Lambda-vs-ECS decision stays open, since the
 * container-image and long-running launch strategies differ only in the
 * implementation of this port.
 */
export interface RenderPage {
  setContent(html: string, timeoutMs: number): Promise<void>;
  pdf(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface BrowserPort {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}

/** Injection token - an interface cannot be one. */
export const BROWSER_FACTORY = Symbol('BROWSER_FACTORY');

export interface BrowserFactory {
  launch(): Promise<BrowserPort>;
}
