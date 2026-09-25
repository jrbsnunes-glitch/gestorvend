ALTER TABLE "Company" ADD COLUMN "factoryWhatsappBotEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "factoryWhatsappPhoneNumberId" VARCHAR(32);
ALTER TABLE "Company" ADD COLUMN "factoryWhatsappAccessToken" TEXT;
