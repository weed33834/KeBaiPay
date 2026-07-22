-- 移除 custom_risk_rules.created_by 到 users.id 的外键约束
-- 原因：createdBy 实际上是 admin_users 表的 ID，不应与 users 表建立外键关系
-- 与 withdrawal_orders.reviewed_by、payment_orders.refunded_by 等字段保持一致
ALTER TABLE "custom_risk_rules" DROP CONSTRAINT IF EXISTS "custom_risk_rules_created_by_fkey";
