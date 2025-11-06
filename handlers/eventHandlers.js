import { promisify } from 'util';
import { exec } from 'child_process';
import * as db from '../database.js';
import { handleChatLogic, handleTelegramApiError } from '../core/chatLogic.js';
import { handleCallbackQuery } from '../adminPanel.js';
import { sendMessageSafe } from '../utils/textFormatter.js';

import { handleBackupCommand } from './commands/backup.js';
import { handleNewCommand, handleStatusCommand, handleForgetCommand, handleDonateCommand } from './commands/userCommands.js';
import { handleStatsCommand, handleClearStatesCommand, handleBroadcastCommand } from './commands/ownerCommands.js';
import { handleEnableCommand, handleNewChatMembers, initGroupLifecycle } from './groupLifecycle.js';
import { handleUserKeyDonation, handleDonationCallback } from './userKeyDonation.js';
import { handleAdminInput } from './adminInputHandler.js';
import { handleStartCommand, initStartHandler } from './startHandler.js';
import { handleGroupGuard } from '../guard/groupGuard.js';


let BOT_OWNER_ID;
let botInfo;
let userCooldowns;
let activeUsers;
let reinforcedUsersThisSession;
let appPrompts;
let appConfig;

function init(deps) {
    BOT_OWNER_ID = deps.BOT_OWNER_ID;
    botInfo = deps.botInfo;
    userCooldowns = deps.userCooldowns;
    activeUsers = deps.activeUsers;
    reinforcedUsersThisSession = deps.reinforcedUsersThisSession;
    appPrompts = deps.appPrompts;
    appConfig = deps.appConfig;
    
    initGroupLifecycle(deps);
    initStartHandler(deps);
}


async function handleHelpCommand(bot, msg) {
    if (msg.from.id === BOT_OWNER_ID) {
        const adminHelpText = await db.getText('help_admin', '**راهنمای مالک ربات**\n\n...');
        sendMessageSafe(bot, msg.chat.id, adminHelpText);
    } else {
        const userHelpTextTemplate = await db.getText('help_user', 'من آرتورم، آرتور مورگان.\n\n...');
        const userHelpText = userHelpTextTemplate.replace('{bot_username}', botInfo.username);
        sendMessageSafe(bot, msg.chat.id, userHelpText);
    }
}

function isDirectlyAddressingArthur(text) {
    const arthurKeywords = ['آرتور', 'ارتور', 'arthur', 'مورگان', 'morgan'];
    const greetingKeywords = ['سلام', 'هی', 'چطوری'];
    
    const normalizedText = text.toLowerCase().trim();
    const words = normalizedText.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return { isAddressing: false, prompt: '' };

    let isAddressing = false;
    let keywordIndex = -1;

    for (const keyword of arthurKeywords) {
        keywordIndex = words.findIndex(word => word === keyword);
        if (keywordIndex !== -1) {
            isAddressing = true;
            break;
        }
    }

    if (!isAddressing) return { isAddressing: false, prompt: '' };

    const originalWords = text.trim().split(/\s+/).filter(w => w.length > 0);
    const originalKeyword = originalWords.find(w => arthurKeywords.includes(w.toLowerCase()));
    
    const promptStartIndex = originalWords.findIndex(w => w === originalKeyword) + 1;
    
    let cleanPrompt = originalWords.slice(promptStartIndex).join(' ').trim();
    
    if (cleanPrompt.length === 0) {
         cleanPrompt = originalKeyword;
    }


    return { isAddressing: true, prompt: cleanPrompt };
}


async function handleGeneralMessage(bot, msg) {
    const userId = msg.from?.id;
    const text = msg.text;
    
    if (!userId) return;

    if (!msg.date || (Math.floor(Date.now() / 1000) - msg.date) > 120) return;

    if (msg.new_chat_members) {
        return handleNewChatMembers(bot, msg);
    }
    
    if (msg.chat.type !== 'private') {
        const guardHandled = await handleGroupGuard(bot, msg, botInfo);
        if (guardHandled) return;
    }

    let ownerState = { state: null, data: {} };
    if (userId === BOT_OWNER_ID) {
        try {
            ownerState = await db.getOwnerState(BOT_OWNER_ID);
        } catch (e) {
            console.error("Error fetching owner state, clearing state:", e);
            await db.clearOwnerState(BOT_OWNER_ID);
            const errorText = await db.getText('error_state_reset', "⚠️ وضعیت مدیریت شما بازنشانی شد. لطفاً دوباره /start را بزنید.");
            return sendMessageSafe(bot, userId, errorText);
        }
        
        if (ownerState.state !== null) {
            const handled = await handleAdminInput(bot, msg, ownerState);
            if (handled) return; 
        }
    }

    const userState = await db.getUserState(userId);
    if (userState && (userState.state === 'key_awaiting' || userState.state === 'validating')) {
        const handled = await handleUserKeyDonation(bot, msg);
        if (handled) return;
    }
    
    if (text && !text.startsWith('/') && botInfo.username) {
        
        let isDirectReply = msg.reply_to_message?.from?.id === botInfo.id;
        let isMentioned = text.includes(`@${botInfo.username}`);
        
        let { isAddressing, prompt: keywordPrompt } = isDirectlyAddressingArthur(text);
        
        let finalPrompt = '';

        if (isDirectReply || isMentioned || isAddressing) {
            
            if (isDirectReply) {
                 finalPrompt = text;
            } else if (isMentioned) {
                 finalPrompt = text.replace(`@${botInfo.username}`, '').trim();
            } else if (isAddressing) {
                 finalPrompt = keywordPrompt;
            }
            
            if (finalPrompt) {
                handleChatLogic(bot, msg, finalPrompt, { 
                    userCooldowns, 
                    activeUsers, 
                    reinforcedUsersThisSession,
                    appPrompts, 
                    appConfig   
                });
            }
        }
    }
}

async function handleCallbackQueryWrapper(bot, callbackQuery) {
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (userId === BOT_OWNER_ID) {
        return handleCallbackQuery(bot, callbackQuery);
    }
    
    try {
        if (data.startsWith('donate_')) {
            return handleDonationCallback(bot, callbackQuery);
        }
        
        if (data === 'user_show_api_guide' || data === 'user_submit_key_start') {
             await bot.answerCallbackQuery(callbackQuery.id, { text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.') });
             return;
        }

        await bot.answerCallbackQuery(callbackQuery.id, { text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.'), show_alert: true });

    } catch (error) {
        console.error("Error in user callback_query handler:", error);
        bot.answerCallbackQuery(callbackQuery.id, { text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.'), show_alert: true });
    }
}


export function registerEventHandlers(bot, deps) {
    init(deps);
    
    bot.onText(/\/start(?: (.+))?/, (msg, match) => handleStartCommand(bot, msg, match));
    bot.onText(/\/enable/, (msg) => handleEnableCommand(bot, msg));
    bot.onText(/\/help/, (msg) => handleHelpCommand(bot, msg));
    
    bot.onText(/\/new/, (msg) => handleNewCommand(bot, msg));
    bot.onText(/\/status/, (msg) => handleStatusCommand(bot, msg));
    bot.onText(/\/forget/, (msg) => handleForgetCommand(bot, msg));
    bot.onText(/\/donate/, (msg) => handleDonateCommand(bot, msg));

    bot.onText(/\/stats/, (msg) => handleStatsCommand(bot, msg));
    bot.onText(/\/clearstates/, (msg) => handleClearStatesCommand(bot, msg));
    bot.onText(/\/broadcast/, (msg) => handleBroadcastCommand(bot, msg));
    bot.onText(/\/backup/, (msg) => handleBackupCommand(bot, msg)); 

    bot.on('message', (msg) => handleGeneralMessage(bot, msg));

    bot.on('callback_query', (callbackQuery) => handleCallbackQueryWrapper(bot, callbackQuery));
}