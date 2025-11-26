export interface TraderPool {
    mint: string;
    amount: number;
}

export interface PoolConfig {
    walletAddress: string;
    callback: (pools: TraderPool[]) => void;
}