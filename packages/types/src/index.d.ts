export type StockSymbol = 'NABIL' | 'NICA' | 'HDL' | 'API' | 'SHIVM' | 'NIFRA' | 'GBIME' | 'SANIMA' | 'NRIC' | 'CIT';
export type AlertCondition = 'ABOVE' | 'BELOW' | 'EQUAL';
export type AlertStatus = 'ACTIVE' | 'TRIGGERED';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
export interface StockAlert {
    id: string;
    symbol: StockSymbol;
    targetPrice: number;
    condition: AlertCondition;
    status: AlertStatus;
    lastCheckedPrice: number | null;
    createdAt: string;
    triggeredAt: string | null;
}
export interface CrawlerLog {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
}
export interface CrawlerResult {
    symbol: StockSymbol;
    price: number;
    source: 'LIVE' | 'MOCK';
    timestamp: string;
}
export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}
export declare const STOCK_SYMBOLS: StockSymbol[];
export declare const ALERT_CONDITIONS: AlertCondition[];
