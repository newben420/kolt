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

    private static sub = (topic: string, callback: (data: any) => void, force = false): Subscription | null => {
        if (!PumpswapEngine.nc) return null;

        if (PumpswapEngine.subscriptions.has(topic) && !force) {
            Log.flow([SLUG, `Subscribe`, `Already subscribed: ${topic}.`], WEIGHT);
            return null;
        }

        const s = PumpswapEngine.nc.subscribe(topic);
        PumpswapEngine.subscriptions.set(topic, { sub: s, callback });

        (async () => {
            for await (const msg of s) {
                const decoded = PumpswapEngine.decode.decode(msg.data);
                try {
                    const json = JSON.parse(JSON.parse(decoded));
                    if (json.data && json.data.user && (PumpswapEngine.traders.includes(json.data.user as string) || (await TrackerEngine()).traderExists(json.data.user as string))) {
                        if (json.name && ["buyevent", "sellevent"].includes(json.name.toLowerCase())) {
                            const data = PumpswapEngine.parseMessage(json.data);
                            json.data = data;

                            if (json.index) json.index = parseHexFloat(json.index) || 0;
                            if (json.slot) json.slot = parseHexFloat(json.slot) || 0;
                            if (json.data.timestamp) json.data.timestamp *= 1000;
                            if (json.receivedAt && json.data.timestamp)
                                json.latency = Math.abs(json.receivedAt - json.data.timestamp);

                            const baseDec = 10 ** 6;
                            const quoteDec = 10 ** 9;
                            const baseRes = Number(json.data.poolBaseTokenReserves) / baseDec;
                            const quoteRes = Number(json.data.poolQuoteTokenReserves) / quoteDec;

                            json.data.priceSol = quoteRes / baseRes;

                            json.data.marketcapSol = json.data.priceSol * Site.PS_PF_TOTAL_SUPPLY / 10 ** 6;

                            const isBuy = (json.name || '').toLowerCase().includes('buy');
                            const ppOBJ: any = {
                                solAmount: (isBuy ? json.data.quoteAmountIn : json.data.quoteAmountOut) / quoteDec,
                                tokenAmount: (isBuy ? json.data.baseAmountOut : json.data.baseAmountIn) / baseDec,
                                traderPublicKey: json.data.user,
                                txType: isBuy ? 'buy' : 'sell',
                                signature: json.tx,
                                pool: "pump-amm",
                                newTokenBalance: isBuy ? json.data.userBaseTokenReserves : json.data.userQuoteTokenReserves,
                                priceSol: json.data.priceSol,
                                marketCapSol: json.data.marketcapSol,
                                latencyMS: json.latency
                            };

                            (await TrackerEngine()).newTrade(ppOBJ);
                            (await MainEngine()).newTrade(ppOBJ);
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

    private static connectorChecker = () => {
        if (PumpswapEngine.traders.length > 0) {
            PumpswapEngine.sub(`ammTradeEvent.>`, data => {
            });
        }
        else {
            PumpswapEngine.unsub(`ammTradeEvent.>`);
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
