import { PPOBJ } from './../model/ppobj';
import { formatNumber, FFF } from './../lib/format_number';
import { shortenAddress } from './../lib/shorten_address';
import { TrackedTraderAddress, TrackedTraderObject } from './../model/tracker';
import { getTimeElapsed } from './../lib/date_time';
import { Log } from './../lib/log';
import { Site } from './../site';

let cachedMainEngine: typeof import('./main').MainEngine | null = null;
const MainEngine = async () => {
    if (!cachedMainEngine) {
        cachedMainEngine = ((await import('./main'))).MainEngine;
    }
    return cachedMainEngine;
}

let cachedTelegramEngine: typeof import('./telegram').TelegramEngine | null = null;
const TelegramEngine = async () => {
    if (!cachedTelegramEngine) {
        cachedTelegramEngine = ((await import('./telegram'))).TelegramEngine;
    }
    return cachedTelegramEngine;
}

const SLUG = "TrackerEngine";
const WEIGHT = 3;

/**
 * This tracks trades made by addresses we are following and sends out live notifications whenever they carry out an action.
 * It can possibly be extended for copy trading
 * For now, it periodically fetches top N wallets from main engine.
 * It merges them, while keeping a maximum number to eliminate old ones... also, inactive wallets are removed as well.
 * Only manually added addresses by the user are spared from garbage collection
 * 
 * From the telegram interface, the user should be able to delete addresses added here.
 */
export class TrackerEngine {
    static start = () => new Promise<boolean>((resolve, reject) => {
        TrackerEngine.run();
        resolve(true);
    });

    private static runTOO: null | NodeJS.Timeout = null;

    private static traders: TrackedTraderObject = {};

    static traderExists = (address: string) => !!TrackerEngine.traders[address];
    static getTrader = (address: string) => TrackerEngine.traders[address];

    static removedTradersCount: number = 0;

    static addTrader = (address: TrackedTraderAddress, manual: boolean, { pnl, rpnl, upnl }: {
        pnl?: number;
        upnl?: number;
        rpnl?: number;
    } = {}) => {
        const now = Date.now();
        if (!TrackerEngine.traders[address]) {
            if ((!manual) && Object.keys(TrackerEngine.traders).map(addr => TrackerEngine.traders[addr].manuallyAdded).filter(man => !man).length >= Site.TR_MAX_TRADERS) {
                return false;
            }
            else {
                TrackerEngine.traders[address] = {
                    buys: 0,
                    sells: 0,
                    buysSol: 0,
                    sellsSol: 0,
                    lastUpdated: now,
                    timeAdded: now,
                    manuallyAdded: manual,
                    rpnl,
                    upnl,
                    pnl,
                    showAlert: Site.TR_SEND_ACTIVITY,
                };
                return true;
            }
        }
        else {
            TrackerEngine.traders[address].lastUpdated = now;
            if (pnl) TrackerEngine.traders[address].pnl = pnl;
            if (rpnl) TrackerEngine.traders[address].rpnl = rpnl;
            if (upnl) TrackerEngine.traders[address].upnl = upnl;
            return false;
        }
        return true;
    }

    static getAddressStartsWith = (pre: string) => Object.keys(TrackerEngine.traders).find(addr => addr.startsWith(pre)) || null;

    static getTradersArray = () => Object.entries(TrackerEngine.traders).map(([address, trader]) => ({ ...trader, address })).sort((a, b) => a.timeAdded - b.timeAdded);


    static getTopTradersCount = () => Object.entries(TrackerEngine.traders).map(([address, trader]) => trader).filter(tr => !tr.manuallyAdded).length;
    static getManualTradersCount = () => Object.entries(TrackerEngine.traders).map(([address, trader]) => trader).filter(tr => tr.manuallyAdded).length;


    static newTrade = async ({
        solAmount,
        tokenAmount,
        traderPublicKey,
        txType,
        pool,
        priceSol,
        signature,
        marketCapSol,
        latencyMS,
        mint,
        poolAddress,
    }: PPOBJ) => {
        if (TrackerEngine.traderExists(traderPublicKey)) {
            const trader = TrackerEngine.getTrader(traderPublicKey);
            trader.lastUpdated = Date.now();
            if (txType == "buy") {
                trader.buys += 1;
                trader.buysSol += solAmount;
            }
            if (txType == "sell") {
                trader.sells += 1;
                trader.sellsSol += solAmount;
            }

            if (trader.showAlert) {
                let m = `${txType == 'buy' ? `🟩` : `🟥`} *${shortenAddress(traderPublicKey)}* ${txType == 'buy' ? `bought with` : `sold for`} SOL${FFF(solAmount)} at ${FFF(priceSol)}\n\n`;
                m += `Buys ➡️ \`${formatNumber(trader.buys)}\` \\(SOL${FFF(trader.buysSol)}\\) 🔄 Sells ⬅️ \`${trader.sells}\` \\(SOL${FFF(trader.sellsSol)}\\)\n`;
                m += `Active since 🕝 \`${getTimeElapsed(trader.timeAdded, Date.now())}\`\n`;
                m += `Mint 📍 \`${mint}\`\n`;
                m += `Trader 👤 \`${traderPublicKey}\`\n`;
                // m += `Signature 📝 \`${signature}\`\n`;
                m += `MarketcapSOL 📊 \`${FFF(marketCapSol)}\`\n`;
                m += `Token Amount 🪙 \`${FFF(tokenAmount)}\`\n`;
                const stats = (await MainEngine()).getTraderStats(traderPublicKey);
                if (stats) {
                    if ((stats.totalPnL || stats.unrealizedPnL || stats.realizedPnL) || (trader.pnl || trader.rpnl || trader.upnl)) m += `PnL \`${FFF((stats.totalPnL || trader.pnl || 0) * 100)}%\` 💰U \`${FFF((stats.unrealizedPnL || trader.upnl || 0) * 100)}%\` 💰R \`${FFF((stats.realizedPnL || trader.rpnl || 0) * 100)}%\`\n`;
                }
                (await TelegramEngine()).sendMessage(m, undefined, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🗑 Message",
                                    callback_data: 'deletemessage',
                                }
                            ]
                        ]
                    }
                }, undefined);
            }
        }
    }

    static removeTrader = (address: TrackedTraderAddress) => {
        if (TrackerEngine.traders[address]) {
            delete TrackerEngine.traders[address];
            TrackerEngine.removedTradersCount += 1;
            return true;
        }
        else {
            return false;
        }
    }

    private static run = async () => {
        const start = Date.now();
        const conclude = () => {
            Log.flow([SLUG, `Iteration`, `Concluded.`], WEIGHT);
            const stop = Date.now();
            const duration = stop - start;
            if (duration >= Site.TR_INTERVAL_MS) {
                TrackerEngine.run();
            }
            else {
                const remaining = Site.TR_INTERVAL_MS - duration;
                TrackerEngine.runTOO = setTimeout(() => {
                    TrackerEngine.run();
                }, remaining);
                Log.flow([SLUG, `Next iteration scheduled to begin in ${getTimeElapsed(0, remaining)}.`], WEIGHT);
            }
        }
        Log.flow([SLUG, `Iteration`, `Initialized.`], WEIGHT);

        // Adding Top Traders
        const addedTraders = (await MainEngine()).getTopTraders(Site.TR_MAX_TRADERS).map(tr => ({
            ...tr,
            added: TrackerEngine.addTrader(tr.address, false, {
                pnl: tr.totalPnL,
                rpnl: tr.realizedPnL,
                upnl: tr.unrealizedPnL,
            }),
        })).filter(tr => tr.added);

        if (addedTraders.length > 0) {
            Log.flow([SLUG, `Iteration`, `Added top traders (count: ${addedTraders.length}).`], WEIGHT);
            if (Site.TR_SEND_AUTO_ADD) {
                const l = addedTraders.length;
                let m = `✅ *Added ${l} Top Trader${l == 1 ? '' : 's'}*\n\n`
                m += `\`\`\`\n${addedTraders.map((tr, i) => `${(i + 1)}. ${shortenAddress(tr.address)} (${FFF(tr.totalPnL * 100)}%)`).join('\n')}\`\`\``;
                (await TelegramEngine()).sendMessage(m);
            }
        }

        // Removing Traders (Garbage Collection)
        const walletsRemoved = Object.keys(TrackerEngine.traders).
            map(addr => ({ ...TrackerEngine.traders[addr], addr })).
            filter(tr => !tr.manuallyAdded).
            filter(tr => (Date.now() - (tr.lastUpdated || 0)) >= Site.TR_INACTIVITY_TIMEOUT_MS).
            map(tr => ({ ...tr, removed: TrackerEngine.removeTrader(tr.addr) })).
            filter(tr => tr.removed);

        if (walletsRemoved.length > 0) {
            const l = walletsRemoved.length;
            Log.flow([SLUG, `Iteration`, `Removed traders (count: ${l}).`], WEIGHT);
            if (Site.TR_SEND_AUTO_REM) {
                let m = `❌ *Removed ${l} Top Trader${l == 1 ? '' : 's'}*\n\n`
                m += `\`\`\`\n${walletsRemoved.map((tr, i) => `${(i + 1)}. ${shortenAddress(tr.addr)} (${getTimeElapsed(tr.lastUpdated, Date.now())})`).join('\n')}\`\`\``;
                (await TelegramEngine()).sendMessage(m);
            }

        }
        conclude();
    }
}