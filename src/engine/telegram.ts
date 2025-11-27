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

let cachedCopyEngine: typeof import('./copy').CopyEngine | null = null;
const CopyEngine = async () => {
    if (!cachedCopyEngine) {
        cachedCopyEngine = ((await import('./copy'))).CopyEngine;
    }
    return cachedCopyEngine;
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
        const copy = (await TrackerEngine()).autoCopy;
        const exit = (await CopyEngine()).exitFlag;
        const pd = (await CopyEngine()).pdFlag;
        let inline: TelegramBot.InlineKeyboardButton[][] = [
            [
                {
                    text: '♻️ Refresh',
                    callback_data: 'refreshstatus',
                },
            ],
            [
                {
                    text: `${copy ? `🟥` : `🟩`} Auto Copy`,
                    callback_data: `cptr_${copy ? 'false' : 'true'}`,
                }
            ],
            [
                {
                    text: `${exit ? `🟥` : `🟩`} Copy Exit`,
                    callback_data: `cpex_${exit ? 'false' : 'true'}`,
                }
            ],
            [
                {
                    text: `${pd ? `🟥` : `🟩`} Peak Drop`,
                    callback_data: `cppd_${pd ? 'false' : 'true'}`,
                }
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
        const CEOpenedPositions = (await CopyEngine()).totalOpenedPositions;
        const CECurrentPositions = CEOpenedPositions - (await CopyEngine()).totalClosedPositions;
        const CETotalRPnL = (await CopyEngine()).totalRealizedPnLSOL;

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
        message += `\n`;

        message += `🏦 *Copy Engine*\n`;
        message += `Opened Positions 🟰 ${formatNumber(CEOpenedPositions)}\n`;
        message += `Current Positions 🟰 ${formatNumber(CECurrentPositions)}\n`;
        message += `Total PnL 🟰 SOL ${FFF(CETotalRPnL)}\n`;

        return { message, inline };
    }

    private static trackerMessage = async (max: number = 20) => {
        let message: string = `🚀 *Tracked Wallets* ${getDateTime()}\n\n`;
        let inline: TelegramBot.InlineKeyboardButton[][] = [];
        inline.push([
            {
                text: `♻️ Refresh`,
                callback_data: `refreshtracker`,
            }
        ]);
        let traders = (await TrackerEngine()).getTradersArray();
        if (traders.length > max) {
            traders = traders.slice(traders.length - max);
        }
        if (traders.length <= 0) {
            message += `No wallets being tracked at the moment.`;
        }
        else {
            message += traders.map((trader, i) => {
                let m = `${i + 1}. *${shortenAddress(trader.address)}* ${trader.manuallyAdded ? `⌨️` : `🤖`}\n`;
                m += `🕝 ${getTimeElapsed(trader.timeAdded, Date.now())} 🔄 ${getTimeElapsed(trader.lastUpdated, Date.now())}\n`;
                m += `🟩 ${formatNumber(trader.buys)} \\(SOL${FFF(trader.buysSol)}\\) 🟥 ${formatNumber(trader.sells)} \\(SOL${FFF(trader.sellsSol)}\\)\n`
                if (trader.pnl || trader.rpnl || trader.upnl) m += `💰 ${FFF((trader.pnl || 0) * 100)}% 💰U ${FFF((trader.upnl || 0) * 100)}% 💰R ${FFF((trader.rpnl || 0) * 100)}%\n`;
                inline.push([
                    {
                        text: `${shortenAddress(trader.address)}`,
                        callback_data: `show_${trader.address.slice(0, 6)}`,
                    },
                    {
                        text: `🗑`,
                        callback_data: `delt_${trader.address.slice(0, 6)}`,
                    },
                    {
                        text: trader.showAlert ? `🔕` : `🔔`,
                        callback_data: `alrt_${trader.address.slice(0, 6)}_${trader.showAlert ? 'false' : 'true'}`,
                    },
                    {
                        text: trader.copy ? `⏏️` : `©️`,
                        callback_data: `copy_${trader.address.slice(0, 6)}_${trader.copy ? 'false' : 'true'}`,
                    },
                ]);
                return m;
            }).join("\n");
        }

        return { message, inline };
    }

    private static positionsMessage = async (max: number = 20) => {
        let message: string = `🚀 *Current Positions* ${getDateTime()}\n\n`;
        let inline: TelegramBot.InlineKeyboardButton[][] = [];
        inline.push([
            {
                text: `♻️ Refresh`,
                callback_data: `refreshpositions`,
            }
        ]);
        let positions = (await CopyEngine()).getPositions();
        if (positions.length > max) {
            positions = positions.slice(positions.length - max);
        }
        if (positions.length <= 0) {
            message += `No opened positions at the moment.`;
        }
        else {
            message += positions.map((position, i) => {
                let m = `${i + 1}. *${shortenAddress(position.mint)}* ${position.confirmed ? `✅` : `❌`}\n`;
                m += `🕝 ${getTimeElapsed(position.buyTime, Date.now())} 🔄 ${getTimeElapsed(position.lastUpdated, Date.now())}\n`;
                if (position.confirmed) {
                    const returns = (position.solGotten + (position.amountHeld * position.currentPrice)) - position.buyCapital;
                    m += `💰 SOL ${FFF(returns)} \\(${FFF(position.pnL)}%\\) 🟩 ${FFF(position.peakPnL)}% 🟥 ${FFF(position.leastPnL)}%\n`;
                    if (position.solGotten) {
                        m += `Sells 👉  SOL ${FFF(position.solGotten)} \\(${formatNumber(position.sellReasons.length)}%\\)\n`
                    }
                    m += `Price \`SOL ${FFF(position.currentPrice)}\` MarketCap \`SOL ${FFF(position.currentMarketCap)}\`\n`
                }

                inline.push([
                    {
                        text: `🔴 ${shortenAddress(position.mint)}`,
                        callback_data: `clps_${position.mint.slice(0, 10)}`,
                    },
                ]);
                return m;
            }).join("\n");
        }

        return { message, inline };
    }

    private static ranksMessage = async () => {
        let message: string = `🚀 *Top ${Site.CP_EARN_RANKING_MAX} Earning Source* ${getDateTime()}\n\n`;
        let inline: TelegramBot.InlineKeyboardButton[][] = [];
        inline.push([
            {
                text: `♻️ Refresh`,
                callback_data: `refreshranks`,
            }
        ]);
        let ranks = (await CopyEngine()).getRanking();
        if (ranks.length <= 0) {
            message += `No ranks at the moment.`;
        }
        else {
            message += ranks.map((rank, i) => {
                let m = `${i + 1}. \`${rank.address}\`\n`;
                m += `PnL 🟰 \`SOL ${FFF(rank.pnl)}\`\n`
                m += `Positions 🟰 \`${formatNumber(rank.positions)}\`\n`
                return m;
            }).join("\n");
        }

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
                    description: "Bot's Status"
                },
                {
                    command: "/tracker",
                    description: "Managed Tracked Wallets"
                },
                {
                    command: "/positions",
                    description: "Manage Open Positions"
                },
                {
                    command: "/ranks",
                    description: "Show Top Earn Source Rankings"
                },
                {
                    command: "/balance",
                    description: "Get Own Wallet Balance"
                },
                {
                    command: "/recover",
                    description: "Recover Rent, Close Empty Token Accounts"
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
                    else if (/^\/ranks$/.test(content)) {
                        const { inline, message } = await TelegramEngine.ranksMessage();
                        TelegramEngine.sendMessage(message, mid => { }, {
                            disable_web_page_preview: true,
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: inline,
                            }
                        });
                    }
                    else if (/^\/balance$/.test(content)) {
                        const balance = await (await CopyEngine()).getOwnBalance();
                        if (balance === null) {
                            TelegramEngine.sendMessage(`❌ Could not get wallet balance`);
                        }
                        else {
                            TelegramEngine.sendMessage(`✅ *Wallet*\n\n📍 \`${Site.KEYPAIR.publicKey.toString()}\`\n💰\`SOL ${balance}\``);
                        }
                    }
                    else if (/^\/recover$/.test(content)) {
                        const done = await (await CopyEngine()).recovery();
                        if (!done) {
                            TelegramEngine.sendMessage(`❌ Could not complete operation`);
                        }
                        else {
                            TelegramEngine.sendMessage(`✅ Empty token accounts closed`);
                        }
                    }
                    else if (/^\/positions$/.test(content)) {
                        const { inline, message } = await TelegramEngine.positionsMessage();
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
                    else if (callbackQuery.data == "refreshranks") {
                        try {
                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                            const { message, inline } = await TelegramEngine.ranksMessage();
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
                    else if (callbackQuery.data == "refreshpositions") {
                        try {
                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id);
                            const { message, inline } = await TelegramEngine.positionsMessage();
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
                        if (content.startsWith("clps ")) {
                            let temp = content.split(" ");
                            let pre = temp[1] || '_________';
                            const mint = (await CopyEngine()).getAddressStartsWith(pre);
                            if (mint) {
                                const position = (await CopyEngine()).getPosition(mint);
                                if (position) {

                                    if (position.confirmed) {
                                        const sold = await (await CopyEngine()).sell(mint, 100, 'Manual', 0);
                                        if (sold) {
                                            TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                                text: `✅ Sell successful!`,
                                            });

                                            try {
                                                const { message, inline } = await TelegramEngine.positionsMessage();
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
                                                text: `❌ Sell failed!`,
                                            });
                                        }
                                    }
                                    else {
                                        (await CopyEngine()).deletePosition(mint);
                                        TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                            text: `✅ Deletion successful!`,
                                        });

                                        try {
                                            const { message, inline } = await TelegramEngine.positionsMessage();
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

                                }
                                else {
                                    TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                        text: `❌ Position not found!`,
                                    });
                                }
                            }
                            else {
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `❌ Position not found!`,
                                });
                            }
                        }
                        if (content.startsWith("show ")) {
                            let temp = content.split(" ");
                            let pre = temp[1] || '_________';
                            const addr = (await TrackerEngine()).getAddressStartsWith(pre);
                            if (addr) {
                                let m = `📍 *Full Wallet Address*\n\n\`${addr}\``;
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `✅ Wallet address shown below in new message!`,
                                });
                                TelegramEngine.sendMessage(m);
                            }
                            else {
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `❌ Wallet not found!`,
                                });
                            }
                        }
                        else if (content.startsWith("alrt ")) {
                            let temp = content.split(" ");
                            let value = (temp[2] || '').toLowerCase() == "true";
                            let pre = temp[1] || '_________';
                            const addr = (await TrackerEngine()).getAddressStartsWith(pre);
                            if (addr) {
                                const tracked = (await TrackerEngine()).getTrader(addr);
                                if (tracked) {
                                    tracked.showAlert = value;
                                    TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                        text: `✅ Alert Updated to '${value ? 'Show' : 'Hide'}' for ${shortenAddress(addr)}!`,
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
                                        text: `❌ Alert not updated!`,
                                    });
                                }
                            }
                            else {
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `❌ Wallet not found!`,
                                });
                            }
                        }
                        else if (content.startsWith("copy ")) {
                            let temp = content.split(" ");
                            let value = (temp[2] || '').toLowerCase() == "true";
                            let pre = temp[1] || '_________';
                            const addr = (await TrackerEngine()).getAddressStartsWith(pre);
                            if (addr) {
                                const tracked = (await TrackerEngine()).getTrader(addr);
                                if (tracked) {
                                    tracked.copy = value;
                                    TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                        text: `✅ ${shortenAddress(addr)}'s trades ${value ? `are now being copied` : `have stopped being copied`}!`,
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
                                        text: `❌ Copy not updated!`,
                                    });
                                }
                            }
                            else {
                                TelegramEngine.bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `❌ Wallet not found!`,
                                });
                            }
                        }
                        else if (content.startsWith("cptr ")) {
                            let temp = content.split(" ");
                            let value = (temp[1] || '').toLowerCase() == "true";
                            (await TrackerEngine()).autoCopy = value;
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
                        else if (content.startsWith("cpex ")) {
                            let temp = content.split(" ");
                            let value = (temp[1] || '').toLowerCase() == "true";
                            (await CopyEngine()).exitFlag = value;
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
                        else if (content.startsWith("cppd ")) {
                            let temp = content.split(" ");
                            let value = (temp[1] || '').toLowerCase() == "true";
                            (await CopyEngine()).pdFlag = value;
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