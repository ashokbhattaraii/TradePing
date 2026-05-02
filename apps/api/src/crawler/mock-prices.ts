import type { StockSymbol } from '@tradeping/types';

const RANGES: Record<string, [number, number]> = {
  NABIL: [500, 700],
  NICA: [300, 600],
  HDL: [1000, 2500],
  API: [150, 350],
  SHIVM: [400, 800],
  NIFRA: [180, 350],
  GBIME: [180, 350],
  SANIMA: [200, 400],
  NRIC: [500, 900],
  CIT: [1500, 2500],
  PALPA: [400, 900],
};

export function mockPrice(symbol: StockSymbol): number {
  const [min, max] = RANGES[symbol] ?? [100, 1200];
  const value = min + Math.random() * (max - min);
  return Math.round(value * 100) / 100;
}
