
import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddSourceToWebhookEvents1706800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("webhook_events", new TableColumn({
      name: "source",
      type: "varchar",
      length: "50",
      isNullable: false,
      default: "'system'" // Temporary default to avoid null issue during deployment
    }));

    await queryRunner.changeColumn("webhook_events", "source", new TableColumn({
      name: "source",
      type: "varchar",
      length: "50",
      isNullable: false
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("webhook_events", "source");
  }
}
