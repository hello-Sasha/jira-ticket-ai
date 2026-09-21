import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import { PermanentJobError } from '../worker/permanent-job.error';

/**
 * Fetches the source document from Mongo. The worker pulls its own payload;
 * the dispatcher only ever moves ids, which is what keeps dispatcher memory
 * flat regardless of batch size.
 */
@Injectable()
export class PayloadService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async fetch(mongoId: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(mongoId)) {
      throw new PermanentJobError(`Invalid Mongo id: ${mongoId}`);
    }

    const doc = await this.connection
      .collection('documents')
      .findOne({ _id: new Types.ObjectId(mongoId) });

    if (!doc) {
      // The document is gone. Retrying will not bring it back.
      throw new PermanentJobError(`Document ${mongoId} not found`);
    }

    return doc as Record<string, unknown>;
  }
}
