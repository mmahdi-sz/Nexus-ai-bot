import cron from 'node-cron';
import * as db from '../database.js';
import { prompts, filters } from '../prompts.js';
import * as security from '../security.js';
import * as keyPoolManager from '../keyPoolManager.js';
import * as memoryManager from '../memoryManager.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

let appConfig = {
    cooldownSeconds: 5,
    maxHistoryTurns: 10,
    reinjectPromptEvery: 25,
    userLimits: {
        day: 26
    },
    keyDailyRequestLimit: 800,
    keyDailyTokenLimit: 700000
};
let appPrompts = prompts;
let appFilters = filters;
let botInfo = {};

async function setCommandMenu(bot) {
    console.log('[setup:setCommandMenu] START - Setting bot commands.');
    try {
        const privateCommands = [
            { command: 'start', description: 'من آرتورم، آرتور مورگان. کاری داشتی؟' },
            { command: 'help', description: 'راهنمای استفاده از بات' },
            { command: 'new', description: 'شروع مکالمه جدید' },
            { command: 'status', description: 'وضعیت و آمار پیام‌های من' },
            { command: 'forget', description: 'فراموش کردن حافظه من' },
            { command: 'donate', description: 'اهدای کلید API برای استفاده نامحدود' }
        ];

        const groupCommands = [
            { command: 'enable', description: 'فعال‌سازی آرتور در این گروه' },
            { command: 'new', description: 'شروع مکالمه جدید در گروه' },
            { command: 'status', description: 'وضعیت و آمار پیام‌های من' }
        ];

        const ownerCommands = [
            { command: 'start', description: 'ورود به پنل مدیریت آرتور' },
            { command: 'stats', description: '📊 آمار کامل بات' },
            { command: 'broadcast', description: '📢 ارسال پیام همگانی' },
            { command: 'backup', description: '💾 پشتیبان‌گیری از دیتابیس' },
            { command: 'clearstates', description: '🗑️ پاکسازی وضعیت کاربران' },
            { command: 'help', description: 'راهنمای دستورات ادمین' }
        ];

        await bot.setMyCommands(privateCommands, {
            scope: { type: 'all_private_chats' }
        });

        await bot.setMyCommands(groupCommands, {
            scope: { type: 'all_group_chats' }
        });

        await bot.setMyCommands(ownerCommands, {
            scope: {
                type: 'chat',
                chat_id: BOT_OWNER_ID
            }
        });

        console.log('[setup:setCommandMenu] END - Bot command menu set successfully.');
    } catch (error) {
        console.error('❌ [setup:setCommandMenu] Failed to set bot commands:', error.message);
    }
}


async function loadApiKeys() {
    console.log('[setup:loadApiKeys] START - Loading API keys from DB.');
    keyPoolManager.resetKeyPool();
    const keysFromDb = await db.getAllApiKeys();
    for (const k of keysFromDb) {
        const decryptedKey = security.decrypt(k.encrypted_key);
        if (!decryptedKey) {
            console.warn(`[setup:loadApiKeys] Failed to decrypt key ID ${k.id}. Skipping.`);
            continue;
        }
        keyPoolManager.addApiKeyToPool(decryptedKey, k.id);
    }
    console.log(`[setup:loadApiKeys] END - Loaded ${keysFromDb.length} API keys into the pool.`);
}

async function loadInitialCache() {
    console.log('[setup:loadInitialCache] START - Loading initial cache from DB.');
    
    const authorizedChatsRows = await db.dbQuery("SELECT chat_id FROM chats WHERE is_enabled = 1");
    const authorizedChats = new Set(authorizedChatsRows.map(row => row.chat_id));

    const settingsKeys = ['global_button', 'global_button_enabled'];
    const globalSettings = {};
    for (const key of settingsKeys) {
        globalSettings[key] = await db.getSetting(key, null);
    }

    db.setAppCache({
        authorizedChats: authorizedChats,
        globalSettings: globalSettings
    });

    console.log(`[setup:loadInitialCache] END - Cached ${authorizedChats.size} authorized chats and ${Object.keys(globalSettings).length} settings.`);
}

async function startCronJobs() {
    console.log('[setup:startCronJobs] START - Scheduling cron jobs.');
    cron.schedule('0 2 * * *', () => {
        console.log('[setup:startCronJobs:cron] --- Running Scheduled Daily Memory Processing Job (Iran Time) ---');
        memoryManager.processAndSummarizeDailyLogs().catch(error => {
            console.error('[setup:startCronJobs:cron] An error occurred during the scheduled memory processing job:', error);
        });
    }, {
        scheduled: true,
        timezone: "Asia/Tehran"
    });
    
    keyPoolManager.scheduleKeyUsageReset();

    console.log('[setup:startCronJobs] END - Cron jobs scheduled.');
}

export async function initializeApp(bot) {
    console.log('[setup:initializeApp] START - Full application initialization.');
    await db.initDb();
    await loadInitialCache();
    await loadApiKeys();
    
    try {
        const me = await bot.getMe();
        botInfo = me;
        process.env.BOT_USERNAME = me.username;
        process.env.BOT_ID = me.id.toString(); 
        console.log(`[setup:initializeApp] Bot Info loaded (Username: ${me.username}).`);
    } catch (error) {
        console.error('❌ [setup:initializeApp] Failed to get bot info. Is the token correct?', error.message);
        process.exit(1);
    }

    await setCommandMenu(bot);
    await startCronJobs();

    const savedPromptsData = await db.getSetting('prompts', prompts);
    if (savedPromptsData && savedPromptsData.system) {
        appPrompts.system = { 
            ...prompts.system, 
            ...savedPromptsData.system,
            identity: {...prompts.system.identity, ...savedPromptsData.system.identity},
            tone: {...prompts.system.tone, ...savedPromptsData.system.tone},
            opinions: {...prompts.system.opinions, ...savedPromptsData.system.opinions},
            rules: {...prompts.system.rules, ...savedPromptsData.system.rules},
            specialChats: {...prompts.system.specialChats, ...savedPromptsData.system.specialChats} 
        };
        console.log('[setup:initializeApp] Prompts loaded and merged from DB.');
    }

    appFilters = await db.getSetting('filters', filters) || filters;
    
    const loadedConfig = await db.getSetting('config', appConfig) || {};
    appConfig = {
        ...appConfig, 
        ...loadedConfig,
        userLimits: {
            ...appConfig.userLimits,
            ...(loadedConfig.userLimits || {})
        }
    };
    console.log('[setup:initializeApp] Configuration loaded and merged from DB.');
    
    console.log('[setup:initializeApp] END - Initialization complete.');
    return { botInfo, appPrompts, appConfig };
}