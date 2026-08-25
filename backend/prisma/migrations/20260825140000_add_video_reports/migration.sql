-- CreateTable
CREATE TABLE "VideoReport" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoReport_videoId_createdAt_idx" ON "VideoReport"("videoId", "createdAt");

-- AddForeignKey
ALTER TABLE "VideoReport" ADD CONSTRAINT "VideoReport_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoReport" ADD CONSTRAINT "VideoReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
