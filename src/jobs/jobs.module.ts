import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversionJob } from './entities/conversion-job.entity';
import { JobsService } from './jobs.service';

@Module({
  imports: [TypeOrmModule.forFeature([ConversionJob])],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
