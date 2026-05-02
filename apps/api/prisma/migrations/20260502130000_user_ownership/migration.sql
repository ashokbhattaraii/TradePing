-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "userId" TEXT;
ALTER TABLE "Watchlist" ADD COLUMN "userId" TEXT;
ALTER TABLE "Log" ADD COLUMN "userId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "userId" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN "userId" TEXT;
ALTER TABLE "NotificationTemplate" ADD COLUMN "userId" TEXT;
ALTER TABLE "NotificationRule" ADD COLUMN "userId" TEXT;
ALTER TABLE "PriceHistory" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");
CREATE INDEX "Alert_userId_status_idx" ON "Alert"("userId", "status");
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");
CREATE INDEX "Log_userId_idx" ON "Log"("userId");
CREATE INDEX "Setting_userId_idx" ON "Setting"("userId");
CREATE INDEX "NotificationChannel_userId_idx" ON "NotificationChannel"("userId");
CREATE INDEX "NotificationTemplate_userId_idx" ON "NotificationTemplate"("userId");
CREATE INDEX "NotificationRule_userId_idx" ON "NotificationRule"("userId");
CREATE INDEX "PriceHistory_userId_idx" ON "PriceHistory"("userId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Log" ADD CONSTRAINT "Log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
