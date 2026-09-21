/**
 * Where one org's documents go. Loaded from your own config store; the
 * worker never derives this from the message.
 */
export interface OrgDestination {
  orgId: string;
  /** Absent means: use the default bucket. */
  customBucket?: {
    bucket: string;
    /** Role in the customer's account that trusts your worker role. */
    roleArn: string;
    externalId: string;
    region: string;
  };
}

export interface StoreResult {
  bucket: string;
  key: string;
  /** True when the customer's bucket was unreachable and we fell back. */
  degraded: boolean;
}
