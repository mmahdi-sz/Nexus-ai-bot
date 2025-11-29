
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from './core/setup.js';
import { registerEventHandlers } from './handlers/eventHandlers.js';
import { initializeLogging, cleanOldLogs } from './utils/logManager.js';

process.on('uncaughtException', (error, origin) => {
    console.error('--- [FATAL UNCAUGHT EXCEPTION] ---');
    console.error(error);
    console.error(origin);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('--- [FATAL UNHANDLED REJECTION] ---');
    console.error(promise);
    console.error(reason);
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_OWNER_IDS_STR = process.env.BOT_OWNER_IDS || process.env.BOT_OWNER_ID || '0';
const BOT_OWNER_IDS = BOT_OWNER_IDS_STR.split(',').map(id => parseInt(id.trim(), 10)).filter(id => id > 0);

if (!TELEGRAM_BOT_TOKEN || BOT_OWNER_IDS.length === 0) {
    console.error('FATAL ERROR: Make sure TELEGRAM_BOT_TOKEN and BOT_OWNER_IDS are in your .env file.');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10,
            offset: -1
        }
    }
});

global.bot = bot;

let botInfo = {};
let appPrompts = {};
let appConfig = {};
const userCooldowns = new Map();
const activeUsers = new Set();
const reinforcedUsersThisSession = new Set();

function startMemoryCleanupJobs() {
    const MAX_COOLDOWNS = 10000;
    const COOLDOWN_RETENTION_MS = 3600000; 

    setInterval(() => {
        if (userCooldowns.size > MAX_COOLDOWNS) {
            userCooldowns.clear();
            return;
        }

        const now = Date.now();
        const toDelete = [];
        
        for (const [userId, timestamp] of userCooldowns.entries()) {
            if (now - timestamp > COOLDOWN_RETENTION_MS) {
                toDelete.push(userId);
            }
        }
        
        toDelete.forEach(userId => {
            userCooldowns.delete(userId);
        });
    }, 600000); 

    setInterval(() => {
        const size = activeUsers.size;
        if (size > 100) {
            activeUsers.clear();
        }
    }, 120000); 

    setInterval(() => {
        reinforcedUsersThisSession.clear();
    }, 24 * 60 * 60 * 1000); 
    
    setInterval(async () => {
        await cleanOldLogs(30);
    }, 24 * 60 * 60 * 1000);
}

async function main() {
    await initializeLogging();
    
    ({ botInfo, appPrompts, appConfig } = await initializeApp(bot));
    
    startMemoryCleanupJobs();

    registerEventHandlers(bot, {
        BOT_OWNER_ID: BOT_OWNER_IDS[0],
        botInfo,
        appPrompts,
        appConfig,
        userCooldowns,
        activeUsers,
        reinforcedUsersThisSession
    });
}

bot.on('polling_error', (error) => {
    if (error.code === 'EFATAL' || error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
        console.error('[bot:polling_error] Network/Fatal Error occurred, Polling is likely recovering. Code:', error.code);
    } else {
        console.error('[bot:polling_error] Unhandled Polling Error:', error.code, '-', error.message);
    }
});

main();


