// PumpswapEngine.ts

import { Site } from "./../site";
import { connect, NatsConnection, StringCodec, Subscription } from "nats.ws";
import { Log } from "./../lib/log";
import { parseHexFloat } from "../lib/parse_hex_float";
import axios from "axios";
import { getTimeElapsed } from "../lib/date_time";

let TokenEngine: any = null;
let ObserverEngine: any = null;
let WhaleEngine: any = null;

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
    private static metadata: Map<string, Metadata> = new Map();
    private static mintPoolPairs: string[] = [];
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
                    if (json.name && json.data && ["buyevent", "sellevent"].includes(json.name.toLowerCase())) {
                        const data = PumpswapEngine.parseMessage(json.data);
                        json.data = data;

                        if (json.index) json.index = parseHexFloat(json.index) || 0;
                        if (json.slot) json.slot = parseHexFloat(json.slot) || 0;
                        if (json.data.timestamp) json.data.timestamp *= 1000;
                        if (json.receivedAt && json.data.timestamp)
                            json.latency = Math.abs(json.receivedAt - json.data.timestamp);

                        const meta = PumpswapEngine.metadata.get(json.data.pool);
                        if (meta) {
                            const baseDec = 10 ** meta.baseDec;
                            const quoteDec = 10 ** meta.quoteDec;
                            const baseRes = Number(json.data.poolBaseTokenReserves) / baseDec;
                            const quoteRes = Number(json.data.poolQuoteTokenReserves) / quoteDec;

                            json.data.priceSol = quoteRes / baseRes;
                            json.data.marketcapSol = json.data.priceSol * meta.totalSupply / 10 ** meta.baseDec;

                            const isBuy = (json.name || '').toLowerCase().includes('buy');
                            const ppOBJ: any = {
                                solAmount: (isBuy ? json.data.quoteAmountIn : json.data.quoteAmountOut) / quoteDec,
                                tokenAmount: (isBuy ? json.data.baseAmountOut : json.data.baseAmountIn) / baseDec,
                                traderPublicKey: json.data.user,
                                txType: isBuy ? 'buy' : 'sell',
                                signature: json.tx,
                                pool: "pump-amm",
                                newTokenBalance: isBuy ? json.data.userBaseTokenReserves : json.data.userQuoteTokenReserves,
                                marketCapSol: json.data.marketcapSol,
                                latencyMS: json.latency
                            };

                            const mint = (PumpswapEngine.mintPoolPairs.find(x => x.endsWith(`#${json.data.pool}#`)) || '')
                                .split("#")
                                .filter(x => x.length > 0)[0];
                            if (mint) ppOBJ.mint = mint;

                            if (!TokenEngine) TokenEngine = require("./token");
                            if (!ObserverEngine) ObserverEngine = require("../kiko/observer");
                            if (!WhaleEngine) WhaleEngine = require("./whale").WhaleEngine;

                            TokenEngine.newTrade(ppOBJ);
                            WhaleEngine.newTrade(ppOBJ);
                            callback(ppOBJ);
                        }
                    } else {
                        Log.dev("Unknown event message");
                        Log.dev(json);
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

    private static resolveMetadata = async (mint: string): Promise<Metadata | null> => {
        try {
            const [r, s] = (
                await Promise.all([
                    axios.get(`https://swap-api.pump.fun/v1/pools/pair?mintA=So11111111111111111111111111111111111111112&mintB=${mint}&sort=liquidity`),
                    axios.get(`https://frontend-api-v3.pump.fun/coins/${mint}`)
                ])
            ).map(x => x.data);

            if (Array.isArray(r) && r.length > 0 && r[0].address && r[0].lpSupply && r[0].liquidityUSD && s && s.total_supply) {
                return {
                    pool: r[0].address,
                    baseDec: parseInt(r[0].baseMintDecimals) || 0,
                    quoteDec: parseInt(r[0].quoteMintDecimals) || 0,
                    lpSupply: parseFloat(r[0].lpSupply) || 0,
                    totalSupply: parseFloat(s.total_supply) || Site.PS_PF_TOTAL_SUPPLY,
                    liquidUSD: parseFloat(r[0].liquidityUSD) || 0
                };
            }
            return null;
        } catch (error) {
            Log.dev(error);
            return null;
        }
    };

    static monitor = async (mint: string, callback: (data: any) => void = () => { }, retries = 0): Promise<boolean> => {
        Log.flow([SLUG, `Monitor`, mint, `${retries ? `Retry ${retries}` : `Initialized`}.`], WEIGHT);
        const meta = await PumpswapEngine.resolveMetadata(mint);

        const retry = () => {
            if (retries < MAX_RETRIES && MAX_RETRIES && RETRY_INTERVAL) {
                Log.flow([SLUG, `Monitor`, mint, `Failed. Attempting retry ${(retries + 1)} in ${getTimeElapsed(0, RETRY_INTERVAL)}.`], WEIGHT);
                setTimeout(() => PumpswapEngine.monitor(mint, callback, retries + 1), RETRY_INTERVAL);
            }
        };

        if (!meta) {
            Log.flow([SLUG, `Monitor`, mint, `Could not get metadata.`], WEIGHT);
            retry();
            return false;
        }

        const { pool } = meta;
        Log.flow([SLUG, `Monitor`, mint, `Pool obtained: ${pool}.`], WEIGHT);
        const pairKey = `${mint}#${pool}#`;

        if (PumpswapEngine.mintPoolPairs.includes(pairKey)) return false;

        const subbed = PumpswapEngine.sub(`ammTradeEvent.${pool}`, callback);
        if (subbed) {
            PumpswapEngine.mintPoolPairs.push(pairKey);
            PumpswapEngine.metadata.set(pool, meta);
            return true;
        }

        retry();
        return false;
    };

    static unmonitor = async (mint: string): Promise<boolean> => {
        Log.flow([SLUG, `Unmonitor`, mint, `Initialized.`], WEIGHT);
        const pairKey = PumpswapEngine.mintPoolPairs.find(x => x.startsWith(`${mint}#`));
        if (!pairKey) return false;

        const pool = pairKey.split("#").filter(x => x.length > 0)[1];
        if (!pool) {
            Log.flow([SLUG, `Unmonitor`, mint, `Data not found.`], WEIGHT);
            return false;
        }

        PumpswapEngine.unsub(`ammTradeEvent.${pool}`);
        PumpswapEngine.metadata.delete(pool);
        PumpswapEngine.mintPoolPairs = PumpswapEngine.mintPoolPairs.filter(x => !x.startsWith(`${mint}#`));
        return true;
    };

    static start = async (): Promise<boolean> => {
        if (!(await PumpswapEngine.updateCredentials())) return false;
        return await PumpswapEngine.connect();
    };

    static stop = async (): Promise<boolean> => {
        await PumpswapEngine.disconnect();
        return true;
    };
}
