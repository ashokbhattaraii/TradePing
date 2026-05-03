CREATE TABLE "PortfolioHolding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "averageCost" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioHolding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioAnalysisRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "unrealizedGain" DOUBLE PRECISION NOT NULL,
    "gainPct" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortfolioHolding_userId_symbol_key" ON "PortfolioHolding"("userId", "symbol");
CREATE INDEX "PortfolioHolding_userId_idx" ON "PortfolioHolding"("userId");
CREATE INDEX "PortfolioHolding_symbol_idx" ON "PortfolioHolding"("symbol");
CREATE INDEX "PortfolioAnalysisRun_userId_createdAt_idx" ON "PortfolioAnalysisRun"("userId", "createdAt" DESC);
CREATE INDEX "PortfolioAnalysisRun_status_idx" ON "PortfolioAnalysisRun"("status");

ALTER TABLE "PortfolioHolding" ADD CONSTRAINT "PortfolioHolding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioAnalysisRun" ADD CONSTRAINT "PortfolioAnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
