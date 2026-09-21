import { Injectable } from '@nestjs/common';

import { OrgDestination } from '../storage/org-destination';

/**
 * Where an org's documents go. A stub here: back it with your own config
 * table or parameter store. Cached per process because it is read once per
 * document and changes rarely.
 */
@Injectable()
export class OrgConfigService {
  private readonly cache = new Map<string, OrgDestination>();

  async destinationFor(orgId: string): Promise<OrgDestination> {
    const cached = this.cache.get(orgId);
    if (cached) {
      return cached;
    }

    // Replace with a real lookup. Defaulting to your own bucket is the safe
    // failure mode: a config read that comes back empty must not silently
    // stop documents being written.
    const destination: OrgDestination = { orgId };
    this.cache.set(orgId, destination);
    return destination;
  }

  clear(): void {
    this.cache.clear();
  }
}
