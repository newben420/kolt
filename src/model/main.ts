
export interface TraderPoolLot {
    amount: number;
    pricePerToken: number;
    timestamp: number;
}

export interface TraderPool {
    lots: TraderPoolLot[];
    realizedPnL: number;
    unrealizedPnL: number;
    totalBuys: number;
    totalSells: number;
    currentHoldings: number;
    lastActive: number;
    badScore: number;
    lastPriceSol: number; // most recent trade price for this pool
}

export type PoolAddress = string;

export interface Trader {
    pools: Record<PoolAddress, TraderPool>;
    lastActive: number;
    tier: "A" | "B" | "C"; // high-, mid-, or low-value trader
}

export type TraderAddress = string;
export type TraderObj = Record<TraderAddress, Trader>;