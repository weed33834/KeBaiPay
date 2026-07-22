-- ============================================================================
-- v2.1.0 AI 智能体层：新增 5 张表
-- Agent / AgentAuthorization / AgentOperationLog / AgentConversation / AgentMessage
-- 架构原则：Agent 是独立主体，用户/商户通过授权委托 Agent 代为操作
-- ============================================================================

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AgentScenario" AS ENUM ('wallet', 'merchant', 'risk', 'support');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "agent_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "app_secret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "scenario" TEXT NOT NULL DEFAULT 'wallet',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_agent_no_key" ON "agents"("agent_no");
CREATE INDEX "agents_status_idx" ON "agents"("status");
CREATE INDEX "agents_scenario_idx" ON "agents"("scenario");

-- CreateTable
CREATE TABLE "agent_authorizations" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "max_amount" INTEGER,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_authorizations_agent_id_subject_type_subject_id_idx" ON "agent_authorizations"("agent_id", "subject_type", "subject_id");
CREATE INDEX "agent_authorizations_subject_type_subject_id_idx" ON "agent_authorizations"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "agent_operation_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "amount" INTEGER,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "detail" TEXT,
    "hash" TEXT NOT NULL,
    "previous_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_operation_logs_agent_id_created_at_idx" ON "agent_operation_logs"("agent_id", "created_at");
CREATE INDEX "agent_operation_logs_subject_type_subject_id_idx" ON "agent_operation_logs"("subject_type", "subject_id");
CREATE INDEX "agent_operation_logs_action_result_idx" ON "agent_operation_logs"("action", "result");

-- AddForeignKey
ALTER TABLE "agent_operation_logs" ADD CONSTRAINT "agent_operation_logs_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "conv_no" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '智能助手会话',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "metadata" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversations_conv_no_key" ON "agent_conversations"("conv_no");
CREATE INDEX "agent_conversations_user_id_status_idx" ON "agent_conversations"("user_id", "status");
CREATE INDEX "agent_conversations_agent_id_status_idx" ON "agent_conversations"("agent_id", "status");
CREATE INDEX "agent_conversations_scenario_status_idx" ON "agent_conversations"("scenario", "status");
CREATE INDEX "agent_conversations_created_at_idx" ON "agent_conversations"("created_at");

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "conv_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" TEXT,
    "tool_call_id" TEXT,
    "model" TEXT,
    "tokens" INTEGER,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_messages_conv_id_created_at_idx" ON "agent_messages"("conv_id", "created_at");
CREATE INDEX "agent_messages_role_idx" ON "agent_messages"("role");

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conv_id_fkey"
  FOREIGN KEY ("conv_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
