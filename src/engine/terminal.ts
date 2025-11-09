import { getDateTime } from "../lib/date_time";
import { Site } from "../site";
import PumpswapEngine from "./pumpswap";
import { TelegramEngine } from "./telegram";

export const startEngine = () => new Promise<boolean>(async (resolve, reject) => {
    const loaded = (await TelegramEngine.start()) && (await PumpswapEngine.start());
    resolve(loaded);
});

export const stopEngine = () => new Promise<boolean>(async (resolve, reject) => {
    const conclude = async () => {
        const ended = await Promise.all([
            PumpswapEngine.stop(),
        ]);
        resolve(ended.every(v => v === true));
    }
    if (Site.PRODUCTION) {
        TelegramEngine.sendMessage(`😴 ${Site.TITLE} is going back to sleep at ${getDateTime()}`, async mid => {
            conclude();
        });
    }
    else {
        conclude();
    }
});