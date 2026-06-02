-- Substitui logs de navegação por auditoria de ações de negócio.

DROP TABLE IF EXISTS "UserNavigationLog";

CREATE TYPE "ActivityLogAction" AS ENUM (
  'LOGIN',
  'CASH_OPEN',
  'CASH_CLOSE',
  'RECEIPT',
  'FISCAL_DOC',
  'REPORT',
  'CREATE',
  'UPDATE',
  'DELETE'
);

CREATE TABLE "UserActivityLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" "ActivityLogAction" NOT NULL,
  "summary" TEXT NOT NULL,
  "entityType" TEXT,
  "entityRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserActivityLog_userId_createdAt_idx" ON "UserActivityLog"("userId", "createdAt");
CREATE INDEX "UserActivityLog_action_createdAt_idx" ON "UserActivityLog"("action", "createdAt");
CREATE INDEX "UserActivityLog_createdAt_idx" ON "UserActivityLog"("createdAt");

ALTER TABLE "UserActivityLog"
  ADD CONSTRAINT "UserActivityLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
