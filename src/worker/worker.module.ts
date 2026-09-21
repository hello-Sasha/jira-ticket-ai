import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { PayloadModule } from '../payload/payload.module';
import { RenderModule } from '../render/render.module';
import { StorageModule } from '../storage/storage.module';
import { TemplatesModule } from '../templates/templates.module';
import { OrgConfigService } from './org-config.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [JobsModule, PayloadModule, TemplatesModule, RenderModule, StorageModule],
  providers: [OrgConfigService, WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
