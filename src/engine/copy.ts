import { TOKEN_PROGRAM_ID } from './../lib/token_program_id';
import { getTimeElapsed } from './../lib/date_time';
import { FFF, formatNumber } from './../lib/format_number';
import { PPOBJ } from './../model/ppobj';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Log } from './../lib/log';
import { CopyStat, Mint, Position, WaitingSigns } from './../model/copy';
import { Site } from './../site';

let cachedMainEngine: typeof import('./main').MainEngine | null = null;
const MainEngine = async () => {
    if (!cachedMainEngine) {
        cachedMainEngine = ((await import('./main'))).MainEngine;
    }
    return cachedMainEngine;
}

let cachedSourceEngine: typeof import('./source').SourceEngine | null = null;
const SourceEngine = async () => {
    if (!cachedSourceEngine) {
        cachedSourceEngine = ((await import('./source'))).SourceEngine;
    }
    return cachedSourceEngine;
}

let cachedTelegramEngine: typeof import('./telegram').TelegramEngine | null = null;
const TelegramEngine = async () => {
    if (!cachedTelegramEngine) {
        cachedTelegramEngine = ((await import('./telegram'))).TelegramEngine;
    }
    return cachedTelegramEngine;
}

/**
 * This handles copy trading in either simulation mode or live mode.
 */
export class CopyEngine {

    static isLive = !Site.CP_SIMULATION;

    private static waitingSigns: Record<string, WaitingSigns> = {};

    private static positions: Record<Mint, Position> = {};

    static getPositions = () => Object.entries(CopyEngine.positions).map(([mint, position]) => ({ ...position, mint })).sort((a, b) => a.buyTime - b.buyTime);

    static getPosition = (mint: string) => CopyEngine.positions[mint] || undefined;

    static getPositionMints = () => Object.keys(CopyEngine.positions);

    static getAddressStartsWith = (pre: string) => Object.keys(CopyEngine.positions).find(addr => addr.startsWith(pre)) || null;

    static mintPresent = (mint: string) => !!CopyEngine.positions[mint];

    static totalOpenedPositions: number = 0;
    static totalClosedPositions: number = 0;
    static totalRealizedPnLSOL: number = 0;

    static deletePosition = (mint: string) => {
        if (CopyEngine.positions[mint]) {
            CopyEngine.totalClosedPositions++;
            delete CopyEngine.positions[mint];
        }
    }

    /**
     * This is called when a tracked trader with a copy flag makes a buy purchase
     */
    static copyTrader = async (trader: string, mint: string, amountSol: number, priceSol: number, marketCapSol: number, pool: string) => {
        // cleanup expired unconfirmed positions
        const MAX_DURATION = 120_000;
        Object.entries(CopyEngine.positions).map(([mint, pos]) => ({ ...pos, mint })).filter(x => (!x.confirmed) && ((Date.now() - x.buyTime) >= MAX_DURATION))
            .forEach(({ mint }) => {
                CopyEngine.deletePosition(mint);
            });
        // Lets ensure the minimum copy value is met in SOL
        if (
            Object.keys(CopyEngine.positions).length < Site.CP_MAX_CONCURRENT_POSITIONS &&
                amountSol >= Site.CP_MIN_COPY_SOL &&
                marketCapSol >= Site.CP_MIN_MARKETCAP_SOL &&
                Site.CP_CAPITAL_SOL > 0 &&
                (!CopyEngine.positions[mint]) &&
                Site.CP_ALLOWED_POOL ? (pool == Site.CP_ALLOWED_POOL) : true
        ) {
            // Lets try as quickly as possible to ensure that this is a first time buy
            // So we only copy new entries and ignore scaling
            if ((await MainEngine()).getPoolTotalBuys(trader, mint) < 2) {
                // We have now confirmed that:
                // The person we are copying from, bought for the first time, and is a substantial amount
                // We currently are not holding any amount of that mint
                CopyEngine.buy(trader, mint, Site.CP_CAPITAL_SOL, priceSol, marketCapSol, pool);
            }
        }
    }

    /**
     * This is called when trades made by this bot's wallet is recorded
     * @param m 
     */
    static ownTrade = async (m: PPOBJ) => {
        // lets verify
        if (CopyEngine.waitingSigns[m.signature]) {
            // Trade was truly initiated by this bot
            if (CopyEngine.positions[m.mint]) {
                // Position exists
                if (m.txType == "buy" && CopyEngine.waitingSigns[m.signature].isBuy) {
                    // Own buy order confirmed
                    // Record Buy latency and pop signature
                    CopyEngine.positions[m.mint].buyLatencyMS = Date.now() - CopyEngine.waitingSigns[m.signature].ts;
                    delete CopyEngine.waitingSigns[m.signature];
                    // confirm trade
                    CopyEngine.positions[m.mint].buyAmount = m.tokenAmount;
                    CopyEngine.positions[m.mint].amountHeld = CopyEngine.positions[m.mint].buyAmount;
                    CopyEngine.positions[m.mint].buyCapital = m.solAmount;
                    CopyEngine.positions[m.mint].buyPrice = m.priceSol;
                    CopyEngine.positions[m.mint].confirmed = true;

                    if (CopyEngine.alertFlag) {
                        let mess = `✅ *Buy*\n\n`;
                        mess += `Capital 🟰 \`SOL ${FFF(CopyEngine.positions[m.mint].buyCapital)}\`\n`;
                        mess += `Amount 🟰 \`${FFF(CopyEngine.positions[m.mint].buyAmount)}\`\n`;
                        mess += `Price 🟰 \`SOL ${FFF(m.priceSol)}\`\n`;
                        mess += `MarketCap 🟰 \`SOL ${FFF(m.marketCapSol)}\`\n`;
                        if (CopyEngine.positions[m.mint].buyLatencyMS) {
                            mess += `Latency 🟰 \`${formatNumber(CopyEngine.positions[m.mint].buyLatencyMS)}ms\`\n`;
                        }
                        mess += `Mint 🟰 \`${m.mint}\`\n`;
                        mess += `Pool 🟰 \`${m.pool}\`\n`;
                        mess += `Copied From 🟰 \`${CopyEngine.positions[m.mint].copiedFrom}\`\n`;
                        mess += `Signature 🟰 \`${m.signature}\`\n`;
                        (await TelegramEngine()).sendMessage(mess);
                    }


                }
                else if (m.txType == "sell" && !CopyEngine.waitingSigns[m.signature].isBuy) {
                    // Own sell order confirmed
                    // Record Sell latency and pop signature
                    const latency = Date.now() - CopyEngine.waitingSigns[m.signature].ts;
                    CopyEngine.positions[m.mint].sellLatenciesMS.push(latency);
                    delete CopyEngine.waitingSigns[m.signature];
                    // confirm trade
                    const amtSold = m.tokenAmount;
                    const amtPerc = Math.round((amtSold / CopyEngine.positions[m.mint].amountHeld) * 100);
                    const returnVal = m.solAmount;
                    const newAmtHeld = Math.max(0, (CopyEngine.positions[m.mint].amountHeld - amtSold));
                    CopyEngine.positions[m.mint].amountHeld = newAmtHeld;
                    CopyEngine.positions[m.mint].solGotten += returnVal;
                    CopyEngine.positions[m.mint].lastSellTS = Date.now();

                    if (CopyEngine.alertFlag) {
                        let mess = `✅ *Sell*\n\n`;
                        mess += `Amount 🟰 \`${amtPerc}%\`\n`;
                        mess += `Returns 🟰 \`SOL ${FFF(returnVal)}\`\n`;
                        mess += `Price 🟰 \`SOL ${FFF(m.priceSol)}\`\n`;
                        mess += `MarketCap 🟰 \`SOL ${FFF(m.marketCapSol)}\`\n`;
                        if (latency) {
                            mess += `Latency 🟰 \`${formatNumber(latency)}ms\`\n`;
                        }
                        mess += `Mint 🟰 \`${m.mint}\`\n`;
                        mess += `Pool 🟰 \`${m.pool}\`\n`;
                        mess += `Signature 🟰 \`${m.signature}\`\n`;

                        (await TelegramEngine()).sendMessage(mess);
                    }


                    CopyEngine.cleanUpPositionAfterSell(m.mint);
                }
            }
        }
    }

    static getOwnBalance = () => new Promise<number | null>(async (resolve, reject) => {
        try {
            const bal = await (await SourceEngine()).getConnection().getBalance(Site.KEYPAIR.publicKey);
            resolve(bal / 1e9);
        } catch (error) {
            Log.dev(error);
            resolve(null);
        }
    });

    static exitFlag: boolean = Site.CP_AUTO_EXIT;
    static pdFlag: boolean = Site.CP_AUTO_PEAKDROP;
    static alertFlag: boolean = Site.CP_AUTO_ALERT;

    /**
     * This is called when trades are made by any wallet
     * @param m 
     */
    static otherTrade = async ({
        latencyMS,
        marketCapSol,
        mint,
        pool,
        poolAddress,
        priceSol,
        signature,
        solAmount,
        tokenAmount,
        traderPublicKey,
        txType
    }: PPOBJ) => {
        if (CopyEngine.positions[mint] && CopyEngine.positions[mint].confirmed) {
            // There is an active position on this token
            // Lets update the position
            CopyEngine.positions[mint].currentPrice = priceSol;
            CopyEngine.positions[mint].currentMarketCap = marketCapSol;
            CopyEngine.positions[mint].pool = pool;
            let currentSolValue = CopyEngine.positions[mint].solGotten + (CopyEngine.positions[mint].amountHeld * CopyEngine.positions[mint].currentPrice);
            let pnl = currentSolValue - CopyEngine.positions[mint].buyCapital;
            CopyEngine.positions[mint].pnL = (pnl / CopyEngine.positions[mint].buyCapital) * 100;
            if (CopyEngine.positions[mint].leastPnL > CopyEngine.positions[mint].pnL) {
                CopyEngine.positions[mint].leastPnL = CopyEngine.positions[mint].pnL;
            }
            if (CopyEngine.positions[mint].peakPnL < CopyEngine.positions[mint].pnL) {
                CopyEngine.positions[mint].peakPnL = CopyEngine.positions[mint].pnL;
            }
            CopyEngine.positions[mint].lastUpdated = Date.now();

            // Exit checks
            if (CopyEngine.positions[mint].amountHeld > 0) {
                let soldAlready: boolean = false;
                if ((!soldAlready) && CopyEngine.exitFlag) {
                    for (let i = 0; i < Site.CP_EXIT_CONFIG.length; i++) {
                        if (CopyEngine.positions[mint].sellIndices.includes(i)) {
                            continue;
                        }
                        const c = Site.CP_EXIT_CONFIG[i];
                        if (traderPublicKey == CopyEngine.positions[mint].copiedFrom && txType == "sell" && c.triggerByCopy && CopyEngine.positions[mint].pnL >= c.triggerValue) {
                            // Copy Sell
                            CopyEngine.positions[mint].sellIndices.push(i);
                            const sold = await CopyEngine.sell(mint, c.sellPercentage, `Copy ${i}`, priceSol);
                            if (sold) {
                                soldAlready = true;
                                break;
                            }
                            else {
                                CopyEngine.positions[mint].sellIndices = CopyEngine.positions[mint].sellIndices.filter(x => x != i);
                            }
                        }
                        else if ((!c.triggerByCopy) && c.triggerValue > 0 ? (CopyEngine.positions[mint].pnL >= c.triggerValue) : (CopyEngine.positions[mint].pnL <= c.triggerValue)) {
                            // Take profit/ Stop Loss Sell
                            CopyEngine.positions[mint].sellIndices.push(i);
                            const sold = await CopyEngine.sell(mint, c.sellPercentage, `${c.triggerValue > 0 ? 'TP' : 'SL'} ${i}`, priceSol);
                            if (sold) {
                                soldAlready = true;
                                break;
                            }
                            else {
                                CopyEngine.positions[mint].sellIndices = CopyEngine.positions[mint].sellIndices.filter(x => x != i);
                            }
                        }
                    }
                }


                if ((!soldAlready) && CopyEngine.pdFlag) {
                    const drop = CopyEngine.positions[mint].peakPnL - CopyEngine.positions[mint].pnL;
                    for (let i = 0; i < Site.CP_PEAK_DROP_CONFIG.length; i++) {
                        if (CopyEngine.positions[mint].PDIndices.includes(i)) {
                            continue;
                        }
                        const c = Site.CP_PEAK_DROP_CONFIG[i];

                        if (
                            (drop >= c.minDropPerc) &&
                            (CopyEngine.positions[mint].pnL >= c.minPnLPerc) &&
                            (CopyEngine.positions[mint].pnL <= c.maxPnLPerc)
                        ) {
                            CopyEngine.positions[mint].PDIndices.push(i);
                            const sold = await CopyEngine.sell(mint, c.sellPerc, `PD ${i}`, priceSol);
                            if (sold) {
                                soldAlready = true;
                                break;
                            }
                            else {
                                CopyEngine.positions[mint].PDIndices = CopyEngine.positions[mint].PDIndices.filter(x => x != i);
                            }
                        }
                    }
                }
            }
        }
    }

    static sell = async (mint: string, amountPerc: number, reason: string, priceSol: number = 0) => {
        if (!CopyEngine.positions[mint]) {
            return false;
        }
        else {
            priceSol = priceSol || CopyEngine.positions[mint].currentPrice || 0;
            if (CopyEngine.isLive) {
                // We are selling in live mode
                const signature = await CopyEngine.trade("sell", mint, `${amountPerc}%`);
                if (signature) {
                    CopyEngine.waitingSigns[signature] = {
                        isBuy: false,
                        ts: Date.now(),
                    };
                    CopyEngine.cleanUpOldSignatures();
                    CopyEngine.positions[mint].sellReasons.push(reason);
                    return true;
                }
                else {
                    return false;
                }
            }
            else {
                if (amountPerc && priceSol && CopyEngine.positions[mint].amountHeld > 0) {
                    const amountToSell = (amountPerc / 100) * CopyEngine.positions[mint].amountHeld;
                    const solValue = amountToSell * priceSol;
                    const latency = 0;
                    CopyEngine.positions[mint].amountHeld -= amountToSell;
                    CopyEngine.positions[mint].lastSellTS = Date.now();
                    CopyEngine.positions[mint].sellReasons.push(reason);
                    CopyEngine.positions[mint].sellLatenciesMS.push(latency);
                    CopyEngine.positions[mint].solGotten += solValue;

                    if (CopyEngine.alertFlag) {
                        let m = `✅ *Sell*\n\n`;
                        m += `Amount 🟰 \`${amountPerc}%\`\n`;
                        m += `Returns 🟰 \`SOL ${FFF(solValue)}\`\n`;
                        m += `Price 🟰 \`SOL ${FFF(priceSol)}\`\n`;
                        m += `MarketCap 🟰 \`SOL ${FFF(CopyEngine.positions[mint].currentMarketCap)}\`\n`;
                        if (latency) {
                            m += `Latency 🟰 \`${formatNumber(latency)}ms\`\n`;
                        }
                        m += `Mint 🟰 \`${mint}\`\n`;
                        m += `Pool 🟰 \`${CopyEngine.positions[mint].pool}\`\n`;
                        m += `Signature 🟰 \`simulation_${Date.now()}\`\n`;

                        (await TelegramEngine()).sendMessage(m);
                    }

                    CopyEngine.cleanUpPositionAfterSell(mint);

                    return true;
                }
                else {
                    return false;
                }
            }
        }
    }

    /**
     * This ranks the wallets we have earned more from when we copied them
     */
    private static topEarnedFrom: CopyStat[] = [];

    static getRanking = () => CopyEngine.topEarnedFrom;

    /**
     * This checks if amount held is almost equal to amouht bought so we know when we have sold all our holdings
     * So as to discard the position and call on recovery
     */
    private static cleanUpPositionAfterSell = async (mint: string) => {
        if (CopyEngine.positions[mint]) {
            // Position exists
            const amountHeldPerc = Math.round((CopyEngine.positions[mint].amountHeld / CopyEngine.positions[mint].buyAmount) * 100);
            if (amountHeldPerc < 2) {
                // we have sold enough to close the position
                // lets do analytics
                let pnl = CopyEngine.positions[mint].pnL;
                let pnlPeak = CopyEngine.positions[mint].peakPnL;
                let pnlLeast = CopyEngine.positions[mint].leastPnL;
                let timesSold = CopyEngine.positions[mint].sellReasons.length;
                let tradeDurationMs = CopyEngine.positions[mint].lastSellTS - CopyEngine.positions[mint].buyTime;
                let buyLatency = CopyEngine.positions[mint].buyLatencyMS;
                let avgSellLatency = Math.round(CopyEngine.positions[mint].sellLatenciesMS.reduce((a, b) => a + b, 0) / CopyEngine.positions[mint].sellLatenciesMS.length);
                let copiedFrom = CopyEngine.positions[mint].copiedFrom;
                const returns = CopyEngine.positions[mint].solGotten - CopyEngine.positions[mint].buyCapital;
                const peakReturns = (CopyEngine.positions[mint].peakPnL / 100) * CopyEngine.positions[mint].buyCapital;
                const sellReason = CopyEngine.positions[mint].sellReasons.join(", ");
                const mc = CopyEngine.positions[mint].currentMarketCap;
                const pr = CopyEngine.positions[mint].currentPrice;
                const pool = CopyEngine.positions[mint].pool;

                // BEGIN RANKING
                // Get current rank, if any
                const currentPosition = CopyEngine.topEarnedFrom.find(e => e.address == CopyEngine.positions[mint].copiedFrom);
                // create stats object
                const pnlUse = Site.CP_EARN_RANKING_BY_PEAK_PNL ? peakReturns : returns;
                const rankStat: CopyStat = {
                    address: CopyEngine.positions[mint].copiedFrom,
                    pnl: currentPosition ? (currentPosition.pnl + pnlUse) : pnlUse,
                    positions: currentPosition ? (currentPosition.positions + 1) : 1,
                    wins: (currentPosition?.wins || 0) + (returns > 0 ? 1 : 0),
                    loses: (currentPosition?.loses || 0) + (returns < 0 ? 1 : 0),
                    winPnL: (currentPosition?.winPnL || 0) + (returns > 0 ? pnlUse : 0),
                    losePnL: (currentPosition?.losePnL || 0) + (returns < 0 ? returns : 0),
                }
                // insert stats object
                if (rankStat.pnl >= 0) {
                    if (currentPosition) {
                        const index = CopyEngine.topEarnedFrom.findIndex(x => x.address == rankStat.address);
                        if (index >= 0) {
                            CopyEngine.topEarnedFrom.splice(index, 1);
                        }
                    }
                    let insertIndex = -1;
                    for (let i = 0; i < CopyEngine.topEarnedFrom.length; i++) {
                        if (CopyEngine.topEarnedFrom[i].pnl < rankStat.pnl) {
                            insertIndex = i;
                            break;
                        }
                    }
                    if (insertIndex >= 0) {
                        CopyEngine.topEarnedFrom.splice(insertIndex, 0, rankStat);
                    }
                    else {
                        CopyEngine.topEarnedFrom.push(rankStat);
                    }
                    // trim ranking
                    if (CopyEngine.topEarnedFrom.length > Site.CP_EARN_RANKING_MAX) {
                        const delCount = CopyEngine.topEarnedFrom.length - Site.CP_EARN_RANKING_MAX;
                        CopyEngine.topEarnedFrom.splice(Site.CP_EARN_RANKING_MAX, delCount);
                    }
                }
                // END RANKING

                CopyEngine.deletePosition(mint);

                CopyEngine.totalRealizedPnLSOL += returns;

                if (CopyEngine.alertFlag) {
                    let m = `✅ *Close Position*\n\n`;
                    m += `PnL 🟰 \`SOL ${FFF(returns)} (${FFF(pnl)}%)\`\n`;
                    m += `Least n Peak PnL 🟰 \`${FFF(pnlLeast)}% ${FFF(pnlPeak)}%\`\n`;
                    m += `Sells 🟰 \`${timesSold} (${sellReason})\`\n`;
                    m += `Duration 🟰 \`${getTimeElapsed(0, tradeDurationMs)}\`\n`;
                    m += `AVG Buy n Sell Latencies  🟰 \`${FFF(buyLatency)}ms ${FFF(avgSellLatency)}ms\`\n`;
                    m += `Mint 🟰 \`${mint}\`\n`;
                    m += `Pool 🟰 \`${pool}\`\n`;
                    m += `Current Price 🟰 \`SOL ${FFF(pr)}\`\n`;
                    m += `Current MarketCap 🟰 \`SOL ${FFF(mc)}\`\n`;
                    m += `Copied From 🟰 \`${copiedFrom}\`\n`;

                    (await TelegramEngine()).sendMessage(m);
                }


                CopyEngine.recovery();
            }
        }
    }

    private static getOwnTokenAccounts = () => {
        return new Promise<{
            pubKey: PublicKey;
            balance: number;
            mint: string;
        }[]>(async (resolve, reject) => {
            try {
                const tokenAccounts = await (await SourceEngine()).getConnection().getParsedTokenAccountsByOwner(Site.KEYPAIR.publicKey, { programId: new PublicKey(TOKEN_PROGRAM_ID) });
                if (tokenAccounts.value.length == 0) {
                    resolve([]);
                }
                else {
                    const r = tokenAccounts.value.map(x => ({ pubKey: new PublicKey(x.pubkey), balance: parseFloat(x.account.data.parsed.info.tokenAmount.uiAmount || '0'), mint: x.account.data.parsed.info.mint as string }));
                    resolve(r);
                }
            } catch (error) {
                Log.dev(error);
                resolve([]);
            }
        })
    }

    private static closeEmptyTokenAccounts = (keys: PublicKey[]) => new Promise<boolean>(async (resolve, reject) => {
        try {
            const tx = new Transaction();
            for (const key of keys) {
                tx.add({
                    keys: [
                        {
                            pubkey: key, isSigner: false, isWritable: true,
                        },
                        {
                            pubkey: Site.KEYPAIR.publicKey, isSigner: false, isWritable: true,
                        },
                        {
                            pubkey: Site.KEYPAIR.publicKey, isSigner: true, isWritable: false,
                        }
                    ],
                    programId: new PublicKey(TOKEN_PROGRAM_ID),
                    data: Buffer.from([9])
                });
            }
            tx.feePayer = Site.KEYPAIR.publicKey;
            tx.recentBlockhash = (await (await SourceEngine()).getConnection().getLatestBlockhash()).blockhash;
            tx.sign(Site.KEYPAIR);
            const signature = await (await SourceEngine()).getConnection().sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: "confirmed"
            });
            resolve(true);
        } catch (error) {
            Log.dev(error);
            resolve(false);
        }
    });

    /**
     * This closes empty token accounts so we recover rent
     */
    static recovery = async () => new Promise<boolean>(async (resolve, reject) => {
        const emptyTokenAccounts = (await CopyEngine.getOwnTokenAccounts()).filter(acc => acc.balance == 0);
        if (emptyTokenAccounts.length > 0) {
            resolve(await CopyEngine.closeEmptyTokenAccounts(emptyTokenAccounts.map(x => x.pubKey)));
        }
        else {
            resolve(true);
        }
    });

    private static buy = async (trader: string, mint: string, amountSol: number, priceSol: number, marketCapSol: number, pool: string) => {
        if (CopyEngine.positions[mint]) {
            return false;
        }
        else {
            CopyEngine.positions[mint] = {
                buyAmount: 0,
                amountHeld: 0,
                buyCapital: amountSol,
                buyPrice: priceSol,
                buyTime: Date.now(),
                confirmed: false,
                copiedFrom: trader,
                buyLatencyMS: 0,
                sellLatenciesMS: [],
                currentPrice: priceSol,
                lastUpdated: Date.now(),
                leastPnL: 0,
                peakPnL: 0,
                pnL: 0,
                solGotten: 0,
                sellIndices: [],
                PDIndices: [],
                sellReasons: [],
                lastSellTS: Date.now(),
                currentMarketCap: 0,
                pool: 'unknown',
            };
            CopyEngine.totalOpenedPositions++;
            priceSol = priceSol || CopyEngine.positions[mint].currentPrice || 0;
            if (CopyEngine.isLive) {
                // We are buying in live mode
                const signature = await CopyEngine.trade("buy", mint, amountSol);
                if (signature) {
                    CopyEngine.waitingSigns[signature] = {
                        isBuy: true,
                        ts: Date.now(),
                    };
                    CopyEngine.cleanUpOldSignatures();

                    return true;
                }
                else {
                    return false;
                }
            }
            else {
                if (priceSol && amountSol) {
                    // We are buying in simulation mode
                    // tok 1 = sol price
                    // tok x = sol amount
                    CopyEngine.positions[mint].buyAmount = amountSol / priceSol;
                    CopyEngine.positions[mint].amountHeld = CopyEngine.positions[mint].buyAmount;
                    CopyEngine.positions[mint].confirmed = true;
                    CopyEngine.positions[mint].buyLatencyMS = 0;

                    if (CopyEngine.alertFlag) {
                        let m = `✅ *Buy*\n\n`;
                        m += `Capital 🟰 \`SOL ${FFF(CopyEngine.positions[mint].buyCapital)}\`\n`;
                        m += `Amount 🟰 \`${FFF(CopyEngine.positions[mint].buyAmount)}\`\n`;
                        m += `Price 🟰 \`SOL ${FFF(priceSol)}\`\n`;
                        m += `MarketCap 🟰 \`SOL ${FFF(marketCapSol)}\`\n`;
                        if (CopyEngine.positions[mint].buyLatencyMS) {
                            m += `Latency 🟰 \`${formatNumber(CopyEngine.positions[mint].buyLatencyMS)}ms\`\n`;
                        }
                        m += `Mint 🟰 \`${mint}\`\n`;
                        m += `Pool 🟰 \`${pool}\`\n`;
                        m += `Copied From 🟰 \`${trader}\`\n`;
                        m += `Signature 🟰 \`simulation_${Date.now()}\`\n`;

                        (await TelegramEngine()).sendMessage(m);
                    }


                    return true;
                }
                else {
                    return false;
                }
            }
        }
    }

    private static cleanUpOldSignatures = (duration: number = 600_000 /* Default timeout 10 minutes */) => {
        Object.entries(CopyEngine.waitingSigns).map(([sign, obj]) => ({ ...obj, sign })).filter(x => (Date.now() - x.ts) >= duration).map(x => x.sign).forEach(sign => {
            delete CopyEngine.waitingSigns[sign];
        });
    }

    private static getAndSignTx = (
        action: 'buy' | 'sell',
        mint: string,
        amount: number | string,
    ) => new Promise<VersionedTransaction | null>(async (resolve, reject) => {
        try {
            const body = {
                action,
                publicKey: Site.KEYPAIR.publicKey.toString(),
                mint,
                amount: amount,
                denominatedInSol: action === "buy" ? "true" : "false",
                slippage: action === "buy" ? Site.CP_BUY_SLIPPAGE_PERC : Site.CP_SELL_SLIPPAGE_PERC,
                pool: 'auto',
                priorityFee: 0,
            }
            const response = await fetch('https://pumpportal.fun/api/trade-local', {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            if (response.status === 200) {
                const data = await response.arrayBuffer();
                const tx = VersionedTransaction.deserialize(new Uint8Array(data));
                tx.sign([Site.KEYPAIR]);
                resolve(tx);
            }
            else {
                Log.dev(`Getting transaction failed with error: `, response.statusText);
                resolve(null);
            }
        } catch (error) {
            Log.dev(error);
            resolve(null);
        }
    });

    private static sendTx = (tx: VersionedTransaction) => new Promise<string | null>(async (resolve, reject) => {
        try {
            const signature = await (await SourceEngine()).getConnection().sendTransaction(tx, {
                skipPreflight: Site.CP_SKIP_PREFLIGHT,
            });
            resolve(signature);
        } catch (error) {
            Log.dev(error);
            resolve(null);
        }
    });

    private static trade = async (
        action: 'buy' | 'sell',
        mint: string,
        amount: number | string,

    ) => {
        const tx = await CopyEngine.getAndSignTx(action, mint, amount);
        if (tx) {
            const sign = await CopyEngine.sendTx(tx);
            if (sign) {
                if (CopyEngine.alertFlag) {
                    let m = `✅ *Transaction*\n\n`;
                    m += `Action 🟰 \`${action == "buy" ? 'Buy' : 'Sell'}\`\n`;
                    m += `Amount 🟰 \`${amount}\`\n`;
                    m += `Mint 🟰 \`${mint}\`\n`;
                    m += `Signature 🟰 \`${sign}\`\n`;
                    (await TelegramEngine()).sendMessage(m);
                }


                if (CopyEngine.positions[mint]) {
                    // Reflect fees in PnL
                    CopyEngine.positions[mint].solGotten -= Site.CP_FEES_PER_TRADE_SOL;
                }

            }
            return sign;
        }
        return null;
    }
}