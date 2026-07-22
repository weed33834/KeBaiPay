-- AlterTable
-- idCard 加密后每次密文不同（AES-GCM 带 IV），原 id_card @unique 约束无法防止同一身份证被多用户提交。
-- 新增 id_card_hash 字段存 SHA-256(明文)，用于 DB 层强制唯一性。
ALTER TABLE "identity_verifications" ADD COLUMN "id_card_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_id_card_hash_key" ON "identity_verifications"("id_card_hash");
