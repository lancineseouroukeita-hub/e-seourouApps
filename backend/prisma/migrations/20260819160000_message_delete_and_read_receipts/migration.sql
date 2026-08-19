-- AlterTable
ALTER TABLE "Message" ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN "lastReadAt" TIMESTAMP(3);
