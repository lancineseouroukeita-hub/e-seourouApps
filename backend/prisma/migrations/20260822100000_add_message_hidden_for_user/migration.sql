-- CreateTable
CREATE TABLE "MessageHiddenForUser" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageHiddenForUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageHiddenForUser_messageId_userId_key" ON "MessageHiddenForUser"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "MessageHiddenForUser" ADD CONSTRAINT "MessageHiddenForUser_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHiddenForUser" ADD CONSTRAINT "MessageHiddenForUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
