
import * as db from '../database.js';
import * as keyPoolManager from '../keyPoolManager.js';
import * as outputFilter from '../outputFilter.js';
import * as limitManager from '../limitManager.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { apiService } from '../modules/apiService.js';

const REINFORCE_EVERY_N_TURNS = 12;
const MAX_HISTORY_BYTES = 50000; 
const MAX_SAFE_TURNS = 30; 

const calculateHistorySize = (history) => {
    return JSON.stringify(history).length;
};

export function handleTelegramApiError(error, context) {
    console.log(`[chatLogic:handleTelegramApiError] START (Context: ${context})`);
    if (error.code === 'ETELEGRAM') {
        const errorCode = error.response?.body?.error_code;
        const description = error.response?.body?.description || 'No description';
        if (errorCode === 403 || errorCode === 400 || description.includes('blocked') || description.includes('kicked')) {
            console.warn(`[chatLogic:handleTelegramApiError] Blocked/Kicked by user/group in ${context}: ${description}`);
            return true;
        }
    }
    console.error(`[chatLogic:handleTelegramApiError] Unhandled error in ${context}:`, error.message);
    return false;
}

export async function checkPrivateChatStatus(bot, userId) {
    try {
        await bot.sendChatAction(userId, 'typing');
        return { isBlocked: false };
    } catch (error) {
        if (error.code === 'ETELEGRAM' && (error.response?.body?.error_code === 403 || error.response?.body?.description?.includes('bot was blocked by the user'))) {
            return { isBlocked: true };
        }
        return { isBlocked: false };
    }
}

export async function handleChatLogic(bot, msg, userPrompt, deps) {
    console.log(`[chatLogic:handleChatLogic] START (User: ${msg.from.id}, Chat: ${msg.chat.id})`);
    const { userCooldowns, activeUsers, reinforcedUsersThisSession, appPrompts, appConfig } = deps;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const cache = db.getAppCache();
    if (msg.chat.type !== 'private' && !cache.authorizedChats.has(chatId)) {
        console.log(`[chatLogic:handleChatLogic] END - Chat ID ${chatId} not authorized.`);
        return;
    }

    if (activeUsers.has(userId)) {
        const cooldownMessage = await db.getText('chat_cooldown', "صبر کن رفیق! دارم به سوال قبلی خودت فکر می‌کنم. یکی یکی!");
        sendMessageSafe(bot, chatId, cooldownMessage, { reply_to_message_id: msg.message_id })
            .catch(err => handleTelegramApiError(err, 'handleChatLogic - active user message'));
        return;
    }

    const limitCheck = await limitManager.checkUserLimit(userId, appConfig);
    
    if (limitCheck.requiresPrivateChatCheck) {
         const { isBlocked } = await checkPrivateChatStatus(bot, userId);
         if (isBlocked) {
            const requiredMessage = await db.getText('private_chat_required_message', "لطفاً برای ادامه چت، ربات را در چت خصوصی استارت/آنبلاک کنید.");
            const requiredButton = await limitManager.createPrivateChatRequiredButton();
            return sendMessageSafe(bot, 
                chatId,
                requiredMessage,
                {
                    reply_to_message_id: msg.message_id,
                    reply_markup: requiredButton,
                    parse_mode: 'Markdown'
                }
            ).catch(err => handleTelegramApiError(err, 'handleChatLogic - private chat required message'));
         }
    }

    if (!limitCheck.allowed) {
        const hasNotified = await db.hasReceivedLimitMessage(userId, 'day');
        
        if (!hasNotified) {
            const limitMessageTemplate = await db.getText('limit_message_day', "محدودیت روزانه...");
            const helpButton = await limitManager.createAPIRequestButton();
            
            await db.markLimitMessageSent(userId, 'day');
            
            console.log(`[chatLogic:handleChatLogic] END - User ${userId} hit daily limit (Sending notification).`);
            return sendMessageSafe(bot, chatId, limitMessageTemplate, {
                reply_to_message_id: msg.message_id,
                reply_markup: helpButton,
                parse_mode: 'Markdown'
            });
        }
        
        console.log(`[chatLogic:handleChatLogic] END - User ${userId} hit daily limit (Already notified).`);
        return;
    }

    const isPremium = limitCheck.isPremium || limitCheck.isOwner;

    activeUsers.add(userId);
    let placeholder;
    const thinkingText = await db.getText('error_thinking', "آرتور داره فکر می‌کنه...");

    try {
        placeholder = await bot.sendMessage(chatId, thinkingText, { reply_to_message_id: msg.message_id });
        
        await db.logUserMessage(userId, chatId);

        let history = await db.getDailyConversation(chatId, userId);
        if (!Array.isArray(history)) history = [];
        
        let finalSystemInstruction = appPrompts.getSystemInstruction();

        const userTone = await db.getUserTone(userId);
        if (userTone === 'rude') {
            finalSystemInstruction += `\n\n--- TONE OVERRIDE: RUDE MODE ACTIVATED ---
You must now speak in an extremely direct, crude, and unfiltered manner. Use profanity freely and don't hold back. Examples:
- "داش، چرا اینقد کصشعر میگی؟"
- "برو بابا، تخمم هم نیست"
- "خفه شو دیگه، کلافه شدم"
- "حالا چیکار کنم؟ برات گل بریزم؟"
Be brutally honest and don't sugarcoat anything. This is what the user explicitly requested.`;
        }

        const specialUser = await db.getSpecialUser(userId);
        if (specialUser) {
            finalSystemInstruction += `\n\n--- SPECIAL INSTRUCTIONS FOR THIS USER ---\nYou are now talking to ${specialUser.display_name}. Your behavior towards them must be guided by the following rule:\n${specialUser.prompt}`;
        }

        const memory = await db.getUserMemory(userId);
        if (memory?.summary) {
            finalSystemInstruction += `\n\n--- THINGS I REMEMBER ABOUT THIS PERSON ---\n${memory.summary}`;
        }

        let historyForAPI = [...history];
        const conversationTurns = history.filter(h => h.role === 'user').length;
        const reinjectPromptEvery = appConfig.reinjectPromptEvery || REINFORCE_EVERY_N_TURNS;
        const needsPeriodicReinforcement = conversationTurns > 0 && conversationTurns % reinjectPromptEvery === 0;
        const needsReinforcement = !reinforcedUsersThisSession.has(userId) || history.length === 0 || needsPeriodicReinforcement;

        if (needsReinforcement) {
            historyForAPI.unshift(outputFilter.modelAck);
            historyForAPI.unshift(outputFilter.reinforcementPrompt);
            reinforcedUsersThisSession.add(userId);
        }

        const result = await apiService.generateResponse({
            systemInstruction: finalSystemInstruction,
            history: historyForAPI,
            prompt: userPrompt
        });

        let arthurResponse;
        if (result.filtered) {
            arthurResponse = await db.getText('error_general', "محتوا فیلتر شد.");
        } else {
            arthurResponse = result.text;
        }

        if (result.metadata?.totalTokenCount) {
             const tokenCount = result.metadata.totalTokenCount;
             console.log(`[chatLogic:handleChatLogic] Token usage: ${tokenCount}`);
             // Note: Actual key ID tracking would require apiService to return it or handle increment internally. 
             // Assuming key ID is abstracted away, global stats can still be tracked if db structure supports it.
        }

        if (!arthurResponse) arthurResponse = await db.getText('error_general', "خطای پردازش.");

        let historyToSave = [...history];
        historyToSave.push(
            { role: "user", parts: [{ text: userPrompt }] },
            { role: "model", parts: [{ text: arthurResponse.substring(0, 4000) }] }
        );
        
        const safeTurns = Math.min(appConfig.maxHistoryTurns || 10, MAX_SAFE_TURNS);
        const maxFinalLength = (safeTurns * 2);
        while (historyToSave.length > maxFinalLength || calculateHistorySize(historyToSave) > MAX_HISTORY_BYTES) {
             historyToSave.splice(0, 2); 
        }

        await db.saveDailyConversation(chatId, userId, historyToSave);

        const globalButton = cache.globalSettings.global_button;
        const isChatSpecial = await db.isSpecialChat(chatId);
        const buttonEnabled = cache.globalSettings.global_button_enabled;

        const telegramOptions = {
            chat_id: chatId,
            message_id: placeholder.message_id,
            parse_mode: 'Markdown'
        };

        const hasValidButton = buttonEnabled && 
                                globalButton && 
                                !isChatSpecial &&
                                typeof globalButton.text === 'string' && globalButton.text.trim().length > 0 &&
                                typeof globalButton.url === 'string' && globalButton.url.trim().length > 0;
        
        if (hasValidButton) {
            telegramOptions.reply_markup = { inline_keyboard: [[{ text: globalButton.text, url: globalButton.url }]] };
        }

        try {
            await bot.editMessageText(arthurResponse, telegramOptions);
        } catch (telegramError) {
            if (telegramError.response && telegramError.response.body.description.includes("can't parse entities")) {
                const plainTextOptions = { ...telegramOptions };
                delete plainTextOptions.parse_mode;
                await bot.editMessageText(arthurResponse, plainTextOptions).catch(err => handleTelegramApiError(err, 'handleChatLogic - final response fallback'));
            } else {
                throw telegramError;
            }
        }

    } catch (error) {
        if (error.code === 'ETELEGRAM' && (error.response?.body?.description.includes('bot was kicked') || error.response?.body?.description.includes('chat not found') || error.response?.body?.description.includes('blocked'))) {
            await db.purgeChatData(chatId); 
            return;
        }
        console.error(`[chatLogic:handleChatLogic] Error:`, error.message);
        
        let errorMessage = await db.getText('error_general', "خطای عمومی");
        if (placeholder) {
            bot.editMessageText(errorMessage, { chat_id: chatId, message_id: placeholder.message_id }).catch(err => handleTelegramApiError(err, 'handleChatLogic - error message'));
        }
    } finally {
        activeUsers.delete(userId);
    }
}


