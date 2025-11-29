
import { promisify } from 'util';
import { exec } from 'child_process';
import * as db from '../database.js';
import { handleChatLogic, handleTelegramApiError } from '../core/chatLogic.js';
import { handleCallbackQuery } from '../adminPanel.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { isOwner } from '../utils/ownerCheck.js';
import { apiService } from '../modules/apiService.js';

import { handleBackupCommand } from './commands/backup.js';
import { handleNewCommand, handleStatusCommand, handleForgetCommand, handleDonateCommand, handleUserCommand, handleToneCommand, handleRefreshMemoryCommand } from './commands/userCommands.js';
import { handleStatsCommand, handleClearStatesCommand, handleBroadcastCommand, handleResetPromptsCommand } from './commands/ownerCommands.js';
import { handleEnableCommand, handleNewChatMembers, initGroupLifecycle } from './groupLifecycle.js';
import { handleUserKeyDonation, handleDonationCallback } from './userKeyDonation.js';
import { handleAdminInput } from './adminInputHandler.js';
import { handleStartCommand, initStartHandler } from './startHandler.js';
import { handleGroupGuard } from '../guard/groupGuard.js';
import { handleUserPanelCallback, handleUserMemoryInput } from './userPanel.js';

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
    if (isOwner(msg.from.id)) {
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
    const normalizedText = text.toLowerCase().trim();
    const words = normalizedText.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return { isAddressing: false, prompt: '' };

    let isAddressing = false;
    for (const keyword of arthurKeywords) {
        if (words.includes(keyword)) {
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

const groupMessageCounters = new Map();

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

        const chatId = msg.chat.id;
        if (!groupMessageCounters.has(chatId)) {
            groupMessageCounters.set(chatId, 0);
        }

        const counter = groupMessageCounters.get(chatId) + 1;
        groupMessageCounters.set(chatId, counter);

        if (counter >= Math.floor(Math.random() * 11) + 10) {
            groupMessageCounters.set(chatId, 0);
            const messageText = msg.text || msg.caption || '';
            if (messageText.length > 10) {
                const contextPrompt = `این پیام از گروه: "${messageText}"\n\nیک نظر کوتاه و جذاب درباره این پیام بده و با کاربر صحبت کن.`;
                handleChatLogic(bot, msg, contextPrompt, { userCooldowns, activeUsers, reinforcedUsersThisSession, appPrompts, appConfig });
                return;
            }
        }
    }

    let ownerState = { state: null, data: {} };
    if (isOwner(userId)) {
        try {
            ownerState = await db.getOwnerState(userId);
        } catch (e) {
            await db.clearOwnerState(userId);
            return sendMessageSafe(bot, userId, await db.getText('error_state_reset', "خطا"));
        }
        
        if (ownerState.state !== null) {
            const handled = await handleAdminInput(bot, msg, ownerState);
            if (handled) return;
        }
    }

    const userState = await db.getUserState(userId);
    if (userState && userState.state === 'user_editing_memory') {
        const handled = await handleUserMemoryInput(bot, msg, userState);
        if (handled) return;
    }

    if (userState && (userState.state === 'key_awaiting' || userState.state === 'validating')) {
        const handled = await handleUserKeyDonation(bot, msg);
        if (handled) return;
    }
    
    if (text && !text.startsWith('/') && botInfo.username) {
        const botIdMention = `@${botInfo.id}`;
        const isAIMode = text.startsWith(botIdMention + ' ');
        
        if (isAIMode) {
            const aiPrompt = text.replace(botIdMention, '').trim();
            if (aiPrompt.length > 0) {
                const placeholder = await bot.sendMessage(msg.chat.id, "⏳ در حال پردازش...", { reply_to_message_id: msg.message_id });
                try {
                    const result = await apiService.generateResponse({
                        systemInstruction: "You are a helpful AI assistant. Respond in Persian.",
                        history: [],
                        prompt: aiPrompt
                    });
                    const response = result.filtered ? "محتوا فیلتر شد." : result.text || "خطا در پردازش";
                    await bot.editMessageText(response, { chat_id: msg.chat.id, message_id: placeholder.message_id, parse_mode: 'Markdown' });
                } catch (error) {
                    await bot.editMessageText("❌ خطا در پردازش درخواست.", { chat_id: msg.chat.id, message_id: placeholder.message_id });
                }
            }
            return;
        }

        let isDirectReply = msg.reply_to_message?.from?.id === botInfo.id;
        let isMentioned = text.includes(`@${botInfo.username}`);
        let { isAddressing, prompt: keywordPrompt } = isDirectlyAddressingArthur(text);
        let finalPrompt = '';

        if (isDirectReply || isMentioned || isAddressing) {
            if (isDirectReply) {
                const replyText = msg.reply_to_message.text || '';
                finalPrompt = `[پیام من قبلی]: ${replyText}\n\n[پاسخ کاربر]: ${text}`;
            } else if (isMentioned) {
                finalPrompt = text.replace(`@${botInfo.username}`, '').trim();
            } else if (isAddressing) {
                finalPrompt = keywordPrompt;
            }
            
            if (finalPrompt) {
                handleChatLogic(bot, msg, finalPrompt, { userCooldowns, activeUsers, reinforcedUsersThisSession, appPrompts, appConfig });
            }
        }
    }
}

async function handleCallbackQueryWrapper(bot, callbackQuery) {
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (data === 'noop') {
        await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
        return;
    }

    const isUserFeature = data.startsWith('tone_') || 
                          data.startsWith('donate_') || 
                          data.startsWith('user_') || 
                          data === 'user_show_api_guide' || 
                          data === 'user_submit_key_start';

    const isOwnerFeature = isOwner(userId) && !isUserFeature;

    if (isOwnerFeature) {
        return handleCallbackQuery(bot, callbackQuery);
    }
    
    try {
        if (data.startsWith('tone_set_')) {
            const tone = data.replace('tone_set_', '');
            await db.setUserTone(userId, tone);
            
            const toneText = tone === 'rude' ? 'بی‌ادب و فحش‌دار' : 'با ادب و مشتی';
            await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ لحن به "${toneText}" تغییر کرد` });
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: tone === 'rude' ? '✅ بی‌ادب و فحش‌دار' : '⚪️ بی‌ادب و فحش‌دار', callback_data: 'tone_set_rude' }],
                    [{ text: tone === 'polite' ? '✅ با ادب و مشتی' : '⚪️ با ادب و مشتی', callback_data: 'tone_set_polite' }]
                ]
            };
            
            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id
            }).catch(() => {});
            return;
        }

        if (data.startsWith('donate_')) {
            return handleDonationCallback(bot, callbackQuery);
        }
        
        if (data.startsWith('user_')) {
            return handleUserPanelCallback(bot, callbackQuery);
        }
        
        if (data === 'user_show_api_guide' || data === 'user_submit_key_start') {
             await bot.answerCallbackQuery(callbackQuery.id, { text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.') });
             return;
        }

        await bot.answerCallbackQuery(callbackQuery.id, { 
            text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.'), 
            show_alert: false 
        });

    } catch (error) {
        console.error("[eventHandlers:handleCallbackQueryWrapper] Error:", error);
        bot.answerCallbackQuery(callbackQuery.id, { 
            text: await db.getText('error_callback', 'یه مشکلی پیش اومد، دوباره تلاش کن.'), 
            show_alert: true 
        }).catch(() => {});
    }
}

export function registerEventHandlers(bot, deps) {
    init(deps);
    
    bot.onText(/\/start(?: (.+))?/, (msg, match) => handleStartCommand(bot, msg, match));
    bot.onText(/\/enable/, (msg) => handleEnableCommand(bot, msg));
    bot.onText(/\/help/, (msg) => handleHelpCommand(bot, msg));
    bot.onText(/\/user/, (msg) => handleUserCommand(bot, msg));
    
    bot.onText(/\/new/, (msg) => handleNewCommand(bot, msg));
    bot.onText(/\/status/, (msg) => handleStatusCommand(bot, msg));
    bot.onText(/\/forget/, (msg) => handleForgetCommand(bot, msg));
    bot.onText(/\/donate/, (msg) => handleDonateCommand(bot, msg));
    bot.onText(/\/tone/, (msg) => handleToneCommand(bot, msg));
    bot.onText(/\/memory/, (msg) => handleRefreshMemoryCommand(bot, msg));

    bot.onText(/\/stats/, (msg) => handleStatsCommand(bot, msg));
    bot.onText(/\/clearstates/, (msg) => handleClearStatesCommand(bot, msg));
    bot.onText(/\/broadcast/, (msg) => handleBroadcastCommand(bot, msg));
    bot.onText(/\/backup/, (msg) => handleBackupCommand(bot, msg));
    bot.onText(/\/resetprompts/, (msg) => handleResetPromptsCommand(bot, msg));

    bot.on('message', (msg) => handleGeneralMessage(bot, msg));

    bot.on('callback_query', (callbackQuery) => handleCallbackQueryWrapper(bot, callbackQuery));
}


