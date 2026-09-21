import { Module } from '@nestjs/common';

import { PayloadService } from './payload.service';

@Module({
  providers: [PayloadService],
  exports: [PayloadService],
})
export class PayloadModule {}
