-- Login por username (e-mail permanece interno)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- Backfill a partir da parte local do e-mail (antes do @), normalizada
UPDATE "User"
SET "username" = lower(
  regexp_replace(
    split_part("email", '@', 1),
    '[^a-zA-Z0-9._-]',
    '',
    'g'
  )
)
WHERE "username" IS NULL OR trim("username") = '';

-- Usuários sem parte local utilizável (mín. 3 chars)
UPDATE "User"
SET "username" = 'user_' || substr(replace("id"::text, '-', ''), 1, 8)
WHERE "username" IS NULL OR trim("username") = '' OR length("username") < 3;

-- Resolver colisões: o mais antigo mantém o nome; demais ganham _2, _3…
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT u.id, u.username AS base_name
    FROM "User" u
    WHERE EXISTS (
      SELECT 1
      FROM "User" o
      WHERE o.username = u.username AND o.id <> u.id
        AND (
          o."createdAt" < u."createdAt"
          OR (o."createdAt" = u."createdAt" AND o.id < u.id)
        )
    )
    ORDER BY u.username, u."createdAt", u.id
  LOOP
    base := r.base_name;
    n := 2;
    LOOP
      candidate := left(base, 29) || '_' || n;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE username = candidate);
      n := n + 1;
    END LOOP;
    UPDATE "User" SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_username_key'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");
  END IF;
END $$;
