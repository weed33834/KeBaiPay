-- 邀请返现/推荐奖励模块
-- ReferralCode：每个用户一个唯一邀请码
-- Referral：邀请关系记录（邀请人 + 被邀请人 + 状态 + 奖励）

CREATE TABLE "referral_codes" (
    "id"            TEXT            NOT NULL,
    "code"          TEXT            NOT NULL,
    "user_id"       TEXT            NOT NULL,
    "created_at"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");
CREATE UNIQUE INDEX "referral_codes_user_id_key" ON "referral_codes"("user_id");

CREATE TABLE "referrals" (
    "id"             TEXT            NOT NULL,
    "referral_no"    TEXT            NOT NULL,
    "referrer_id"    TEXT            NOT NULL,
    "invitee_id"     TEXT            NOT NULL,
    "status"         TEXT            NOT NULL DEFAULT 'PENDING',
    "reward_amount"  INTEGER         NOT NULL DEFAULT 0,
    "trigger_tx_no"  TEXT,
    "completed_at"   TIMESTAMP(3),
    "cancelled_at"   TIMESTAMP(3),
    "cancel_reason"  TEXT,
    "created_at"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referrals_referral_no_key" ON "referrals"("referral_no");
CREATE UNIQUE INDEX "referrals_invitee_id_key" ON "referrals"("invitee_id");
CREATE INDEX "referrals_referrer_id_idx" ON "referrals"("referrer_id");
CREATE INDEX "referrals_status_idx" ON "referrals"("status");
CREATE INDEX "referrals_created_at_idx" ON "referrals"("created_at");

ALTER TABLE "referral_codes"
    ADD CONSTRAINT "referral_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_referrer_id_fkey"
    FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_invitee_id_fkey"
    FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
