-- S5 多平台对账聚合
-- 1) ChannelStatement：渠道对账单（每渠道每日一条）
-- 2) ChannelStatementItem：渠道对账单条目（每条渠道流水一行）
-- 3) ReconciliationDifferenceItem：差异项独立表（差异处理工作流，含 status / assignedTo / resolution）

CREATE TABLE "channel_statements" (
    "id" TEXT NOT NULL,
    "channel_code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMP(3),
    "fetched_by" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_statements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_statements_channel_code_date_key" ON "channel_statements"("channel_code", "date");
CREATE INDEX "channel_statements_date_idx" ON "channel_statements"("date");
CREATE INDEX "channel_statements_status_idx" ON "channel_statements"("status");

CREATE TABLE "channel_statement_items" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "channel_order_no" TEXT NOT NULL,
    "channel_code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "matched_order_no" TEXT,
    "matched_type" TEXT,
    "match_status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "raw_payload" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_statement_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_statement_items_statement_id_fkey"
        FOREIGN KEY ("statement_id") REFERENCES "channel_statements"("id") ON DELETE CASCADE
);

CREATE INDEX "channel_statement_items_statement_id_idx" ON "channel_statement_items"("statement_id");
CREATE INDEX "channel_statement_items_channel_code_date_idx" ON "channel_statement_items"("channel_code", "date");
CREATE INDEX "channel_statement_items_channel_order_no_idx" ON "channel_statement_items"("channel_order_no");
CREATE INDEX "channel_statement_items_match_status_idx" ON "channel_statement_items"("match_status");

CREATE TABLE "reconciliation_difference_items" (
    "id" TEXT NOT NULL,
    "report_date" TEXT NOT NULL,
    "channel_code" TEXT,
    "channel_order_no" TEXT,
    "platform_order_no" TEXT,
    "diff_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assigned_to" TEXT,
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_difference_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reconciliation_difference_items_report_date_idx" ON "reconciliation_difference_items"("report_date");
CREATE INDEX "reconciliation_difference_items_channel_code_report_date_idx" ON "reconciliation_difference_items"("channel_code", "report_date");
CREATE INDEX "reconciliation_difference_items_status_idx" ON "reconciliation_difference_items"("status");
