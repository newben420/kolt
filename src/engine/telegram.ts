import { shortenAddress } from './../lib/shorten_address';
import { isValidAddress } from './../lib/is_valid_address';
import TelegramBot from 'node-telegram-bot-api';
import { Site } from '../site';
import { Log } from '../lib/log';
import { getDateTime, getTimeElapsed } from '../lib/date_time';
import { FFF, formatNumber } from '../lib/format_number';

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

const INSTANCE_START = Date.now();

let cachedSourceEngine: typeof import('./source').SourceEngine | null = null;
const SourceEngine = async () => {
    if (!cachedSourceEngine) {
        cachedSourceEngine = ((await import('./source'))).SourceEngine;
    }
    return cachedSourceEngine;
}

let cachedPumpswapEngine: typeof import('./pumpswap').default | null = null;
const PumpswapEngine = async () => {
    if (!cachedPumpswapEngine) {
        cachedPumpswapEngine = ((await import('./pumpswap'))).default;
    }
    return cachedPumpswapEngine;
}

process.env["NTBA_FIX_350"] = 'true';

const starting = Date.now();

type CBF = (messageId: string) => void;

export class TelegramEngine {

    private static bot: TelegramBot;

    static processWebHook = (body: any) => {
        if (!Site.TG_POLLING) {
            try {
                TelegramEngine.bot.processUpdate(body);
            } catch (error) {
                Log.dev(error);
            }

        }
    }

    private static startMessage = () => {
        let m: string = `👋 ${Site.TITLE} been awake since ${getDateTime(starting)}`;
        m += `\n\n👉 Send a wallet address to manually add it to tracker.`;
        return m;
    }

    private static statusMessage = async () => {
        let message: string = `🎰 ${getDateTime()}\n\n`;
        message += `*Online* for ${getTimeElapsed(INSTANCE_START, Date.now())} \n\n`;
        let inline: TelegramBot.InlineKeyboardButton[][] = [
            [
                {
                    text: '♻️ Refresh',
                    callback_data: 'refreshstatus',
                },
            ],
        ];

        const SETotalTokensMigrated = (await SourceEngine()).totalTokensMigrated;
        const SETotalTopTraderAdded = (await SourceEngine()).totalAddedTopTraders;
        const METraders = (await MainEngine()).tradersCount();
        const MEDeletedTraders = (await MainEngine()).deletedTradersCount;
        const PESubbed = (await PumpswapEngine()).subscribed;
        const PETotalMessages = (await PumpswapEngine()).messageCount;
        const PEAVGLatencyMS = ((await PumpswapEngine()).recentLatencies.reduce((a, b) => a + b, 0) / (await PumpswapEngine()).recentLatencies.length) || 0;
        const PEValidMessages = (await PumpswapEngine()).validMessageCount;
        const TETopTraders = (await TrackerEngine()).getTopTradersCount();
        const TEManualTraders = (await TrackerEngine()).getManualTradersCount();
        const TERemovedTraders = (await TrackerEngine()).removedTradersCount;

        message += `🚀 *Source Engine*\n`;
        message += `Tokens Migrated 🟰 ${formatNumber(SETotalTokensMigrated)}\n`;
        message += `Top Traders Added 🟰 ${formatNumber(SETotalTopTraderAdded)}\n`;
        message += `\n`;

        message += `🏢 *Main Engine*\n`;
        message += `Traders 🟰 ${formatNumber(METraders)}\n`;
        message += `Removed Traders 🟰 ${formatNumber(MEDeletedTraders)}\n`;
        message += `\n`;

        message += `💊 *PumpSwap Engine*\n`;
        message += `Subscribed 🟰 ${PESubbed ? `Yes` : 'No'}\n`;
        message += `AVG Latency 🟰 ${PEAVGLatencyMS.toFixed(0)}ms\n`;
        message += `Total Messages 🟰 ${FFF(PETotalMessages)}\n`;
        message += `Valid Messages 🟰 ${formatNumber(PEValidMessages)}\n`;
        message += `\n`;

        message += `📍 *Tracker Engine*\n`;
        message += `Top Added Traders 🟰 ${formatNumber(TETopTraders)}\n`;
        message += `Manually Added Traders 🟰 ${formatNumber(TEManualTraders)}\n`;
        message += `Removed Traders 🟰 ${formatNumber(TERemovedTraders)}\n`;

        return { message, inline };
    }

    private static trackerMessage = async (max: number = 20) => {
        let message: string = `🚀 *Tracked Wallets* ${getDateTime()}\n\n`;
        let inline: TelegramBot.InlineKeyboardButton[][] = [];
        let traders = (await TrackerEngine()).getTradersArray();
        if (traders.length > max) {
            traders = traders.slice(traders.length - max);
        }
        if (traders.length <= 0) {
            message += `No wallets being tracked at the moment.`;
        }
        else {
            message += traders.map((trader, i) => {
                let m = `${i + 1}. *${shortenAddress(trader.address)}*\n`;
                m += `🚀 ${trader.manuallyAdded ? `Manual` : `Top Trader`}\n`;
                m += `🕝 ${getTimeElapsed(trader.timeAdded, Date.now())} 🔄 ${getTimeElapsed(trader.lastUpdated, Date.now())}\n`;
                m += `🟩 ${formatNumber(trader.buys)} 🟥 ${formatNumber(trader.sells)}\n`
                if (trader.pnl || trader.rpnl || trader.upnl) m += `💰 ${FFF((trader.pnl || 0) * 100)}% 💰U ${FFF((trader.upnl || 0) * 100)}% 💰R ${FFF((trader.rpnl || 0) * 100)}%\n`;
                inline.push([
                    {
                        text: `🗑 ${shortenAddress(trader.address)}`,
                        callback_data: `delt_${trader.address.slice(0, 6)}`,
                    }
                ]);
                return m;
            }).join("\n");
        }

        inline.push([
            {
                text: `♻️ Refresh`,
                callback_data: `refreshtracker`,
            }
        ]);

        return { message, inline };
    }

    static start = () => {
        return new Promise<boolean>((resolve, reject) => {
            TelegramEngine.bot = new TelegramBot(Site.TG_TOKEN, {
                polling: Site.TG_POLLING,
                request: {
                    agentOptions: {
                        family: Site.FORCE_FAMILY_4 ? 4 : undefined,
                    },
                    url: '',
                }
            });
            TelegramEngine.bot.setMyCommands([
                {
                    command: "/start",
                    description: "👋"
                },
                {
                    command: "/status",
                    description: "Status"
                },
                {
                    command: "/tracker",
                    description: "Tracker"
                },
            ]);
            if (!Site.TG_POLLING) {
                TelegramEngine.bot.setWebHook(`${Site.URL}/webhook`, {
                    secret_token: Site.TG_WH_SECRET_TOKEN,
                });
            }
            TelegramEngine.bot.on("text", async (msg) => {
                let content = (msg.text || "").trim();
                const pid = msg.chat.id || msg.from?.id;
                const noteRegex = /^TITLE=(.+)\nBODY=([\s\S]+)$/;
                const walletRegex = /^$/;
                if (pid && pid == Site.TG_CHAT_ID) {
                    if (/^\/start$/.test(content)) {
                        TelegramEngine.sendMessage(TelegramEngine.startMessage());
                    }
                    else if (/^\/tracker$/.test(content)) {
                        const { inline, message } = await TelegramEngine.trackerMessage();
                        TelegramEngine.sendMessage(message, mid => { }, {
                            disable_web_page_preview: true,
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: inline,
                            }
                        });
                    }
                    else if (isValidAddress(content)) {
                        const added = (await TrackerEngine()).addTrader(content, true);
                        if (added) {
                            (await MainEngine()).newTrader(content);
                            TelegramEngine.sendMessage(`✅ \`${shortenAddress(content)}\`\ is now being tracked.`);
                        }
                        else {
                            TelegramEngine.sendMessage(`❌ \`${shortenAddress(content)}\`\ could not be added.`);
                        }
                    }
                    else if (/^\/status$/.test(content)) {
                        const { inline, message } = await TelegramEngine.statusMessage();
                        TelegramEngine.sendMessage(message, mid => { }, {
                            disable_web_page_preview: true,
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: inline,
                            }
                        });
                    }
                    else {
                        TelegramEngine.sendMessage(`😔 Sorry! ${Site.TITLE} could not understand your message\n\n` + TelegramEngine.startMessage());
                    }
                }
            });

            TelegramEngine.bot.on("callback_query", async (callbackQuery) => {
                const pid = callbackQuery.message?.chat.id || callbackQuery.message?.from?.id;
                if (pid && pid == Site.TG_CHAT_ID) {
                    if (callbackQuery.data == "deletemessage") {
                        try {
                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                            if (callbackQuery.message?.message_id) {
                                TelegramEngine.deleteMessage(callbackQuery.message?.message_id);
                            }
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                    else if (callbackQuery.data == "refreshtracker") {
                        try {
                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                            const { message, inline } = await TelegramEngine.trackerMessage();
                            const done = await TelegramEngine.bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                                chat_id: Site.TG_CHAT_ID,
                                message_id: callbackQuery?.message?.message_id,
                                parse_mode: "MarkdownV2",
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: inline
                                }
                            });
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                    else if (callbackQuery.data == "refreshstatus") {
                        try {
                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                            const { message, inline } = await TelegramEngine.statusMessage();
                            const done = await TelegramEngine.bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                                chat_id: Site.TG_CHAT_ID,
                                message_id: callbackQuery?.message?.message_id,
                                parse_mode: "MarkdownV2",
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: inline
                                }
                            });
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                    else {
                        let content = callbackQuery.data || "";
                        content = content.replace(/\-/g, ".").trim().replace(/_/g, " ").trim();
                        if (content.startsWith("delt ")) {
                            let temp = content.split(" ");
                            let value = (temp[1] || '').toLowerCase() == "true";
                            let pre = temp[1] || '_________';
                            const addr = (await TrackerEngine()).getAddressStartsWith(pre);
                            if (addr) {
                                const deleted = (await TrackerEngine()).removeTrader(addr);
                                if (deleted) {
                                    TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                        text: `✅ Wallet removed!`,
                                    });

                                    try {
                                        const { message, inline } = await TelegramEngine.trackerMessage();
                                        const done = await TelegramEngine.bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: callbackQuery?.message?.message_id,
                                            parse_mode: "MarkdownV2",
                                            disable_web_page_preview: true,
                                            reply_markup: {
                                                inline_keyboard: inline
                                            }
                                        });
                                    } catch (error) {
                                        Log.dev(error);
                                    }
                                }
                                else {
                                    TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                        text: `❌ Wallet could not be removed!`,
                                    });
                                }
                            }
                            else {
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `❌ Wallet not found!`,
                                });
                            }
                        }
                    }
                }
            });

            TelegramEngine.bot.on("polling_error", (err) => {
                Log.dev(`Telegram > Polling error`, err);
            });
            TelegramEngine.bot.on("webhook_error", (err) => {
                Log.dev(`Telegram > Webhook error`, err);
            });

            Log.flow(['Telegram', 'Initialized.'], 0);
            resolve(true);
        })
    }

    static sendStringAsTxtFile = (content: string, caption: string, filename: string) => {
        return new Promise<boolean>((resolve, reject) => {
            TelegramEngine.bot.sendDocument(Site.TG_CHAT_ID, Buffer.from(content, "utf8"), {
                parse_mode: "MarkdownV2",
                caption: TelegramEngine.sanitizeMessage(caption),
            }, {
                contentType: "text/plain",
                filename: filename,
            }).then(r => {
                resolve(true);
            }).catch(err => {
                Log.dev(err);
                resolve(false);
            });
        })
    }

    static sendStringAsJSONFile = (content: string, caption: string, filename: string) => {
        return new Promise((resolve, reject) => {
            TelegramEngine.bot.sendDocument(Site.TG_CHAT_ID, Buffer.from(content, "utf8"), {
                parse_mode: "MarkdownV2",
                caption: TelegramEngine.sanitizeMessage(caption),
            }, {
                contentType: "application/json",
                filename: filename,
            }).then(r => {
                resolve(true);
            }).catch(err => {
                Log.dev(err);
                resolve(false);
            });
        })
    }

    static deleteMessage = (messageId: number) => {
        return new Promise<boolean>((resolve, reject) => {
            TelegramEngine.bot.deleteMessage(Site.TG_CHAT_ID, messageId).then(() => {
                resolve(true);
            }
            ).catch(err => {
                Log.dev(err);
                resolve(false);
            }
            );
        })
    }

    private static messageQueue: any[] = [];
    private static processing: boolean = false;
    private static WINDOW_DURATION: number = 1000;
    private static windowStart: number = Date.now();
    private static globalCount: number = 0;
    private static chatCounts: any = {};

    static sendMessage = (message: string, callback: CBF = (id) => { }, opts: TelegramBot.SendMessageOptions = {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
    }, isTemp = false,) => {
        TelegramEngine.messageQueue.push({
            message,
            callback,
            opts,
            isTemp,
        });

        if (!TelegramEngine.processing) {
            TelegramEngine.processQueue();
        }
    }

    private static processQueue = async () => {
        TelegramEngine.processing = true;

        while (TelegramEngine.messageQueue.length > 0) {
            const now = Date.now();

            // Reset the counters if the window has passed
            if (now - TelegramEngine.windowStart >= TelegramEngine.WINDOW_DURATION) {
                TelegramEngine.windowStart = now;
                TelegramEngine.globalCount = 0;
                TelegramEngine.chatCounts = {};
            }

            let sentAny = false;
            // Use  variable to track the minimal wait time needed for any blocked message
            let nextDelay = TelegramEngine.WINDOW_DURATION;

            // Iterate through the queue and process eligible messages
            for (let i = 0; i < TelegramEngine.messageQueue.length; i++) {
                const msg = TelegramEngine.messageQueue[i];
                const chatCount = TelegramEngine.chatCounts[msg.chatId] || 0;
                const globalLimitReached = TelegramEngine.globalCount >= 30;
                const chatLimitReached = chatCount >= 1;

                // If sending this message does not exceed limits, send it immediately
                if (!globalLimitReached && !chatLimitReached) {
                    TelegramEngine.globalCount++;
                    TelegramEngine.chatCounts[msg.chatId] = chatCount + 1;
                    // Remove message from the queue and send it
                    TelegramEngine.messageQueue.splice(i, 1);
                    // Adjust index due to removal
                    i--;
                    TelegramEngine.sendIndividualMessage(msg);
                    sentAny = true;
                }
                else {
                    // Determine the delay required for either global or per-chat counter to reset
                    let globalDelay = globalLimitReached ? TelegramEngine.WINDOW_DURATION - (now - TelegramEngine.windowStart) : 0;
                    let chatDelay = chatLimitReached ? TelegramEngine.WINDOW_DURATION - (now - TelegramEngine.windowStart) : 0;
                    // The message will be eligible after the maximum of these two delays
                    const delayForMsg = Math.max(globalDelay, chatDelay);
                    // Save the minimal delay needed among all blocked messages
                    if (delayForMsg < nextDelay) {
                        nextDelay = delayForMsg;
                    }
                }
            }

            // if no messages were sent in this pass, wait for the minimal  required delay
            if (!sentAny) {
                await new Promise(resolve => setTimeout(resolve, nextDelay));
            }
        }

        TelegramEngine.processing = false;
    }

    static sanitizeMessage = (txt: string) => txt.replace(/([~>#\+\-=\|{}\.!])/g, '\\$&');

    private static lastMessageID: any = null;
    private static lastTokenMessageID: any = null

    private static sendIndividualMessage = (msg: any) => {
        const { callback, message, opts, isTemp } = msg;
        TelegramEngine.bot.sendMessage(Site.TG_CHAT_ID, TelegramEngine.sanitizeMessage(message), opts).then((mess) => {
            Log.dev(`Telegram > Sent text.`);
            if (!isTemp) {
                TelegramEngine.lastMessageID = mess.message_id;
            }
            callback(mess.message_id);
        }).catch(err => {
            Log.dev("Telegram > Error sending text", err);
            callback(null);
        });
    }


}