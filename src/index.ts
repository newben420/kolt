import https from 'https';
import { Site } from './site';
if (Site.FORCE_FAMILY_4) {
    https.globalAgent.options.family = 4;
}
import express, { Request, Response, NextFunction } from 'express';
import { startEngine, stopEngine } from './engine/terminal';
import http from 'http';
import bodyParser from 'body-parser';
import { Log } from './lib/log';
import { TelegramEngine } from './engine/telegram';
import { getDateTime } from './lib/date_time';
import { WebSocket } from 'ws';
import { JSONSafeParse } from './lib/json_safe_parse';
import PumpswapEngine from './engine/pumpswap';
import { SourceEngine } from './engine/source';
import { PoolEngine } from './engine/pool';

const app = express();
const server = http.createServer(app);

app.disable("x-powered-by");
app.disable('etag');
app.use(bodyParser.json({ limit: "35mb" }));

app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: "35mb",
        parameterLimit: 50000,
    })
);

app.get("/", async (req, res) => {
    res.send(`${Site.TITLE} is on.`);
});

app.post("/webhook", (req, res) => {
    const receivedToken = req.headers["x-telegram-bot-api-secret-token"];
    if (receivedToken != Site.TG_WH_SECRET_TOKEN) {
        res.sendStatus(403);
        return;
    }
    TelegramEngine.processWebHook(req.body);
    res.sendStatus(200);
});

app.use((req, res, next) => {
    res.sendStatus(404);
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    Log.dev(err);
    res.sendStatus(500);
});

process.on('exit', async (code) => {
    // NOTHING FOR NOW
});

process.on('SIGINT', async () => {
    Log.dev('Process > Received SIGINT.');
    const l = await stopEngine();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Log.dev('Process > Received SIGTERM.');
    const l = await stopEngine();
    process.exit(0);
});

process.on('uncaughtException', async (err) => {
    Log.dev('Process > Unhandled exception caught.');
    console.log(err);
    if (Site.EXIT_ON_UNCAUGHT_EXCEPTION) {
        const l = await stopEngine();
        process.exit(0);
    }
});

process.on('unhandledRejection', async (err, promise) => {
    Log.dev('Process > Unhandled rejection caught.');
    console.log("Promise:", promise);
    console.log("Reason:", err);
    if (Site.EXIT_ON_UNHANDLED_REJECTION) {
        const l = await stopEngine();
        process.exit(0);
    }
});

const proceedAfterInit = () => {
    const SLUG = "WebSocket";
    const WEIGHT = 3;
    const ws = new WebSocket(Site.WS_URL);
    ws.on('open', () => {
        Log.flow([SLUG, `Connected.`], WEIGHT);
        let payload = {
            method: "subscribeMigration",
        }
        ws.send(JSON.stringify(payload));
    });

    ws.on('close', () => {
        Log.flow([SLUG, `Disconnected.`], WEIGHT);
        setTimeout(() => {
            proceedAfterInit();
        }, Site.WS_RECON_DELYAY_MS);
    });

    ws.on('error', (err) => {
        Log.flow([SLUG, `Error`, `${err.message}.`], WEIGHT);
    });

    ws.on('message', async data => {
        const message = JSONSafeParse(data);
        const keys = Object.keys(message);
        if (keys.length === 1 && keys[0] === 'message') {
            Log.flow([SLUG, `Message`, `${message.message}`], WEIGHT);
        }
        else {
            if (message.txType == "migrate") {
                SourceEngine.newMigration(message);
            }
        }
    });
}

Log.flow([Site.TITLE, 'Attempting to start engines.'], 0);
startEngine().then(r => {
    if (r) {
        server.listen(Site.PORT, async () => {
            Log.flow([Site.TITLE, 'Sucessfully started all engines.'], 0);
            Log.flow([Site.TITLE, `Running at http://127.0.0.1:${Site.PORT}`], 0);
            if (Site.PRODUCTION) {
                TelegramEngine.sendMessage(`😊 ${Site.TITLE} has woken up at ${getDateTime()}`);
            }
            proceedAfterInit();
        });
    }
    else {
        Log.flow([Site.TITLE, 'Failed to start all engines.'], 0);
        process.exit(0);
    }
});