export interface Position {
    copiedFrom: string;
    buyTime: number;
    confirmed: boolean;
    buyAmount: number;
    buyCapital: number;
    buyPrice: number;
    buyLatencyMS: number;
    sellLatenciesMS: number[];
    currentPrice: number;
    peakPnL: number;
    leastPnL: number;
    pnL: number;
    lastUpdated: number;
    solGotten: number;
    amountHeld: number;
    sellIndices: number[];
    sellReasons: string[];
    lastSellTS: number;
}

export interface WaitingSigns {
    ts: number;
    isBuy: boolean;
}

export type Mint = string;