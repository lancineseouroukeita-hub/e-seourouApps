-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "photoData" TEXT,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'video',
ALTER COLUMN "videoData" DROP NOT NULL,
ALTER COLUMN "videoMime" DROP NOT NULL;

