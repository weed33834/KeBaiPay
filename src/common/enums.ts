// Prisma-compatible enum constants for SQLite (no native enum support)
// Use these string constants instead of Prisma enum types

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FINANCE = 'FINANCE',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  RISK_OFFICER = 'RISK_OFFICER',
}

export enum AdminStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  EXPENSE_RESTRICTED = 'EXPENSE_RESTRICTED',
  INCOME_RESTRICTED = 'INCOME_RESTRICTED',
  FROZEN = 'FROZEN',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RealNameStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum MerchantType {
  PERSONAL = 'PERSONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum MerchantStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
}

export enum LedgerType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
  FEE = 'FEE',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum Direction {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum TransactionType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum BillType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  RECEIPT = 'RECEIPT',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
}

export enum BillDirection {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export enum RedPacketStatus {
  PENDING = 'PENDING',
  RECEIVED = 'RECEIVED',
  EXPIRED = 'EXPIRED',
}

export enum RedPacketRecordType {
  RECEIVE = 'RECEIVE',
  RETURN = 'RETURN',
}

export enum QrCodeType {
  PERSONAL = 'PERSONAL',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  MERCHANT = 'MERCHANT',
}

export enum QrCodeStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum AppStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum PaymentOrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
  REFUNDED = 'REFUNDED',
}

export enum NotifyStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum RiskEventType {
  LARGE_TRANSFER = 'LARGE_TRANSFER',
  LARGE_WITHDRAWAL = 'LARGE_WITHDRAWAL',
  LARGE_PAYMENT = 'LARGE_PAYMENT',
  SUSPICIOUS_RED_PACKET = 'SUSPICIOUS_RED_PACKET',
  FREQUENT_TRANSACTION = 'FREQUENT_TRANSACTION',
  FREQUENT_LOGIN = 'FREQUENT_LOGIN',
  SUSPICIOUS_DEVICE = 'SUSPICIOUS_DEVICE',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  STATUS_CHANGED = 'STATUS_CHANGED',
}

export enum ReconciliationStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SNAPSHOT_MISSING = 'SNAPSHOT_MISSING',
}

export enum ChannelType {
  RECHARGE = 'RECHARGE',
  PAYOUT = 'PAYOUT',
  BOTH = 'BOTH',
}
