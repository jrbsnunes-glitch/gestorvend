CREATE TYPE "PdvTerminalRole" AS ENUM ('PRIMARY', 'SATELLITE');

ALTER TABLE "PdvTerminal" ADD COLUMN "role" "PdvTerminalRole" NOT NULL DEFAULT 'SATELLITE';

UPDATE "PdvTerminal" SET "role" = 'PRIMARY' WHERE "number" = 1;
