// This file handles models for the tracker engine.

export interface TrackedTrader {
    timeAdded: number;
    lastUpdated: number;
    sells: number;
    manuallyAdded: boolean;
    buys: number;
    pnl?: number;
    upnl?: number;
    rpnl?: number;
}

export type TrackedTraderAddress = string;

export type TrackedTraderObject = Record<TrackedTraderAddress, TrackedTrader>;