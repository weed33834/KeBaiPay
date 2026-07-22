-- 微信原生红包全协议扩展
-- 新增字段支持：拼手气 / 普通平均 / 专属 / 口令四种类型红包
-- 兼容现有数据：默认 type=LUCKY, totalCount=1, remainingCount=1

ALTER TABLE "red_packets"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'LUCKY',
  ADD COLUMN "total_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "remaining_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "per_amount" INTEGER,
  ADD COLUMN "password" TEXT,
  ADD COLUMN "designated_receiver_id" TEXT,
  ADD COLUMN "received_amount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "red_packets_type_idx" ON "red_packets" ("type");
CREATE INDEX IF NOT EXISTS "red_packets_designated_receiver_id_idx" ON "red_packets" ("designated_receiver_id");
