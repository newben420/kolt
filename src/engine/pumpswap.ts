import { PPOBJ } from './../model/ppobj';
import { Site } from "./../site";
import { connect, NatsConnection, StringCodec, Subscription } from "nats.ws";
import { Log } from "./../lib/log";
import { parseHexFloat } from "../lib/parse_hex_float";
import axios from "axios";
import { getTimeElapsed } from "../lib/date_time";

let cachedMainEngine: typeof import('./main').MainEngine | null = null;
const MainEngine = async () => {
    if (!cachedMainEngine) {
        cachedMainEngine = ((await import('./main'))).MainEngine;
    }
    return cachedMainEngine;
}

let cachedTrackerEngine: typeof import('./tracker').TrackerEngine | null = null;
const TrackerEngine = async () => {
    if (!cachedTrackerEngine) {
        cachedTrackerEngine = ((await import('./tracker'))).TrackerEngine;
    }
    return cachedTrackerEngine;
}

const MAX_RETRIES = Site.PS_MAX_RECON_RETRIES;
let RETRIES = 0;
const RETRY_INTERVAL = Site.PS_RETRIES_INTERVAL_MS;

interface Metadata {
    pool: string;
    baseDec: number;
    quoteDec: number;
    lpSupply: number;
    totalSupply: number;
    liquidUSD: number;
}

interface SubscriptionEntry {
    sub: Subscription;
    callback: (data: any) => void;
}

const SLUG = "PumpSwapEng";
const WEIGHT = 3;

export default class PumpswapEngine {
    private static username: string = Site.PS_DEFAULT_DETAILS.username;
    private static password: string = Site.PS_DEFAULT_DETAILS.password;
    private static server: string = Site.PS_DEFAULT_DETAILS.server;
    private static nc: NatsConnection | null = null;
    private static subscriptions: Map<string, SubscriptionEntry> = new Map();
    // private static metadata: Map<string, Metadata> = new Map();
    // private static mintPoolPairs: string[] = [];
    private static decode = StringCodec();

    private static connect = async (): Promise<boolean> => {
        try {
            Log.flow([SLUG, `Connect`, `initializing.`], WEIGHT);
            PumpswapEngine.nc = await connect({
                servers: PumpswapEngine.server,
                user: PumpswapEngine.username,
                pass: PumpswapEngine.password,
            });
            Log.flow([SLUG, `Connect`, `Connected to server.`], WEIGHT);
            RETRIES = 0;

            PumpswapEngine.nc.closed().then(async (err) => {
                if (err) {
                    Log.dev(err);
                    Log.flow([SLUG, `Connect`, `Connection closed with error${err.message ? `: ${err.message}` : ``}.`], WEIGHT);
                    if (Site.PS_RECONNECT_TIMEOUT_MS && RETRIES <= MAX_RETRIES) {
                        setTimeout(async () => {
                            if (await PumpswapEngine.updateCredentials(true)) {
                                await PumpswapEngine.disconnect();
                                if (await PumpswapEngine.connect()) {
                                    for (const [topic, { callback }] of PumpswapEngine.subscriptions) {
                                        const existing = PumpswapEngine.subscriptions.get(topic);
                                        existing?.sub.unsubscribe();
                                        const s = PumpswapEngine.sub(topic, callback, true);
                                        if (s) {
                                            PumpswapEngine.subscriptions.set(topic, { sub: s, callback });
                                        }
                                    }
                                } else {
                                    RETRIES++;
                                }
                            }
                        }, Site.PS_RECONNECT_TIMEOUT_MS);
                    }
                } else {
                    Log.flow([SLUG, `Connect`, `Connection closed normally.`], WEIGHT);
                }
            });
            return true;
        } catch (error) {
            Log.flow([SLUG, `Connect`, `An error was encountered.`], WEIGHT);
            Log.dev(error);
            return false;
        }
    };

    private static disconnect = async (): Promise<boolean> => {
        if (PumpswapEngine.nc) {
            await PumpswapEngine.nc.close();
            Log.flow([SLUG, `Connect`, `Disconnected from server.`], WEIGHT);
        }
        return true;
    };

    private static parseMessage = (d: Record<string, any>): Record<string, any> => {
        const floatFields = [
            "timestamp", "baseAmountOut", "baseAmountIn", "maxQuoteAmountIn",
            "minQuoteAmountOut", "userBaseTokenReserves", "userQuoteTokenReserves",
            "poolBaseTokenReserves", "poolQuoteTokenReserves", "quoteAmountIn",
            "quoteAmountOut", "lpFeeBasisPoints", "lpFee", "protocolFeeBasisPoints",
            "protocolFee", "quoteAmountInWithLpFee", "quoteAmountOutWithoutLpFee",
            "userQuoteAmountIn", "userQuoteAmountOut", "coinCreatorFeeBasisPoints", "coinCreatorFee"
        ];

        const o: Record<string, number> = {};
        for (const key of floatFields) {
            if (d[key] !== undefined) {
                o[key] = parseHexFloat(d[key]) || 0;
                delete d[key];
            }
        }
        return { ...d, ...o };
    };

    private static newParseMessage = (d: Record<string, any>): Record<string, any> => {
        const floatFields = [
            // common
            "marketCap",
            "baseAmount",
            "quoteAmount",
            "protocolFee",
            "protocolFeeUsd",
            "priceBasePerQuote",
            "priceQuotePerBase",
            "priceUsd",
            "priceSol",
            "amountSol",
            "amountUsd",
            "creatorFee",
            "creatorFeeUsd",
            "baseReserves",
            "quoteReserves",
            "solPriceUsd",
            // pump extra
            "virtualSolReserves",
            "virtualTokenReserves",
            // amm extra
            "lpFee",
            "lpFeeUsd",
        ];

        const o: Record<string, number> = {};
        for (const key of floatFields) {
            if (d[key] !== undefined) {
                o[key] = parseFloat(d[key]) || 0;
                delete d[key];
            }
        }
        return { ...d, ...o };
    };

    static recentLatencies: number[] = [];

    private static sub = (topic: string, callback: (data: PPOBJ) => void, force = false): Subscription | null => {
        if (!PumpswapEngine.nc) return null;

        if (PumpswapEngine.subscriptions.has(topic) && !force) {
            // Log.flow([SLUG, `Subscribe`, `Already subscribed: ${topic}.`], WEIGHT);
            return null;
        }

        const s = PumpswapEngine.nc.subscribe(topic);
        PumpswapEngine.subscriptions.set(topic, { sub: s, callback });

        (async () => {
            for await (const msg of s) {
                const decoded = PumpswapEngine.decode.decode(msg.data);
                try {
                    const json = JSON.parse(JSON.parse(decoded));
                    PumpswapEngine.messageCount += 1;
                    if (json.userAddress && (PumpswapEngine.traders.includes(json.userAddress as string) || (await TrackerEngine()).traderExists(json.userAddress as string))) {
                        PumpswapEngine.validMessageCount += 1;
                        if (json.type && ["buy", "sell"].includes(json.type.toLowerCase())) {
                            const data = PumpswapEngine.newParseMessage(json);
                            if(data.timestamp){
                                try {
                                    data.timestamp = (new Date(data.timestamp)).getTime();
                                    data.latency = Date.now() - data.timestamp;
                                } catch (error) {
                                    data.timestamp = Date.now();
                                    data.latency = 0;
                                }
                            }

                            data.marketcapSol = (data.marketCap / data.solPriceUsd) || data.marketCap || 0;

                            const ppOBJ: PPOBJ = {
                                solAmount: data.quoteAmount,
                                tokenAmount: data.baseAmount,
                                traderPublicKey: data.userAddress,
                                txType: (data.type as string).toLowerCase() as "buy" | "sell",
                                signature: data.tx,
                                pool: data.program,
                                priceSol: data.priceSol,
                                marketCapSol: data.marketcapSol,
                                latencyMS: data.latency,
                                mint: data.mintAddress,
                                poolAddress: data.poolAddress,
                            };

                            (await TrackerEngine()).newTrade(ppOBJ);
                            (await MainEngine()).newTrade(ppOBJ);

                            PumpswapEngine.recentLatencies.push(ppOBJ.latencyMS);

                            const MAX_LAT_LENGTH = 10;
                            if (PumpswapEngine.recentLatencies.length > MAX_LAT_LENGTH) {
                                PumpswapEngine.recentLatencies = PumpswapEngine.recentLatencies.slice(PumpswapEngine.recentLatencies.length - MAX_LAT_LENGTH);
                            }
                            callback(ppOBJ);
                        } else {
                            Log.dev("Unknown event message");
                            Log.dev(json);
                        }
                    }
                } catch (error) {
                    Log.dev(error);
                }
            }
        })();

        Log.flow([SLUG, `Subscribe`, `${topic}.`], WEIGHT);
        return s;
    };

    private static unsub = (topic: string): void => {
        const s = PumpswapEngine.subscriptions.get(topic);
        if (s) {
            s.sub.unsubscribe();
            PumpswapEngine.subscriptions.delete(topic);
            Log.flow([SLUG, `Unsubscribe`, `${topic}.`], WEIGHT);
        }
    };

    private static updateCredentials = async (force = false): Promise<boolean> => {
        const BASE = "https://swap.pump.fun";
        try {
            Log.flow([SLUG, ` Update Credentials`, `initialized.`], WEIGHT);
            if (PumpswapEngine.server && PumpswapEngine.username && PumpswapEngine.password && !force) {
                Log.flow([SLUG, ` Update Credentials`, `Using predefined credentials.`], WEIGHT);
                return true;
            }

            Log.flow([SLUG, ` Update Credentials`, `Fetching remote credentials.`], WEIGHT);
            const html = await (await fetch(BASE)).text();
            const chunkRegex = /\/_next\/static\/chunks\/[a-zA-Z0-9-]+\.js[^"']*/g;
            const chunks = [...html.matchAll(chunkRegex)].map(m => m[0]);
            let r: [boolean, string, string, string] = [false, '', '', ''];

            for (const path of chunks) {
                const url = `${BASE}${path}`;
                const js = await (await fetch(url)).text();
                const match = js.match(/servers:\s*"(wss:\/\/[^"]+)",\s*user:\s*"([^"]+)",\s*pass:\s*"([^"]+)"/);
                if (match) {
                    const [, servers, user, pass] = match;
                    r = [true, servers, user, pass];
                    break;
                }
            }

            if (r[0]) {
                Log.flow([SLUG, ` Update Credentials`, `Found and updated credentials.`], WEIGHT);
                [PumpswapEngine.server, PumpswapEngine.username, PumpswapEngine.password] = [r[1], r[2], r[3]];
                return true;
            } else {
                Log.flow([SLUG, ` Update Credentials`, `Could not find credentials.`], WEIGHT);
                return false;
            }

        } catch (error) {
            Log.flow([SLUG, ` Update Credentials`, `An error was encountered.`], WEIGHT);
            Log.dev(error);
            return false;
        }
    };

    private static traders: string[] = [];

    static monitorTrader = (address: string): boolean => {
        Log.flow([SLUG, `MonitorTrader`, address], WEIGHT);
        if (!PumpswapEngine.traders.includes(address)) {
            PumpswapEngine.traders.push(address);
        }
        PumpswapEngine.connectorChecker();
        return true;
    };

    static subscribed: boolean = false;
    static messageCount: number = 0;
    static validMessageCount: number = 0;

    private static connectorChecker = () => {
        if (PumpswapEngine.traders.length > 0) {
            PumpswapEngine.sub(`unifiedTradeEvent.processed.>`, data => {
            });
            PumpswapEngine.subscribed = true;
        }
        else {
            PumpswapEngine.unsub(`unifiedTradeEvent.processed.>`);
            PumpswapEngine.subscribed = false;
        }
    }

    static unmonitorTrader = (address: string): boolean => {
        Log.flow([SLUG, `UnmonitorTrader`, address], WEIGHT);
        if (PumpswapEngine.traders.includes(address)) {
            PumpswapEngine.traders.splice(PumpswapEngine.traders.indexOf(address), 1);
        }
        PumpswapEngine.connectorChecker();
        return true;
    };

    static start = async (): Promise<boolean> => {
        if (!(await PumpswapEngine.updateCredentials())) return false;
        const connected = await PumpswapEngine.connect();
        return connected;
    };

    static stop = async (): Promise<boolean> => {
        await PumpswapEngine.disconnect();
        return true;
    };
}
