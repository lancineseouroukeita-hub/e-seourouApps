-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "personalSoundData" TEXT,
ADD COLUMN     "personalSoundMime" TEXT,
ADD COLUMN     "personalSoundName" TEXT,
ADD COLUMN     "soundId" TEXT;

-- CreateTable
CREATE TABLE "Sound" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audioData" TEXT NOT NULL,
    "audioMime" TEXT NOT NULL,
    "duration" INTEGER,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sound_createdAt_idx" ON "Sound"("createdAt");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "Sound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sound" ADD CONSTRAINT "Sound_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

