-- Unidade tributável "Serviço": produto sem controle de estoque (isService).
INSERT INTO "TaxUnitCode" ("id", "code", "description", "createdAt")
VALUES (
  '00000000-0000-4000-8000-00000000000d',
  'SERV',
  'Serviço',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
