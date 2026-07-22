-- 订阅/周期扣款模块
CREATE TABLE "subscription_plans" (
    "id"              TEXT NOT NULL,
    "plan_no"         TEXT NOT NULL,
    "owner_id"        TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "amount"          INTEGER NOT NULL,
    "period"          TEXT NOT NULL DEFAULT 'MONTHLY',
    "interval_count"  INTEGER NOT NULL DEFAULT 1,
    "trial_days"      INTEGER NOT NULL DEFAULT 0,
    "total_cycles"    INTEGER,
    "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plans_plan_no_key" ON "subscription_plans"("plan_no");
CREATE INDEX "subscription_plans_owner_id_idx" ON "subscription_plans"("owner_id");
CREATE INDEX "subscription_plans_status_idx" ON "subscription_plans"("status");

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "subscriptions" (
    "id"                  TEXT NOT NULL,
    "subscription_no"     TEXT NOT NULL,
    "subscriber_id"       TEXT NOT NULL,
    "plan_id"             TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
    "start_at"            TIMESTAMP(3) NOT NULL,
    "current_cycle_start" TIMESTAMP(3) NOT NULL,
    "current_cycle_end"   TIMESTAMP(3) NOT NULL,
    "next_charge_at"      TIMESTAMP(3),
    "end_at"              TIMESTAMP(3),
    "cancelled_at"        TIMESTAMP(3),
    "completed_cycles"    INTEGER NOT NULL DEFAULT 0,
    "last_charge_id"      TEXT,
    "idempotency_key"     TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_subscription_no_key" ON "subscriptions"("subscription_no");
CREATE UNIQUE INDEX "subscriptions_idempotency_key_key" ON "subscriptions"("idempotency_key");
CREATE INDEX "subscriptions_subscriber_id_idx" ON "subscriptions"("subscriber_id");
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX "subscriptions_status_next_charge_at_idx" ON "subscriptions"("status", "next_charge_at");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_subscriber_id_fkey"
  FOREIGN KEY ("subscriber_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "subscription_charges" (
    "id"               TEXT NOT NULL,
    "charge_no"        TEXT NOT NULL,
    "subscription_id"  TEXT NOT NULL,
    "subscriber_id"    TEXT NOT NULL,
    "owner_id"         TEXT NOT NULL,
    "amount"           INTEGER NOT NULL,
    "cycle_start"      TIMESTAMP(3) NOT NULL,
    "cycle_end"        TIMESTAMP(3) NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'PENDING',
    "transaction_id"    TEXT,
    "failure_reason"   TEXT,
    "charged_at"       TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_charges_charge_no_key" ON "subscription_charges"("charge_no");
CREATE INDEX "subscription_charges_subscription_id_idx" ON "subscription_charges"("subscription_id");
CREATE INDEX "subscription_charges_subscriber_id_idx" ON "subscription_charges"("subscriber_id");
CREATE INDEX "subscription_charges_owner_id_idx" ON "subscription_charges"("owner_id");
CREATE INDEX "subscription_charges_status_idx" ON "subscription_charges"("status");
CREATE INDEX "subscription_charges_status_charged_at_idx" ON "subscription_charges"("status", "charged_at");

ALTER TABLE "subscription_charges"
  ADD CONSTRAINT "subscription_charges_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_charges"
  ADD CONSTRAINT "subscription_charges_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
