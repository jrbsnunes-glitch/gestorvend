-- Seed e backfill em migration separada: o PG exige commit do novo valor de enum
-- antes de usá-lo em INSERT/UPDATE.

INSERT INTO "PaymentForm" ("id", "name", "kind", "isActive", "sortOrder", "maxInstallments", "updatedAt")
SELECT 'a1000000-0000-4000-8000-000000000010', 'Requisição', 'REQUISITION'::"PaymentFormKind", true, 50, 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "PaymentForm" WHERE "kind" = 'REQUISITION'::"PaymentFormKind"
);

UPDATE "AccountReceivable" ar
SET "creditKind" = 'CREDIT'::"CreditKind"
WHERE ar."saleId" IS NOT NULL
  AND ar."creditKind" IS NULL
  AND EXISTS (
    SELECT 1 FROM "SalePayment" sp
    WHERE sp."saleId" = ar."saleId" AND sp."method" = 'CREDIT'::"PaymentMethod"
  );
