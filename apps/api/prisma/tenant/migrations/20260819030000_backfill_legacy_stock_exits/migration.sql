-- Saídas manuais lançadas antes do documento de saída existirem ficaram só como
-- StockMovement (MANUAL_OUT), o que as tirava da tela Saídas. Cada movimento
-- avulso vira um documento de 1 item, preservando data, motivo, local e usuário,
-- para o histórico voltar a aparecer e poder ser cancelado.

DO $$
DECLARE
  mov RECORD;
  new_exit_id TEXT;
BEGIN
  FOR mov IN
    SELECT
      m."id",
      m."variantId",
      m."locationId",
      m."quantity",
      m."reference",
      m."outboundReason",
      m."userId",
      m."createdAt"
    FROM "StockMovement" m
    WHERE m."source" = 'MANUAL_OUT'
      AND m."stockExitId" IS NULL
    ORDER BY m."createdAt", m."id"
  LOOP
    new_exit_id := (md5(random()::text || clock_timestamp()::text || mov."id"))::uuid::text;

    INSERT INTO "StockExit" (
      "id", "locationId", "reason", "reference", "status", "userId", "createdAt", "updatedAt"
    )
    VALUES (
      new_exit_id,
      mov."locationId",
      COALESCE(NULLIF(btrim(mov."outboundReason"), ''), 'Saída manual'),
      mov."reference",
      'POSTED',
      mov."userId",
      mov."createdAt",
      mov."createdAt"
    );

    INSERT INTO "StockExitItem" ("id", "exitId", "variantId", "quantity", "createdAt")
    VALUES (
      (md5(random()::text || clock_timestamp()::text || mov."id" || 'item'))::uuid::text,
      new_exit_id,
      mov."variantId",
      mov."quantity",
      mov."createdAt"
    );

    UPDATE "StockMovement" SET "stockExitId" = new_exit_id WHERE "id" = mov."id";
  END LOOP;
END $$;
