-- 担保交易 Escrow 订单表
CREATE TABLE "escrow_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "paid_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "refund_reason" TEXT,
    "dispute_reason" TEXT,
    "dispute_resolved_by" TEXT,
    "dispute_resolved_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrow_orders_pkey" PRIMARY KEY ("id")
);

-- 外键：buyer / seller 都关联 users.id
ALTER TABLE "escrow_orders"
  ADD CONSTRAINT "escrow_orders_buyer_id_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "escrow_orders"
  ADD CONSTRAINT "escrow_orders_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "escrow_orders_order_no_key" ON "escrow_orders"("order_no");
CREATE UNIQUE INDEX "escrow_orders_idempotency_key_key" ON "escrow_orders"("idempotency_key");
CREATE INDEX "escrow_orders_buyer_id_idx" ON "escrow_orders"("buyer_id");
CREATE INDEX "escrow_orders_seller_id_idx" ON "escrow_orders"("seller_id");
CREATE INDEX "escrow_orders_status_idx" ON "escrow_orders"("status");
CREATE INDEX "escrow_orders_status_expired_at_idx" ON "escrow_orders"("status", "expired_at");
CREATE INDEX "escrow_orders_status_shipped_at_idx" ON "escrow_orders"("status", "shipped_at");
