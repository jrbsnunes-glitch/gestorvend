-- Registro de acessos a telas (menus) para auditoria / consulta de logs.

CREATE TABLE "UserNavigationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "menuKey" TEXT NOT NULL,
    "menuLabel" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNavigationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserNavigationLog_userId_createdAt_idx" ON "UserNavigationLog"("userId", "createdAt");
CREATE INDEX "UserNavigationLog_menuKey_createdAt_idx" ON "UserNavigationLog"("menuKey", "createdAt");
CREATE INDEX "UserNavigationLog_createdAt_idx" ON "UserNavigationLog"("createdAt");

ALTER TABLE "UserNavigationLog" ADD CONSTRAINT "UserNavigationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
