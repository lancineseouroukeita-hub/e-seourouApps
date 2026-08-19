-- AlterTable
-- Ajoute le support des pièces jointes (image, fichier, message vocal) sur les messages.
-- Le contenu du fichier est stocké encodé en base64 dans "attachmentData" (pas de
-- service de stockage externe), ce qui suffit pour des fichiers de quelques Mo.
ALTER TABLE "Message" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "Message" ADD COLUMN     "attachmentData" TEXT;
ALTER TABLE "Message" ADD COLUMN     "attachmentMime" TEXT;
ALTER TABLE "Message" ADD COLUMN     "attachmentName" TEXT;
ALTER TABLE "Message" ADD COLUMN     "attachmentSize" INTEGER;
ALTER TABLE "Message" ADD COLUMN     "duration" INTEGER;
