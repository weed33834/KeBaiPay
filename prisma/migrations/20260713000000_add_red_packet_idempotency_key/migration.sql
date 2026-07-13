-- AlterTable
ALTER TABLE "red_packets" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "red_packets_idempotency_key_key" ON "red_packets"("idempotency_key");
