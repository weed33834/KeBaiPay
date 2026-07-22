-- 风控审计会话表
CREATE TABLE "risk_audit_sessions" (
    "id" TEXT NOT NULL,
    "session_no" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '风控咨询会话',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_audit_sessions_pkey" PRIMARY KEY ("id")
);

-- 唯一索引：session_no
CREATE UNIQUE INDEX "risk_audit_sessions_session_no_key" ON "risk_audit_sessions"("session_no");

-- 查询索引
CREATE INDEX "risk_audit_sessions_user_id_idx" ON "risk_audit_sessions"("user_id");
CREATE INDEX "risk_audit_sessions_status_idx" ON "risk_audit_sessions"("status");
CREATE INDEX "risk_audit_sessions_created_at_idx" ON "risk_audit_sessions"("created_at");

-- 外键：user_id -> users.id
ALTER TABLE "risk_audit_sessions"
  ADD CONSTRAINT "risk_audit_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 风控审计消息表
CREATE TABLE "risk_audit_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_audit_messages_pkey" PRIMARY KEY ("id")
);

-- 查询索引
CREATE INDEX "risk_audit_messages_session_id_idx" ON "risk_audit_messages"("session_id");
CREATE INDEX "risk_audit_messages_created_at_idx" ON "risk_audit_messages"("created_at");

-- 外键：session_id -> risk_audit_sessions.id（级联删除）
ALTER TABLE "risk_audit_messages"
  ADD CONSTRAINT "risk_audit_messages_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "risk_audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
