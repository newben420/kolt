import { PPOBJ } from './../model/ppobj';
import { Site } from './../site';
import { formatNumber } from './../lib/format_number';
import { Log } from './../lib/log';
import { PoolAddress, Trader, TraderAddress, TraderObj, TraderPool } from "./../model/main";
import PumpswapEngine from './pumpswap';
import { getTimeElapsed } from './../lib/date_time';

const SLUG = "MainEngine";

const WEIGHT = 3;

let cachedTrackerEngine: typeof import('./tracker').TrackerEngine | null = null;
const TrackerEngine = async () => {
    if (!cachedTrackerEngine) {
        cachedTrackerEngine = ((await import('./tracker'))).TrackerEngine;
    }
    return cachedTrackerEngine;
}

/**
 * This engine handles the main functionality of the system: managing tracked traders and their pnl.
 */
export class MainEngine {

    private static traders: TraderObj = {};

    static tradersCount = () => Object.keys(MainEngine.traders).length;

    static deletedTradersCount: number = 0;

    // 🔧 Configurable constants
    private static INACTIVITY_TIMEOUT_MS = Site.MN_INACTIVITY_TIMEOUT_MS;
    private static BAD_PNL_THRESHOLD = Site.MN_BAD_PNL_THRESHOLD;
    private static MAX_BAD_SCORE = Site.MN_MAX_BAD_SCORE;
    private static MEMORY_CAP = Site.MN_MEMORY_CAP; // Max number of traders to keep in memory

    // Tier rules
    private static TIER_MULTIPLIER = {
        A: 4, // top traders stay 4× longer
        B: 2,
        C: 1,
    };

    static newTrader = (address: TraderAddress): Trader => {
        if (!MainEngine.traders[address]) {
            MainEngine.traders[address] = {
                pools: {},
                lastActive: Date.now(),
                tier: "C",
            };
            Log.flow([SLUG, `Add`, `${address}`, `Total: ${formatNumber(Object.keys(MainEngine.traders).length)}.`], WEIGHT);
            PumpswapEngine.monitorTrader(address);
        }
        return MainEngine.traders[address];
    };

    private static getOrCreatePool(trader: Trader, pool: PoolAddress): TraderPool {
        if (!trader.pools[pool]) {
            trader.pools[pool] = {
                lots: [],
                realizedPnL: 0,
                unrealizedPnL: 0,
                totalBuys: 0,
                totalSells: 0,
                currentHoldings: 0,
                lastActive: Date.now(),
                badScore: 0,
                lastPriceSol: 0,
            };
        }
        return trader.pools[pool];
    }

    static newTrade = ({
        solAmount,
        tokenAmount,
        traderPublicKey,
        txType,
        pool,
        priceSol,
        latencyMS,
        marketCapSol,
        mint,
        poolAddress,
        signature
    }: PPOBJ) => {
        if (MainEngine.traders[traderPublicKey]) {
            const trader = MainEngine.newTrader(traderPublicKey);
            const traderPool = MainEngine.getOrCreatePool(trader, mint);

            trader.lastActive = Date.now();
            traderPool.lastActive = Date.now();
            traderPool.lastPriceSol = priceSol;

            if (txType === "buy") {
                const pricePerToken = solAmount / tokenAmount;
                traderPool.lots.push({
                    amount: tokenAmount,
                    pricePerToken,
                    timestamp: Date.now(),
                });
                traderPool.totalBuys += solAmount;

                traderPool.currentHoldings += tokenAmount;
            } else if (txType === "sell") {
                let remainingToSell = tokenAmount;
                const sellPrice = solAmount / tokenAmount;
                traderPool.totalSells += solAmount;

                let pnlDelta = 0;
                while (remainingToSell > 0 && traderPool.lots.length > 0) {
                    const lot = traderPool.lots[0];
                    const sellAmount = Math.min(lot.amount, remainingToSell);
                    const profit = (sellPrice - lot.pricePerToken) * sellAmount;
                    pnlDelta += profit;
                    lot.amount -= sellAmount;
                    remainingToSell -= sellAmount;
                    if (lot.amount <= 0) traderPool.lots.shift();
                }

                traderPool.realizedPnL += pnlDelta;
                traderPool.currentHoldings = Math.max(0, traderPool.currentHoldings - tokenAmount);

                const roi = pnlDelta / (solAmount || 1);
                traderPool.badScore = roi < this.BAD_PNL_THRESHOLD
                    ? traderPool.badScore + 1
                    : Math.max(0, traderPool.badScore - 1);
            }

            // Update unrealized PnL
            MainEngine.updateUnrealizedPnL(traderPool);

            // Tier recalibration
            MainEngine.updateTraderTier(trader);

            // Occasional cleanup
            // if (Math.random() < 0.02) MainEngine.collectGarbage();
        }
    };

    private static updateUnrealizedPnL(pool: TraderPool) {
        if (!pool.currentHoldings || pool.lots.length === 0) {
            pool.unrealizedPnL = 0;
            return;
        }
        const avgCost =
            pool.lots.reduce((sum, lot) => sum + lot.amount * lot.pricePerToken, 0) /
            pool.lots.reduce((sum, lot) => sum + lot.amount, 0);
        pool.unrealizedPnL =
            (pool.lastPriceSol - avgCost) * pool.currentHoldings;
    }

    private static updateTraderTier(trader: Trader) {
        const totalRealized = Object.values(trader.pools).reduce(
            (sum, p) => sum + p.realizedPnL,
            0
        );
        const totalUnrealized = Object.values(trader.pools).reduce(
            (sum, p) => sum + p.unrealizedPnL,
            0
        );
        const totalPnL = totalRealized + totalUnrealized;

        trader.tier =
            totalPnL > 10
                ? "A"
                : totalPnL > 1
                    ? "B"
                    : "C";
    }

    static start = async () => {
        MainEngine.collectGarbage();
        return true;
    }

    private static async collectGarbage() {
        const now = Date.now();
        const conclude = () => {
            Log.flow([SLUG, `GC`, `Concluded.`], WEIGHT);
            const stop = Date.now();
            const duration = stop - now;
            if (duration >= Site.MN_GARBAGE_INTERVAL_MS) {
                MainEngine.collectGarbage();
            }
            else {
                const remaining = Site.MN_GARBAGE_INTERVAL_MS - duration;
                setTimeout(() => {
                    MainEngine.collectGarbage();
                }, remaining);
                Log.flow([SLUG, `GC`, `Running again in ${getTimeElapsed(0, remaining)}.`], WEIGHT);
            }
        }

        Log.flow([SLUG, `GC`, `Initialized.`], WEIGHT);
        let removedPools = 0;
        let removedTraders = 0;

        // Memory cap enforcement
        const traderCount = Object.keys(MainEngine.traders).length;
        if (traderCount > MainEngine.MEMORY_CAP) {
            // Sort traders by total PnL, remove the worst N
            const sorted = Object.entries(MainEngine.traders)
                .map(([addr, t]) => ({
                    addr,
                    totalPnL: Object.values(t.pools).reduce(
                        (sum, p) => sum + p.realizedPnL + p.unrealizedPnL,
                        0
                    ),
                }))
                .sort((a, b) => a.totalPnL - b.totalPnL); // ascending

            const TE = await TrackerEngine();
            const toRemove = sorted.filter(t => !(TE.traderExists(t.addr))).slice(0, traderCount - MainEngine.MEMORY_CAP);
            for (const { addr } of toRemove) {
                delete MainEngine.traders[addr];
                // Log.flow([SLUG, `GC`, `Remove`, `${addr}`, `Total left: ${formatNumber(Object.keys(MainEngine.traders).length)}.`], WEIGHT);
                PumpswapEngine.unmonitorTrader(addr);
                MainEngine.deletedTradersCount += 1;
                removedTraders++;
            }
        }

        // Inactivity & performance cleanup
        for (const [traderAddr, trader] of Object.entries(MainEngine.traders)) {
            const tierFactor = MainEngine.TIER_MULTIPLIER[trader.tier];
            const timeout = MainEngine.INACTIVITY_TIMEOUT_MS * tierFactor;

            for (const [poolAddr, pool] of Object.entries(trader.pools)) {
                const inactive = now - pool.lastActive > timeout;
                const tooBad = pool.badScore >= MainEngine.MAX_BAD_SCORE;
                if (inactive || tooBad) {
                    delete trader.pools[poolAddr];
                    removedPools++;
                }
            }

            const TE = await TrackerEngine();
            const isEmpty = Object.keys(trader.pools).length === 0;
            const stale = now - trader.lastActive > timeout;
            if (isEmpty && stale && (!TE.traderExists(traderAddr))) {
                delete MainEngine.traders[traderAddr];
                removedTraders++;
            }
        }

        if (removedTraders > 0 || removedPools > 0) {
            Log.flow([SLUG, `GC`, `Removed ${removedTraders} trader${removedTraders == 1 ? '' : 's'} and ${removedPools} pool${removedPools == 1 ? '' : 's'} (total traders left: ${formatNumber(Object.keys(this.traders).length)}).`], WEIGHT);
        }

        conclude();
    }

    /**
     * Returns the top N performing traders ranked by total (realized + unrealized) PnL.
     * @param limit Number of traders to return (default 10)
     */
    static getTopTraders(limit: number = 10) {
        const scores = Object.entries(MainEngine.traders).map(([address, trader]) => {
            const totalRealized = Object.values(trader.pools).reduce((sum, p) => sum + p.realizedPnL, 0);
            const totalUnrealized = Object.values(trader.pools).reduce((sum, p) => sum + p.unrealizedPnL, 0);
            const totalPnL = totalRealized + totalUnrealized;

            return {
                address,
                totalPnL,
                realizedPnL: totalRealized,
                unrealizedPnL: totalUnrealized,
                tier: trader.tier,
                currentHoldings: Object.values(trader.pools).reduce((sum, p) => sum + p.currentHoldings, 0)
            };
        });

        scores.sort((a, b) => b.totalPnL - a.totalPnL); // descending

        if (scores.length > 0) {
            Log.flow([SLUG, `Leaderboard`, `Top ${limit} traders:`, scores.slice(0, limit).map(t => `${t.address} (${formatNumber(t.totalPnL)})`).join(', ')], WEIGHT);
        }

        return scores.slice(0, limit);
    }

    static getTraderStats = (address: string) => {
        if (MainEngine.traders[address]) {
            const trader = MainEngine.traders[address];
            const totalRealized = Object.values(trader.pools).reduce((sum, p) => sum + p.realizedPnL, 0);
            const totalUnrealized = Object.values(trader.pools).reduce((sum, p) => sum + p.unrealizedPnL, 0);
            const totalPnL = totalRealized + totalUnrealized;

            return {
                address,
                totalPnL,
                realizedPnL: totalRealized,
                unrealizedPnL: totalUnrealized,
                tier: trader.tier,
                currentHoldings: Object.values(trader.pools).reduce((sum, p) => sum + p.currentHoldings, 0)
            };
        }
        return null;
    }
}