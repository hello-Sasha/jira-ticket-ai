import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BROWSER_FACTORY, BrowserFactory, BrowserPort } from './browser.port';

@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: BrowserPort | null = null;
  private rendersSinceLaunch = 0;

  constructor(
    @Inject(BROWSER_FACTORY) private readonly factory: BrowserFactory,
    private readonly config: ConfigService,
  ) {}

  private get recycleAfter(): number {
    return this.config.get<number>('render.recycleAfter') ?? 200;
  }

  private get timeoutMs(): number {
    return this.config.get<number>('render.timeoutMs') ?? 30_000;
  }

  /**
   * Render one document.
   *
   * The browser is launched once and reused. Launching costs 1-3 seconds and
   * rendering in a warm browser costs 200-500ms, so reuse is the single
   * biggest lever on cost here - relaunching per document makes every
   * document several times more expensive.
   */
  async render(html: string): Promise<Buffer> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, this.timeoutMs);
      const pdf = await page.pdf();
      this.rendersSinceLaunch += 1;
      return pdf;
    } catch (error) {
      // A failed render can leave the browser in a bad state. Drop it rather
      // than serving the next document from a browser that may be wedged.
      await this.discardBrowser();
      throw error;
    } finally {
      await page.close().catch(() => undefined);
      await this.recycleIfDue();
    }
  }

  private async ensureBrowser(): Promise<BrowserPort> {
    if (!this.browser) {
      this.browser = await this.factory.launch();
      this.rendersSinceLaunch = 0;
    }
    return this.browser;
  }

  /**
   * Chromium leaks memory over long runs. Recycling on a counter turns an
   * eventual OOM mid-batch into a planned 2-second restart.
   */
  private async recycleIfDue(): Promise<void> {
    if (this.browser && this.rendersSinceLaunch >= this.recycleAfter) {
      this.logger.log(`Recycling browser after ${this.rendersSinceLaunch} renders`);
      await this.discardBrowser();
    }
  }

  private async discardBrowser(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.rendersSinceLaunch = 0;
    if (browser) {
      await browser.close().catch((error) => {
        this.logger.warn(`Browser close failed: ${(error as Error).message}`);
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.discardBrowser();
  }
}
