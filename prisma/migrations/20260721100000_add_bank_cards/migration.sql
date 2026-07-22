-- 银行卡管理表
CREATE TABLE "bank_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "card_number_hash" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch_name" TEXT,
    "phone" TEXT,
    "phone_hash" TEXT,
    "card_type" TEXT NOT NULL DEFAULT 'DEBIT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_cards_pkey" PRIMARY KEY ("id")
);

-- 卡号哈希全局唯一：一卡只能被一个用户绑定（防止盗卡多绑）
CREATE UNIQUE INDEX "bank_cards_card_number_hash_key" ON "bank_cards"("card_number_hash");

CREATE INDEX "bank_cards_user_id_idx" ON "bank_cards"("user_id");
CREATE INDEX "bank_cards_status_idx" ON "bank_cards"("status");

-- 外键约束
ALTER TABLE "bank_cards" ADD CONSTRAINT "bank_cards_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
