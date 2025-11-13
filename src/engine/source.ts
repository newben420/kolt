import { AccountLayout } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { Log } from './../lib/log';
import { Site } from './../site';
import axios from 'axios';

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

const SLUG = "SourceEngine";
const WEIGHT = 3;

/**
 * This sources for traders to be monitored.
 * For now, we add top holders of a token when it graduates from PumpDotFun to SwapDotPumpDotFun.
 */
export class SourceEngine {

    private static conn = new Connection(Site.RPC, "confirmed");

    private static getAccountOwners = (accounts: string[]) => new Promise<string[]>(async (resolve, reject) => {
        try {
            const pubKeys = accounts.map(addr => new PublicKey(addr));
            const accountInfos = await SourceEngine.conn.getMultipleAccountsInfo(pubKeys);
            const res = accountInfos.map((info, i) => {
                if (!info) return null;
                const data = AccountLayout.decode(info.data);
                return (new PublicKey(data.owner)).toString();
            });
            resolve(res.filter(x => x !== null));
        } catch (error) {
            Log.dev(error)
            resolve([]);
        }
    });

    private static getTopHolders = (mint: string) => new Promise<string[]>(async (resolve, reject) => {
        try {
            const holders: {
                address: string;
                amount: any;
            }[] = (await axios.get(`${Site.PF_API}/coins/holders/${mint}`)).data.holders;
            const addresses = holders.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)).map(x => x.address);
            // addresses.shift(); // REMOVE POSSIBLE BONDING ADDRESS
            resolve(addresses.slice(0, Site.MAX_TOP_HOLDERS));
        } catch (error) {
            Log.dev(error);
            resolve([]);
        }
    });

    static totalAddedTopTraders: number = 0;
    static totalTokensMigrated: number = 0;

    static newMigration = async (
        { mint }: {
            mint: string;
        }
    ) => {
        if (mint) {
            SourceEngine.totalTokensMigrated += 1;
            Log.flow([SLUG, mint, `Initiated.`], WEIGHT);
            const holdersTokenAddresses = await SourceEngine.getTopHolders(mint);
            if (holdersTokenAddresses.length > 0) {
                for (const addr of holdersTokenAddresses) {
                    (await MainEngine()).newTrader(addr);
                }
                SourceEngine.totalAddedTopTraders += holdersTokenAddresses.length;
                // Log.flow([SLUG, mint, `Holders' (${holdersTokenAddresses.length}) token addresses found.`], WEIGHT);
                // const accountOwners = await SourceEngine.getAccountOwners(holdersTokenAddresses);
                // if (accountOwners.length > 0) {
                //     Log.flow([SLUG, mint, `Holders' (${holdersTokenAddresses.length}) owners addresses found.`], WEIGHT);
                //     for(const owner of accountOwners){
                //         (await MainEngine()).newTrader(owner);
                //     }
                // }
                // else {
                //     Log.flow([SLUG, mint, `No holders' owners addresses found.`], WEIGHT);
                //     let m = `❌ Sourcing Failed\n\n\`\`\`\nNo holders' owners addresses found.\`\`\``;
                //     (await TelegramEngine()).sendMessage(m);
                // }
            }
            else {
                Log.flow([SLUG, mint, `No holders' addresses found.`], WEIGHT);
                let m = `❌ Sourcing Failed\n\n\`\`\`\nNo holders' addresses found.\`\`\``;
                (await TelegramEngine()).sendMessage(m);
            }
        }
    }
}