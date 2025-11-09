import TelegramBot from 'node-telegram-bot-api';
import { Site } from '../site';
import { Log } from '../lib/log';
import { getDateTime, getTimeElapsed } from '../lib/date_time';
import { FFF, formatNumber } from '../lib/format_number';

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
        // m += `\n\n👉 Send a message conatining a bunch of valid pairs to add them to pairs e.g. \`GBPUSD=X JPYEUR=X\``;
        return m;
    }

    // private static statusMessage = () => {
    //     let message: string = `🎰 ${getDateTime()}\n`;
    //     let inline: TelegramBot.InlineKeyboardButton[][] = [
    //         [
    //             {
    //                 text: '♻️ Refresh',
    //                 callback_data: 'refreshstatus',
    //             },
    //         ],
    //         [
    //             {
    //                 text: `${MainEngine.canRun ? `🔴` : `🟢`} Turn ${MainEngine.canRun ? `Off` : `On`}`,
    //                 callback_data: `main_${MainEngine.canRun ? 'false' : 'true'}`,
    //             },
    //         ]
    //     ];
    //     message += `\nCompleted Drops ✅ ${formatNumber(MainEngine.completedDrops)}`;
    //     message += `\nFailed Drops ❌ ${formatNumber(MainEngine.failedDrops)}`;
    //     message += `\nTotal Cost 💰 ${FFF(MainEngine.totalCost)}`;
    //     message += `\nLast Sent ⏰ ${MainEngine.lastSentTS ? getTimeElapsed(MainEngine.lastSentTS, Date.now()) : 'Never'}`;
    //     message += `\nBalance 💰 ${FFF(MainEngine.balance)}`;
    //     return { message, inline };
    // }

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
                if (pid && pid == Site.TG_CHAT_ID) {
                    if (/^\/start$/.test(content)) {
                        TelegramEngine.sendMessage(TelegramEngine.startMessage());
                    }
                    // else if (/^\/status$/.test(content)) {
                    //     const { inline, message } = TelegramEngine.statusMessage();
                    //     TelegramEngine.sendMessage(message, mid => { }, {
                    //         disable_web_page_preview: true,
                    //         parse_mode: 'MarkdownV2',
                    //         reply_markup: {
                    //             inline_keyboard: inline,
                    //         }
                    //     });
                    // }
                    else {
                        TelegramEngine.sendMessage(`😔 Sorry! ${Site.TITLE} could not understand your message\n\n` + TelegramEngine.startMessage());
                    }
                }
            });

            TelegramEngine.bot.on("callback_query", async (callbackQuery) => {
                const pid = callbackQuery.message?.chat.id || callbackQuery.message?.from?.id;
                if (pid && pid == Site.TG_CHAT_ID) {
                    // if (callbackQuery.data == "refreshstatus") {
                    //     try {
                    //         TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                    //         const { message, inline } = TelegramEngine.statusMessage();
                    //         const done = await TelegramEngine.bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                    //             chat_id: Site.TG_CHAT_ID,
                    //             message_id: callbackQuery?.message?.message_id,
                    //             parse_mode: "MarkdownV2",
                    //             disable_web_page_preview: true,
                    //             reply_markup: {
                    //                 inline_keyboard: inline
                    //             }
                    //         });
                    //     } catch (error) {
                    //         Log.dev(error);
                    //     }
                    // }
                    // else {
                    //     let content = callbackQuery.data || "";
                    //     content = content.replace(/\-/g, ".").trim().replace(/_/g, " ").trim();
                    //     if (content.startsWith("main ")) {
                    //         let temp = content.split(" ");
                    //         let value = (temp[1] || '').toLowerCase() == "true";
                    //         MainEngine.canRun = value;
                    //         TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                    //         try {
                    //             const { message, inline } = TelegramEngine.statusMessage();
                    //             const done = await TelegramEngine.bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                    //                 chat_id: Site.TG_CHAT_ID,
                    //                 message_id: callbackQuery?.message?.message_id,
                    //                 parse_mode: "MarkdownV2",
                    //                 disable_web_page_preview: true,
                    //                 reply_markup: {
                    //                     inline_keyboard: inline
                    //                 }
                    //             });
                    //         } catch (error) {
                    //             Log.dev(error);
                    //         }
                    //     }
                    // }
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