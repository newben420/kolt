// This file handles models for the tracker engine.

export interface TrackedTrader {
    timeAdded: number;
    lastUpdated: number;
    sells: number;
    manuallyAdded: boolean;
    buys: number;
    buysSol: number;
    sellsSol: number;
    pnl?: number;
    upnl?: number;
    rpnl?: number;
    showAlert: boolean;
    copy: boolean;
}

export type TrackedTraderAddress = string;

export type TrackedTraderObject = Record<TrackedTraderAddress, TrackedTrader>;