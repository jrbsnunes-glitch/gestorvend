-- Acesso por menu (perfil Caixa)
CREATE TABLE IF NOT EXISTS "MenuAccessGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "menuKey" VARCHAR(40) NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canCreate" BOOLEAN NOT NULL DEFAULT false,
  "canUpdate" BOOLEAN NOT NULL DEFAULT false,
  "canDelete" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MenuAccessGrant_userId_menuKey_key"
  ON "MenuAccessGrant"("userId", "menuKey");

CREATE INDEX IF NOT EXISTS "MenuAccessGrant_userId_idx"
  ON "MenuAccessGrant"("userId");

DO $$ BEGIN
  ALTER TABLE "MenuAccessGrant"
    ADD CONSTRAINT "MenuAccessGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
