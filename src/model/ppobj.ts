export interface PPOBJ {
    solAmount: number;
    tokenAmount: number;
    traderPublicKey: string;
    txType: "buy" | "sell";
    pool: string;
    signature: string;
    priceSol: number;
    marketCapSol: number;
    latencyMS: number;
    mint: string;
    poolAddress: string;
}