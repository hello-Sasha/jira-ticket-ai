export interface AppConfig {
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  mongo: {
    uri: string;
  };
  aws: {
    region: string;
  };
  queues: {
    batchUrl: string;
    urgentUrl: string;
  };
  s3: {
    defaultBucket: string;
  };
  dispatcher: {
    /** Rows claimed per database round trip. Bounds dispatcher memory. */
    claimChunkSize: number;
    /** Minutes a claim is valid before the reaper may reclaim it. */
    leaseMinutes: number;
    /** Attempts after which a job is failed permanently rather than retried. */
    maxAttempts: number;
  };
  render: {
    /** Documents rendered before the browser is recycled. Chromium leaks. */
    recycleAfter: number;
    timeoutMs: number;
  };
}

export default (): AppConfig => ({
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    name: process.env.DB_NAME ?? 'pdf_converter',
  },
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/documents',
  },
  aws: {
    region: process.env.AWS_REGION ?? 'us-west-2',
  },
  queues: {
    batchUrl: process.env.RENDER_QUEUE_URL ?? '',
    urgentUrl: process.env.RENDER_QUEUE_URGENT_URL ?? process.env.RENDER_QUEUE_URL ?? '',
  },
  s3: {
    defaultBucket: process.env.DEFAULT_BUCKET ?? '',
  },
  dispatcher: {
    claimChunkSize: parseInt(process.env.CLAIM_CHUNK_SIZE ?? '1000', 10),
    leaseMinutes: parseInt(process.env.LEASE_MINUTES ?? '15', 10),
    maxAttempts: parseInt(process.env.MAX_ATTEMPTS ?? '3', 10),
  },
  render: {
    recycleAfter: parseInt(process.env.BROWSER_RECYCLE_AFTER ?? '200', 10),
    timeoutMs: parseInt(process.env.RENDER_TIMEOUT_MS ?? '30000', 10),
  },
});
