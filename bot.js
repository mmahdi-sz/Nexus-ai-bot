import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from './core/setup.js';
import { registerEventHandlers } from './handlers/eventHandlers.js';

process.on('uncaughtException', (error, origin) => {
    console.error('--- [FATAL UNCAUGHT EXCEPTION] ---');
    console.error(`Caught exception:`, error);
    console.error(`Exception origin:`, origin);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('--- [FATAL UNHANDLED REJECTION] ---');
    console.error('Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

if (!TELEGRAM_BOT_TOKEN || !BOT_OWNER_ID) {
    console.error('FATAL ERROR: Make sure TELEGRAM_BOT_TOKEN and BOT_OWNER_ID are in your .env file.');
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

let botInfo = {};
let appPrompts = {};
let appConfig = {};
const userCooldowns = new Map();
const activeUsers = new Set();
const reinforcedUsersThisSession = new Set();

function startMemoryCleanupJobs() {
    console.log('[bot:startMemoryCleanupJobs] START - Scheduling cleanup jobs.');
    
    const MAX_COOLDOWNS = 10000;
    const COOLDOWN_RETENTION_MS = 3600000; 

    setInterval(() => {
        if (userCooldowns.size > MAX_COOLDOWNS) {
            console.warn(`[bot:cleanup] userCooldowns size (${userCooldowns.size}) exceeded limit of ${MAX_COOLDOWNS}. Clearing all entries.`);
            userCooldowns.clear();
            return;
        }

        const now = Date.now();
        let cleanedCount = 0;
        const toDelete = [];
        
        for (const [userId, timestamp] of userCooldowns.entries()) {
            if (now - timestamp > COOLDOWN_RETENTION_MS) {
                toDelete.push(userId);
            }
        }
        
        toDelete.forEach(userId => {
            userCooldowns.delete(userId);
            cleanedCount++;
        });

        if (cleanedCount > 0) {
            console.log(`[bot:cleanup] Removed ${cleanedCount} old entries from userCooldowns. Remaining: ${userCooldowns.size}`);
        }
    }, 600000); 

    setInterval(() => {
        const size = activeUsers.size;
        if (size > 100) {
            activeUsers.clear();
            console.warn(`[bot:cleanup] activeUsers size exceeded 100 (${size}), clearing all stale entries.`);
        }
    }, 120000); 

    setInterval(() => {
        reinforcedUsersThisSession.clear();
        console.log('[bot:startMemoryCleanupJobs] reinforcedUsersThisSession cleared for the new day.');
    }, 24 * 60 * 60 * 1000); 
    
    console.log('[bot:startMemoryCleanupJobs] END - All cleanup jobs scheduled successfully.');
}


async function main() {
    console.log('[bot:main] START - Initializing application.');
    ({ botInfo, appPrompts, appConfig } = await initializeApp(bot));
    
    startMemoryCleanupJobs();

    registerEventHandlers(bot, {
        BOT_OWNER_ID,
        botInfo,
        appPrompts,
        appConfig,
        userCooldowns,
        activeUsers,
        reinforcedUsersThisSession
    });

    console.log(`[bot:main] Arthur Morgan (${botInfo.username}) is ready to ride.`);
    console.log('[bot:main] END - Application fully initialized.');
}

bot.on('polling_error', (error) => {
    if (error.code === 'EFATAL' || error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
        console.error('[bot:polling_error] Network/Fatal Error occurred, Polling is likely recovering. Code:', error.code);
    } else {
        console.error('[bot:polling_error] Unhandled Polling Error:', error.code, '-', error.message);
    }
});

main();