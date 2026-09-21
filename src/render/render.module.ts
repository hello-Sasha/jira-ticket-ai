import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BROWSER_FACTORY } from './browser.port';
import { ChromiumFactory } from './chromium.factory';
import { PdfRendererService } from './pdf-renderer.service';

@Module({
  imports: [ConfigModule],
  providers: [{ provide: BROWSER_FACTORY, useClass: ChromiumFactory }, PdfRendererService],
  exports: [PdfRendererService],
})
export class RenderModule {}
