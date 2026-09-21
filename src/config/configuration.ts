export interface AppConfig {
  port: number;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  sqs: {
    region: string;
    orderEventsQueueUrl: string;
  };
  s3: {
    region: string;
    documentsBucket: string;
  };
  mongo: {
    uri: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    name: process.env.DB_NAME ?? 'orders',
  },
  sqs: {
    region: process.env.AWS_REGION ?? 'us-west-2',
    orderEventsQueueUrl: process.env.ORDER_EVENTS_QUEUE_URL ?? '',
  },
  s3: {
    region: process.env.AWS_REGION ?? 'us-west-2',
    documentsBucket: process.env.DOCUMENTS_BUCKET ?? '',
  },
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/orders_audit',
  },
});
