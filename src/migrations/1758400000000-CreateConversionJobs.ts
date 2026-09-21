import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversionJobs1758400000000 implements MigrationInterface {
  name = 'CreateConversionJobs1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`conversion_jobs\` (
        \`id\`               BIGINT       NOT NULL AUTO_INCREMENT,
        \`batchId\`          CHAR(36)     NOT NULL,
        \`orgId\`            VARCHAR(64)  NOT NULL,
        \`mongoId\`          CHAR(24)     NOT NULL,
        \`templateId\`       VARCHAR(64)  NOT NULL,
        \`templateVersion\`  INT          NOT NULL,
        \`status\`           ENUM('ready','claimed','rendering','done','failed')
                             NOT NULL DEFAULT 'ready',
        \`priority\`         ENUM('batch','urgent') NOT NULL DEFAULT 'batch',
        \`attempts\`         TINYINT      NOT NULL DEFAULT 0,
        \`workerId\`         VARCHAR(64)  NULL,
        \`leaseExpiresAt\`   DATETIME     NULL,
        \`pickedUpAt\`       DATETIME     NULL,
        \`finishedAt\`       DATETIME     NULL,
        \`savedAt\`          DATETIME     NULL,
        \`lastError\`        TEXT         NULL,
        \`createdAt\`        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_claim\` (\`status\`, \`priority\`, \`id\`),
        INDEX \`idx_batch\` (\`batchId\`, \`status\`),
        INDEX \`idx_reap\`  (\`status\`, \`leaseExpiresAt\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `conversion_jobs`');
  }
}
