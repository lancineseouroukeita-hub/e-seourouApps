-- AlterTable
ALTER TABLE "User" ADD COLUMN     "commentPermission" TEXT NOT NULL DEFAULT 'everyone',
ADD COLUMN     "allowDownloads" BOOLEAN NOT NULL DEFAULT true;
