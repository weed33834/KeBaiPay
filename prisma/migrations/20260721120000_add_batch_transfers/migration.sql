-- 批量转账批次表
CREATE TABLE "batch_transfers" (
    "id" TEXT NOT NULL,
    "batch_no" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_transfers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "batch_transfers"
  ADD CONSTRAINT "batch_transfers_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "batch_transfers_batch_no_key" ON "batch_transfers"("batch_no");
CREATE UNIQUE INDEX "batch_transfers_idempotency_key_key" ON "batch_transfers"("idempotency_key");
CREATE INDEX "batch_transfers_sender_id_idx" ON "batch_transfers"("sender_id");
CREATE INDEX "batch_transfers_status_idx" ON "batch_transfers"("status");

-- 批量转账明细表
CREATE TABLE "batch_transfer_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transaction_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_transfer_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "batch_transfer_items"
  ADD CONSTRAINT "batch_transfer_items_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batch_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "batch_transfer_items_batch_id_idx" ON "batch_transfer_items"("batch_id");
CREATE INDEX "batch_transfer_items_to_user_id_idx" ON "batch_transfer_items"("to_user_id");
CREATE INDEX "batch_transfer_items_status_idx" ON "batch_transfer_items"("status");
