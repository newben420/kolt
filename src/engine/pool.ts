import { TOKEN_PROGRAM_ID } from './../lib/token_program_id';
import { sleep } from './../lib/sleep';
import { PublicKey } from '@solana/web3.js';
import { Log } from './../lib/log';
import { PoolConfig, TraderPool } from './../model/pool';
let cachedSourceEngine: typeof import('./source').SourceEngine | null = null;
const SourceEngine = async () => {
    if (!cachedSourceEngine) {
        cachedSourceEngine = ((await import('./source'))).SourceEngine;
    }
    return cachedSourceEngine;
}



export class PoolEngine {
    private static queue: PoolConfig[] = [];

    static getPool = (c: PoolConfig) => {
        PoolEngine.queue.push(c);
        PoolEngine.run();
    }

    private static isRunning: boolean = false;

    private static intervalMS: number = 1000;

    private static run = async () => {
        if (!PoolEngine.isRunning) {
            PoolEngine.isRunning = true;
            while (PoolEngine.queue.length > 0) {
                const item = PoolEngine.queue.shift();
                if (item) {
                    const pools: TraderPool[] = [];
                    const start = Date.now();
                    try {
                        const resp = await (await SourceEngine()).getConnection().getParsedTokenAccountsByOwner(new PublicKey(item.walletAddress), {
                            programId: new PublicKey(TOKEN_PROGRAM_ID)
                        });

                        for (const { pubkey, account } of resp.value) {
                            const info = account.data.parsed.info;
                            const tokenAccount = pubkey.toBase58();
                            const mint = info.mint;
                            const amount = parseFloat(info.tokenAmount.amount);
                            const decimals = parseFloat(info.tokenAmount.decimals);
                            const balance = amount / 10 ** decimals;
                            if (balance > 0) {
                                pools.push({
                                    amount: balance,
                                    mint: mint,
                                });
                            }
                        }
                    } catch (error) {
                        Log.dev(error);
                    }
                    finally{
                        item.callback(pools);
                        const duration = Date.now() - start;
                        if(duration < PoolEngine.intervalMS){
                            await sleep(PoolEngine.intervalMS - duration);
                        }
                    }
                }
            }
            PoolEngine.isRunning = false;
        }
    }
}