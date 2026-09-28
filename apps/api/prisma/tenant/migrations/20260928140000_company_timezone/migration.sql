ALTER TABLE "Company" ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo';

UPDATE "Company"
SET "timezone" = CASE upper(trim("state"))
  WHEN 'AC' THEN 'America/Rio_Branco'
  WHEN 'AM' THEN 'America/Manaus'
  WHEN 'MS' THEN 'America/Cuiaba'
  WHEN 'MT' THEN 'America/Cuiaba'
  WHEN 'RO' THEN 'America/Porto_Velho'
  WHEN 'RR' THEN 'America/Boa_Vista'
  ELSE 'America/Sao_Paulo'
END
WHERE "state" IS NOT NULL AND trim("state") <> '';
