import { config } from "dotenv";
import { Keypair } from "@solana/web3.js";
import { JSONSafeParse } from "./lib/json_safe_parse";
const args = process.argv.slice(2);
config({
    path: args[0] || ".env",
});

const keyArray = JSONSafeParse(process.env.PRIVATE_KEY ?? "[]", true);
const key = new Uint8Array(keyArray);
const keypair = Keypair.fromSecretKey(key);

export class Site {
    static TITLE: string = process.env["TITLE"] || "Dusty";
    static ROOT: string = process.cwd() || __dirname;
    static PORT: number = parseInt(process.env["PORT"] || "0") || 3000;
    static PRODUCTION = (process.env["PRODUCTION"] || "").toLowerCase() == "true";
    static FORCE_FAMILY_4 = (process.env["FORCE_FAMILY_4"] || "").toLowerCase() == "true";
    static EXIT_ON_UNCAUGHT_EXCEPTION = (process.env["EXIT_ON_UNCAUGHT_EXCEPTION"] || "").toLowerCase() == "true";
    static EXIT_ON_UNHANDLED_REJECTION = (process.env["EXIT_ON_UNHANDLED_REJECTION"] || "").toLowerCase() == "true";
    static URL = Site.PRODUCTION ? (process.env["PROD_URL"] || "") : `http://localhost:${Site.PORT}`;
    static MAX_ALLOWED_FLOG_LOG_WEIGHT: number = parseInt(process.env["MAX_ALLOWED_FLOG_LOG_WEIGHT"] || "0") || 5;

    static TG_TOKEN: string = process.env["TG_TOKEN"] ?? "";
    static TG_CHAT_ID: number = parseInt(process.env["TG_CHAT_ID"] ?? "0") || 0;
    static TG_POLLING: boolean = (process.env["TG_POLLING"] || "").toLowerCase() == "true";
    static TG_WH_SECRET_TOKEN: string = process.env["TG_WH_SECRET_TOKEN"] ?? "edqfwvrebwtn7f";
    static TG_BOT_URL: string = process.env["TG_BOT_URL"] ?? "";

    static WS_URL: string = process.env.WS_URL || "wss://pumpportal.fun/api/data";
    static WS_RECON_DELYAY_MS: number = parseInt(process.env.WS_RECON_DELYAY_MS || "0") || 5000;

    static RPC: string = process.env["RPC"] || "https://api.mainnet-beta.solana.com";
    static PF_API: string = process.env["PF_API"] || "https://frontend-api-v3.pump.fun";

    static MAX_TOP_HOLDERS: number = parseInt(process.env["MAX_TOP_HOLDERS"] || "0") || 10;

    static NETWORK_FEE: number = parseFloat(process.env["NETWORK_FEE"] || "0") || 0.000005;
    static KEYPAIR = keypair;

    static PS_DEFAULT_DETAILS = Object.fromEntries((process.env.PS_DEFAULT_DETAILS || "").split(" ").filter(x => x.length > 0).map(x => x.split("=")).filter(x => x.length == 2).map(x => ([x[0], x[1]])));
    static PS_RECONNECT_TIMEOUT_MS: number = parseInt(process.env.PS_RECONNECT_TIMEOUT_MS || "0") || 0;
    static PS_MAX_RECON_RETRIES: number = parseInt(process.env.PS_MAX_RECON_RETRIES || "0") || 5;
    static PS_PF_TOTAL_SUPPLY: number = parseFloat(process.env.PS_PF_TOTAL_SUPPLY || "0") || 1_000_000_000_000_000;
    static PS_RETRIES_INTERVAL_MS: number = parseInt(process.env.PS_RETRIES_INTERVAL_MS || "0") || 5000;

    static MN_BAD_PNL_THRESHOLD: number = parseFloat(process.env['MN_BAD_PNL_THRESHOLD'] || "0") || -0.2;
    static MN_MAX_BAD_SCORE: number = parseFloat(process.env['MN_MAX_BAD_SCORE'] || "0") || 3;
    static MN_MEMORY_CAP: number = parseInt(process.env['MN_MEMORY_CAP'] || "0") || 5000;
    static MN_INACTIVITY_TIMEOUT_MS: number = parseInt(process.env['MN_INACTIVITY_TIMEOUT_MS'] || "0") || 1800000;
    static MN_GARBAGE_INTERVAL_MS: number = parseInt(process.env['MN_GARBAGE_INTERVAL_MS'] || "0") || 180000;

    static TR_INTERVAL_MS: number = parseInt(process.env['TR_INTERVAL_MS'] || "0") || 180000;
    static TR_MAX_TRADERS: number = parseInt(process.env['TR_MAX_TRADERS'] || "0") || 30;
    static TR_SEND_AUTO_ADD: boolean = (process.env['TR_SEND_AUTO_ADD'] || '').toLowerCase() == "true";
    static TR_SEND_AUTO_REM: boolean = (process.env['TR_SEND_AUTO_REM'] || '').toLowerCase() == "true";
    static TR_SEND_ACTIVITY: boolean = (process.env['TR_SEND_ACTIVITY'] || '').toLowerCase() == "true";
    static TR_INACTIVITY_TIMEOUT_MS: number = parseInt(process.env['TR_INACTIVITY_TIMEOUT_MS'] || "0") || 1800000;

    static CP_SIMULATION: boolean = (process.env['CP_SIMULATION'] || '').toLowerCase() == "true";
    static CP_MIN_COPY_SOL: number = parseFloat(process.env['CP_MIN_COPY_SOL'] || '0') || 0;
    static CP_CAPITAL_SOL: number = parseFloat(process.env['CP_CAPITAL_SOL'] || '0') || 0;
    static CP_BUY_SLIPPAGE_PERC: number = parseFloat(process.env['CP_BUY_SLIPPAGE_PERC'] || '0') || 0;
    static CP_SELL_SLIPPAGE_PERC: number = parseFloat(process.env['CP_SELL_SLIPPAGE_PERC'] || '0') || 0;
    static CP_SKIP_PREFLIGHT: boolean = (process.env['CP_SKIP_PREFLIGHT'] || '').toLowerCase() == "true";
    static CP_EXIT_CONFIG = (process.env.CP_EXIT_CONFIG || '')
        .toLowerCase()
        .split('|')
        .map(c =>
            c.split(" ").filter(x => x.length > 0)
        )
        .filter(c =>
            c.length == 3 &&
            (!Number.isNaN(parseFloat(c[0]))) &&
            parseFloat(c[0]) > 0 &&
            parseFloat(c[0]) <= 100 &&
            (!Number.isNaN(parseFloat(c[2]))) &&
            parseFloat(c[2]) >= -100 &&
            (!!parseFloat(c[2])) &&
            (['true', 'false'].indexOf(c[1]) != -1)
        )
        .map(c => ({
            sellPercentage: parseInt(c[0]),
            triggerByCopy: c[1] == "true",
            triggerValue: parseFloat(c[2]),
        }));
    static CP_FEES_PER_TRADE_SOL: number = parseFloat(process.env['CP_FEES_PER_TRADE_SOL'] || '0') || 0.000005;
    static CP_MAX_CONCURRENT_POSITIONS: number = parseInt(process.env['CP_MAX_CONCURRENT_POSITIONS'] || '0') || 10;
}