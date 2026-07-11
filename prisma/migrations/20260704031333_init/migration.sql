-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "login_password" TEXT NOT NULL,
    "pay_password" TEXT,
    "avatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "real_name_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_no" TEXT NOT NULL,
    "merchant_name" TEXT NOT NULL,
    "merchant_type" TEXT NOT NULL DEFAULT 'PERSONAL',
    "business_license_no" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "settle_account" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "pay_rate" INTEGER NOT NULL DEFAULT 60,
    "withdraw_rate" INTEGER NOT NULL DEFAULT 60,
    "daily_limit" INTEGER NOT NULL DEFAULT 10000000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "real_name" TEXT NOT NULL,
    "id_card" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "available_balance" INTEGER NOT NULL DEFAULT 0,
    "frozen_balance" INTEGER NOT NULL DEFAULT 0,
    "total_balance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ledgers" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "from_user_id" TEXT,
    "to_user_id" TEXT,
    "remark" TEXT,
    "related_order_no" TEXT,
    "idempotency_key" TEXT,
    "channel" TEXT,
    "channel_order_no" TEXT,
    "expires_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "counterparty" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "actual_amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'BANK',
    "channel_order_no" TEXT,
    "channel_account" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "remark" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_packets" (
    "id" TEXT NOT NULL,
    "packet_no" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "red_packets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_packet_records" (
    "id" TEXT NOT NULL,
    "red_packet_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_packet_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PERSONAL',
    "amount" INTEGER,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_apps" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_secret" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callback_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_order_no" TEXT NOT NULL,
    "app_id" TEXT,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payer_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "callback_url" TEXT,
    "notify_status" TEXT NOT NULL DEFAULT 'PENDING',
    "notify_count" INTEGER NOT NULL DEFAULT 0,
    "extra" TEXT,
    "idempotency_key" TEXT,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMP(3),
    "refunded_by" TEXT,
    "refund_reason" TEXT,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nickname" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "handled_by" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_snapshots" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "total_assets" INTEGER NOT NULL,
    "total_income" INTEGER NOT NULL DEFAULT 0,
    "total_expense" INTEGER NOT NULL DEFAULT 0,
    "total_fee" INTEGER NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_limit_usages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "limit_type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "used_amount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_limit_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_reports" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "differences" TEXT,
    "summary" TEXT,
    "checked_by" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_operation_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "hash" TEXT,
    "previous_hash" TEXT,
    "seq" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_channel_configs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_user_id_key" ON "merchants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_merchant_no_key" ON "merchants"("merchant_no");

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_user_id_key" ON "identity_verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_id_card_key" ON "identity_verifications"("id_card");

-- CreateIndex
CREATE INDEX "identity_verifications_status_idx" ON "identity_verifications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_key" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "account_ledgers_account_id_idx" ON "account_ledgers"("account_id");

-- CreateIndex
CREATE INDEX "account_ledgers_transaction_id_idx" ON "account_ledgers"("transaction_id");

-- CreateIndex
CREATE INDEX "account_ledgers_type_idx" ON "account_ledgers"("type");

-- CreateIndex
CREATE INDEX "account_ledgers_created_at_idx" ON "account_ledgers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_orders_order_no_key" ON "transaction_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_orders_idempotency_key_key" ON "transaction_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "transaction_orders_from_user_id_idx" ON "transaction_orders"("from_user_id");

-- CreateIndex
CREATE INDEX "transaction_orders_to_user_id_idx" ON "transaction_orders"("to_user_id");

-- CreateIndex
CREATE INDEX "transaction_orders_channel_order_no_idx" ON "transaction_orders"("channel_order_no");

-- CreateIndex
CREATE INDEX "transaction_orders_type_idx" ON "transaction_orders"("type");

-- CreateIndex
CREATE INDEX "transaction_orders_related_order_no_idx" ON "transaction_orders"("related_order_no");

-- CreateIndex
CREATE INDEX "transaction_orders_status_completed_at_idx" ON "transaction_orders"("status", "completed_at");

-- CreateIndex
CREATE INDEX "transaction_orders_created_at_idx" ON "transaction_orders"("created_at");

-- CreateIndex
CREATE INDEX "bills_user_id_idx" ON "bills"("user_id");

-- CreateIndex
CREATE INDEX "bills_user_id_created_at_idx" ON "bills"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bills_transaction_id_idx" ON "bills"("transaction_id");

-- CreateIndex
CREATE INDEX "bills_created_at_idx" ON "bills"("created_at");

-- CreateIndex
CREATE INDEX "bills_type_idx" ON "bills"("type");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_orders_order_no_key" ON "withdrawal_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_orders_idempotency_key_key" ON "withdrawal_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "withdrawal_orders_user_id_idx" ON "withdrawal_orders"("user_id");

-- CreateIndex
CREATE INDEX "withdrawal_orders_status_idx" ON "withdrawal_orders"("status");

-- CreateIndex
CREATE INDEX "withdrawal_orders_channel_order_no_idx" ON "withdrawal_orders"("channel_order_no");

-- CreateIndex
CREATE INDEX "withdrawal_orders_status_reviewed_at_idx" ON "withdrawal_orders"("status", "reviewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "red_packets_packet_no_key" ON "red_packets"("packet_no");

-- CreateIndex
CREATE INDEX "red_packets_sender_id_idx" ON "red_packets"("sender_id");

-- CreateIndex
CREATE INDEX "red_packets_status_expires_at_idx" ON "red_packets"("status", "expires_at");

-- CreateIndex
CREATE INDEX "red_packet_records_red_packet_id_idx" ON "red_packet_records"("red_packet_id");

-- CreateIndex
CREATE INDEX "red_packet_records_receiver_id_idx" ON "red_packet_records"("receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "red_packet_records_red_packet_id_receiver_id_key" ON "red_packet_records"("red_packet_id", "receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_code_key" ON "qr_codes"("code");

-- CreateIndex
CREATE INDEX "qr_codes_user_id_idx" ON "qr_codes"("user_id");

-- CreateIndex
CREATE INDEX "qr_codes_merchant_id_idx" ON "qr_codes"("merchant_id");

-- CreateIndex
CREATE INDEX "qr_codes_status_idx" ON "qr_codes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_apps_app_id_key" ON "merchant_apps"("app_id");

-- CreateIndex
CREATE INDEX "merchant_apps_merchant_id_idx" ON "merchant_apps"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_apps_status_idx" ON "merchant_apps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_order_no_key" ON "payment_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_idempotency_key_key" ON "payment_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_orders_merchant_id_idx" ON "payment_orders"("merchant_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");

-- CreateIndex
CREATE INDEX "payment_orders_payer_id_idx" ON "payment_orders"("payer_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_paid_at_idx" ON "payment_orders"("status", "paid_at");

-- CreateIndex
CREATE INDEX "payment_orders_merchant_id_created_at_idx" ON "payment_orders"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_orders_notify_status_idx" ON "payment_orders"("notify_status");

-- CreateIndex
CREATE INDEX "payment_orders_settled_at_idx" ON "payment_orders"("settled_at");

-- CreateIndex
CREATE INDEX "payment_orders_status_settled_at_paid_at_idx" ON "payment_orders"("status", "settled_at", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_merchant_id_merchant_order_no_key" ON "payment_orders"("merchant_id", "merchant_order_no");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "login_logs_user_id_idx" ON "login_logs"("user_id");

-- CreateIndex
CREATE INDEX "login_logs_created_at_idx" ON "login_logs"("created_at");

-- CreateIndex
CREATE INDEX "risk_events_user_id_idx" ON "risk_events"("user_id");

-- CreateIndex
CREATE INDEX "risk_events_level_idx" ON "risk_events"("level");

-- CreateIndex
CREATE INDEX "risk_events_handled_idx" ON "risk_events"("handled");

-- CreateIndex
CREATE INDEX "risk_events_type_idx" ON "risk_events"("type");

-- CreateIndex
CREATE INDEX "risk_events_created_at_idx" ON "risk_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_snapshots_date_key" ON "daily_snapshots"("date");

-- CreateIndex
CREATE INDEX "daily_limit_usages_user_id_idx" ON "daily_limit_usages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_limit_usages_user_id_limit_type_date_key" ON "daily_limit_usages"("user_id", "limit_type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_reports_date_key" ON "reconciliation_reports"("date");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_operation_logs_hash_key" ON "admin_operation_logs"("hash");

-- CreateIndex
CREATE INDEX "admin_operation_logs_admin_id_idx" ON "admin_operation_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_operation_logs_created_at_idx" ON "admin_operation_logs"("created_at");

-- CreateIndex
CREATE INDEX "admin_operation_logs_action_idx" ON "admin_operation_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "payment_channel_configs_code_key" ON "payment_channel_configs"("code");

-- CreateIndex
CREATE INDEX "payment_channel_configs_enabled_idx" ON "payment_channel_configs"("enabled");

-- CreateIndex
CREATE INDEX "payment_channel_configs_type_idx" ON "payment_channel_configs"("type");

-- CreateIndex
CREATE INDEX "journal_entries_journal_id_idx" ON "journal_entries"("journal_id");

-- CreateIndex
CREATE INDEX "journal_entries_account_code_idx" ON "journal_entries"("account_code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_code_key" ON "platform_accounts"("code");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_orders" ADD CONSTRAINT "transaction_orders_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_orders" ADD CONSTRAINT "transaction_orders_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_orders" ADD CONSTRAINT "withdrawal_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_packets" ADD CONSTRAINT "red_packets_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_packet_records" ADD CONSTRAINT "red_packet_records_red_packet_id_fkey" FOREIGN KEY ("red_packet_id") REFERENCES "red_packets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_apps" ADD CONSTRAINT "merchant_apps_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
