-- 自定义风控规则表
CREATE TABLE "custom_risk_rules" (
    "id" TEXT NOT NULL,
    "rule_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "action" TEXT NOT NULL DEFAULT 'BLOCK',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL,
    "logical_op" TEXT NOT NULL DEFAULT 'AND',
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_risk_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_risk_rules_rule_no_key" ON "custom_risk_rules"("rule_no");
CREATE INDEX "custom_risk_rules_enabled_idx" ON "custom_risk_rules"("enabled");
CREATE INDEX "custom_risk_rules_priority_idx" ON "custom_risk_rules"("priority");
CREATE INDEX "custom_risk_rules_action_idx" ON "custom_risk_rules"("action");

-- 注意：列名 logical_op 需要与 Prisma map 保持一致
ALTER TABLE "custom_risk_rules"
  ADD CONSTRAINT "custom_risk_rules_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
