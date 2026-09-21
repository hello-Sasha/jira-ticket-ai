import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { BROWSER_FACTORY, BrowserPort, RenderPage } from './browser.port';
import { PdfRendererService } from './pdf-renderer.service';

class FakePage implements RenderPage {
  closed = false;
  constructor(private readonly behaviour: { fail?: Error } = {}) {}

  async setContent(): Promise<void> {
    if (this.behaviour.fail) {
      throw this.behaviour.fail;
    }
  }
  async pdf(): Promise<Buffer> {
    return Buffer.from('%PDF-fake');
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowser implements BrowserPort {
  pages: FakePage[] = [];
  closed = false;
  constructor(private readonly behaviour: { fail?: Error } = {}) {}

  async newPage(): Promise<RenderPage> {
    const page = new FakePage(this.behaviour);
    this.pages.push(page);
    return page;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('PdfRendererService', () => {
  let service: PdfRendererService;
  let browsers: FakeBrowser[];
  let factory: { launch: jest.Mock };
  let behaviour: { fail?: Error };

  const build = async (recycleAfter: number): Promise<PdfRendererService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfRendererService,
        { provide: BROWSER_FACTORY, useValue: factory },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'render.recycleAfter' ? recycleAfter : 30_000,
            ),
          },
        },
      ],
    }).compile();
    return module.get<PdfRendererService>(PdfRendererService);
  };

  beforeEach(async () => {
    behaviour = {};
    browsers = [];
    factory = {
      launch: jest.fn(async () => {
        const browser = new FakeBrowser(behaviour);
        browsers.push(browser);
        return browser;
      }),
    };
    service = await build(200);
  });

  it('produces a PDF buffer', async () => {
    const pdf = await service.render('<h1>hi</h1>');

    expect(pdf.toString()).toContain('%PDF');
  });

  it('launches the browser once and reuses it across documents', async () => {
    await service.render('<p>1</p>');
    await service.render('<p>2</p>');
    await service.render('<p>3</p>');

    expect(factory.launch).toHaveBeenCalledTimes(1);
    expect(browsers[0].pages).toHaveLength(3);
  });

  it('closes each page, so pages do not accumulate in a long-lived browser', async () => {
    await service.render('<p>1</p>');
    await service.render('<p>2</p>');

    expect(browsers[0].pages.every((p) => p.closed)).toBe(true);
  });

  it('recycles the browser once the render count is reached', async () => {
    service = await build(2);

    await service.render('<p>1</p>');
    await service.render('<p>2</p>');
    expect(browsers[0].closed).toBe(true);
    expect(factory.launch).toHaveBeenCalledTimes(1);

    await service.render('<p>3</p>');
    expect(factory.launch).toHaveBeenCalledTimes(2);
  });

  it('propagates a render failure rather than returning an empty PDF', async () => {
    behaviour.fail = new Error('navigation timeout');

    await expect(service.render('<p>bad</p>')).rejects.toThrow('navigation timeout');
  });

  it('discards the browser after a failure, since it may be wedged', async () => {
    behaviour.fail = new Error('crashed');
    await expect(service.render('<p>bad</p>')).rejects.toThrow();
    expect(browsers[0].closed).toBe(true);

    behaviour.fail = undefined;
    await service.render('<p>good</p>');

    expect(factory.launch).toHaveBeenCalledTimes(2);
    expect(browsers[1].pages).toHaveLength(1);
  });

  it('closes the browser on shutdown', async () => {
    await service.render('<p>1</p>');

    await service.onModuleDestroy();

    expect(browsers[0].closed).toBe(true);
  });

  it('survives a browser that throws on close', async () => {
    await service.render('<p>1</p>');
    browsers[0].close = jest.fn().mockRejectedValue(new Error('already gone'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
