import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright-core';

import { BrowserFactory, BrowserPort, RenderPage } from './browser.port';

/**
 * The real implementation. Kept deliberately thin: everything interesting
 * (reuse, recycling, timeouts) lives in PdfRenderer, where it can be tested
 * without launching a browser.
 */
@Injectable()
export class ChromiumFactory implements BrowserFactory {
  async launch(): Promise<BrowserPort> {
    const browser = await chromium.launch({
      args: [
        // Required in most container runtimes; safe only because we control
        // the container and the HTML comes from reviewed templates.
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    return {
      async newPage(): Promise<RenderPage> {
        const context = await browser.newContext();
        const page = await context.newPage();

        return {
          async setContent(html: string, timeoutMs: number): Promise<void> {
            // networkidle, not a fixed sleep: waiting a fixed time is how
            // subtly-wrong PDFs get produced, and a wrong PDF is worse than
            // a failed one.
            await page.setContent(html, { waitUntil: 'networkidle', timeout: timeoutMs });
            await page.evaluate(() => document.fonts.ready);
          },
          async pdf(): Promise<Buffer> {
            return page.pdf({
              format: 'A4',
              printBackground: true,
              margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
            });
          },
          async close(): Promise<void> {
            await context.close();
          },
        };
      },
      async close(): Promise<void> {
        await browser.close();
      },
    };
  }
}
