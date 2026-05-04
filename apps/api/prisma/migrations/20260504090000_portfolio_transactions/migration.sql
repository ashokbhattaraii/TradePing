CREATE TABLE "PortfolioTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "tradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PortfolioTransaction_userId_symbol_tradedAt_idx" ON "PortfolioTransaction"("userId", "symbol", "tradedAt" DESC);
CREATE INDEX "PortfolioTransaction_symbol_idx" ON "PortfolioTransaction"("symbol");
CREATE INDEX "PortfolioTransaction_type_idx" ON "PortfolioTransaction"("type");

ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
