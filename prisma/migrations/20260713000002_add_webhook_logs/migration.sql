-- 支付渠道回调日志表：所有 webhook 入站记录均落库，用于审计追溯与故障排查
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "channel_code" TEXT NOT NULL,
    "callback_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "raw_body" TEXT NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- 索引：按渠道 + 回调类型 + 状态 + 创建时间查询
CREATE INDEX "webhook_logs_channel_code_idx" ON "webhook_logs"("channel_code");
CREATE INDEX "webhook_logs_callback_type_idx" ON "webhook_logs"("callback_type");
CREATE INDEX "webhook_logs_status_idx" ON "webhook_logs"("status");
CREATE INDEX "webhook_logs_created_at_idx" ON "webhook_logs"("created_at");
