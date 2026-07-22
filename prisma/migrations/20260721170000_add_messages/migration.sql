-- 消息中心 + 多通道推送
-- Message：站内消息（广播 userId=null 或定向 userId=具体）
-- MessageRead：已读记录

CREATE TABLE "messages" (
    "id"           TEXT            NOT NULL,
    "message_no"   TEXT            NOT NULL,
    "user_id"      TEXT,
    "category"     TEXT            NOT NULL DEFAULT 'SYSTEM',
    "title"        TEXT            NOT NULL,
    "content"      TEXT            NOT NULL,
    "link"         TEXT,
    "channels"     TEXT            NOT NULL DEFAULT 'IN_APP',
    "priority"     TEXT            NOT NULL DEFAULT 'NORMAL',
    "status"       TEXT            NOT NULL DEFAULT 'SENT',
    "created_at"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "messages_message_no_key" ON "messages"("message_no");
CREATE INDEX "messages_user_id_idx" ON "messages"("user_id");
CREATE INDEX "messages_category_idx" ON "messages"("category");
CREATE INDEX "messages_status_idx" ON "messages"("status");
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

CREATE TABLE "message_reads" (
    "id"           TEXT            NOT NULL,
    "message_id"   TEXT            NOT NULL,
    "user_id"      TEXT            NOT NULL,
    "read_at"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_reads_message_id_user_id_key" ON "message_reads"("message_id", "user_id");
CREATE INDEX "message_reads_user_id_idx" ON "message_reads"("user_id");

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_reads"
    ADD CONSTRAINT "message_reads_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_reads"
    ADD CONSTRAINT "message_reads_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
