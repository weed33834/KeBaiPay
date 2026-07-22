-- 商户发票 Invoice
CREATE TABLE "invoices" (
    "id"              TEXT            NOT NULL,
    "invoice_no"      TEXT            NOT NULL,
    "merchant_id"     TEXT            NOT NULL,
    "type"            TEXT            NOT NULL DEFAULT 'NORMAL',
    "title"           TEXT            NOT NULL,
    "tax_no"          TEXT,
    "bank_name"       TEXT,
    "bank_account"    TEXT,
    "address"         TEXT,
    "phone"           TEXT,
    "amount"          INTEGER         NOT NULL,
    "status"          TEXT            NOT NULL DEFAULT 'PENDING',
    "issue_date"      TIMESTAMP(3),
    "remark"          TEXT,
    "created_at"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");
CREATE INDEX "invoices_merchant_id_idx" ON "invoices"("merchant_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");

ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
