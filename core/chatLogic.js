import * as db from '../database.js';
import * as keyPoolManager from '../keyPoolManager.js';
import * as outputFilter from '../outputFilter.js';
import * as limitManager from '../limitManager.js';
import { sendMessageSafe, editMessageSafe } from '../utils/textFormatter.js';
import { generateResponseWithFallback, safetySettings, groundingTool, getUsageMetadata } from './geminiApi.js';

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
        if (errorCode === 403 || errorCode === 400) {
            console.warn(`[chatLogic:handleTelegramApiError] Handled recoverable error in ${context}: ${description}`);
            console.log(`[chatLogic:handleTelegramApiError] END - Recoverable error.`);
            return true;
        }
    }
    console.error(`[chatLogic:handleTelegramApiError] Unhandled error in ${context}:`, error.message);
    console.log(`[chatLogic:handleTelegramApiError] END - Unhandled error.`);
    return false;
}

export async function checkPrivateChatStatus(bot, userId) {
    try {
        await bot.sendChatAction(userId, 'typing');
        return { isBlocked: false };
    } catch (error) {
        if (error.code === 'ETELEGRAM' && (error.response?.body?.error_code === 403 || error.response?.body?.description?.includes('bot was blocked by the user'))) {
            console.log(`[chatLogic:checkPrivateChatStatus] User ${userId} has blocked the bot.`);
            return { isBlocked: true };
        }
        console.warn(`[chatLogic:checkPrivateChatStatus] Warning: Failed to send chat action to ${userId}. Assuming unblocked but with error: ${error.message}`);
        return { isBlocked: false };
    }
}

export async function handleChatLogic(bot, msg, userPrompt, deps) {
    console.log(`[chatLogic:handleChatLogic] START (User: ${msg.from.id}, Chat: ${msg.chat.id}, Prompt: ${userPrompt.substring(0, 50)}...)`);
    const { userCooldowns, activeUsers, reinforcedUsersThisSession, appPrompts, appConfig } = deps;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Optimized: Use cache for chat authorization check
    const cache = db.getAppCache();
    if (msg.chat.type !== 'private' && !cache.authorizedChats.has(chatId)) {
        console.log(`[chatLogic:handleChatLogic] END - Chat ID ${chatId} not authorized (from cache).`);
        return;
    }

    if (activeUsers.has(userId)) {
        const cooldownMessage = await db.getText('chat_cooldown', "صبر کن رفیق! دارم به سوال قبلی خودت فکر می‌کنم. یکی یکی!");
        sendMessageSafe(bot, chatId, cooldownMessage, { reply_to_message_id: msg.message_id })
            .catch(err => handleTelegramApiError(err, 'handleChatLogic - active user message'));
        console.log(`[chatLogic:handleChatLogic] END - User ${userId} is already active.`);
        return;
    }

    let keyObject = null;
    let isPremium = false;

    const limitCheck = await limitManager.checkUserLimit(userId, appConfig);
    
    if (limitCheck.requiresPrivateChatCheck) {
         const { isBlocked } = await checkPrivateChatStatus(bot, userId);
         if (isBlocked) {
            const requiredMessage = await db.getText('private_chat_required_message', "لطفاً برای ادامه چت، ربات را در چت خصوصی استارت/آنبلاک کنید.");
            const requiredButton = await limitManager.createPrivateChatRequiredButton();
            console.log(`[chatLogic:handleChatLogic] END - User ${userId} hit 5-message limit and is blocked in private chat.`);
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
        let limitKey = 'limit_message_day';
        if (limitCheck.type === 'week') limitKey = 'limit_message_week';
        else if (limitCheck.type === 'month') limitKey = 'limit_message_month';
        
        const limitMessageTemplate = await db.getText(limitKey, "هی رفیق، می‌تونی با اهدای یک کلید API، بدون محدودیت باهام حرف بزنی. روی دکمه زیر بزن تا راهنماییت کنم 🤠");

        const usageText = `\n\n\\- امروز: ${limitCheck.usage.day.used}\\/${limitCheck.usage.day.limit}\n\\- این هفته: ${limitCheck.usage.week.used}\\/${limitCheck.usage.week.limit}\n\\- این ماه: ${limitCheck.usage.month.used}\\/${limitCheck.usage.month.limit}`;
        const finalLimitMessage = limitMessageTemplate + usageText;
        const helpButton = await limitManager.createAPIRequestButton();
        
        console.log(`[chatLogic:handleChatLogic] END - User ${userId} hit limit: ${limitCheck.type}.`);
        return sendMessageSafe(bot, 
            chatId,
            finalLimitMessage,
            {
                reply_to_message_id: msg.message_id,
                reply_markup: helpButton,
                parse_mode: 'Markdown'
            }
        ).catch(err => handleTelegramApiError(err, 'handleChatLogic - limit message'));
    }

    isPremium = limitCheck.isPremium || limitCheck.isOwner;
    console.log(`[chatLogic:handleChatLogic] User ${userId} isPremium: ${isPremium}`);


    const now = Date.now();
    if (!isPremium && now - (userCooldowns.get(userId) || 0) < appConfig.cooldownSeconds * 1000) {
        console.log(`[chatLogic:handleChatLogic] END - User ${userId} is in cooldown (${appConfig.cooldownSeconds}s).`);
        return;
    }
    userCooldowns.set(userId, now);

    keyObject = await keyPoolManager.getAvailableKeyInstance(appConfig);
    if (!keyObject) {
        const overloadMessage = await db.getText('overload_error_message', "هی رفیق مغزم ترکیده خیلی صحبت کردم ۱ ساعت دیگه تست کن");
        sendMessageSafe(bot, chatId, overloadMessage, { reply_to_message_id: msg.message_id })
            .catch(err => handleTelegramApiError(err, 'handleChatLogic - no key message'));
        console.log(`[chatLogic:handleChatLogic] END - No available API key.`);
        return;
    }

    activeUsers.add(userId);
    const keyInstance = keyObject.instance;
    let placeholder;
    const thinkingText = await db.getText('error_thinking', "آرتور داره فکر می‌کنه...");

    try {
        console.log(`[chatLogic:handleChatLogic] User ${userId} added to activeUsers. Key ID: ${keyObject.id}`);
        
        const reinforcementText = outputFilter.reinforcementPrompt.parts[0].text;
        const modelAckText = outputFilter.modelAck.parts[0].text;
        
        const replyOptions = { reply_to_message_id: msg.message_id };
        try {
            placeholder = await bot.sendMessage(chatId, thinkingText, replyOptions);
            console.log(`[chatLogic:handleChatLogic] Sent placeholder message: ${placeholder.message_id}`);
        } catch (err) {
            if (err.response?.body?.description.includes('message to be replied not found')) {
                placeholder = await bot.sendMessage(chatId, thinkingText);
                console.log(`[chatLogic:handleChatLogic] Sent placeholder message without reply: ${placeholder.message_id}`);
            } else {
                throw err;
            }
        }
        
        await db.logUserMessage(userId, chatId);

        let history = await db.getDailyConversation(chatId, userId);
        
        if (!Array.isArray(history)) {
            if (history && typeof history === 'object' && Object.keys(history).length > 0) {
                history = Object.values(history); 
            } else {
                console.warn(`[chatLogic:handleChatLogic] Invalid history format for chat ${chatId}, user ${userId}. Resetting to empty array.`);
                history = [];
            }
        }  
        console.log(`[chatLogic:handleChatLogic] Loaded history has ${history.length} parts.`);
        
        let finalSystemInstruction = appPrompts.getSystemInstruction();

        const specialUser = await db.getSpecialUser(userId);
        if (specialUser) {
            finalSystemInstruction += `\n\n--- SPECIAL INSTRUCTIONS FOR THIS USER ---\nYou are now talking to ${specialUser.display_name}. Your behavior towards them must be guided by the following rule:\n${specialUser.prompt}`;
            console.log(`[chatLogic:handleChatLogic] Added special user prompt for ${specialUser.display_name}.`);
        }

        const memory = await db.getUserMemory(userId);
        if (memory && memory.summary) {
            finalSystemInstruction += `\n\n--- THINGS I REMEMBER ABOUT THIS PERSON ---\n${memory.summary}`;
            console.log(`[chatLogic:handleChatLogic] Added user memory (Length: ${memory.summary.length}).`);
        }

        let historyForAPI = [...history];

        const conversationTurns = history.filter(h => h.role === 'user' && h.parts?.[0]?.text !== reinforcementText).length;
        
        const safeTurns = Math.min(appConfig.maxHistoryTurns || 10, MAX_SAFE_TURNS);
        const maxFinalLength = (safeTurns * 2) + 2;

        const reinjectPromptEvery = appConfig.reinjectPromptEvery || REINFORCE_EVERY_N_TURNS;
        const needsPeriodicReinforcement = conversationTurns > 0 && conversationTurns % reinjectPromptEvery === 0;
        const needsReinforcement = !reinforcedUsersThisSession.has(userId) || history.length === 0 || needsPeriodicReinforcement;

        if (needsReinforcement) {
            historyForAPI.unshift(outputFilter.modelAck);
            historyForAPI.unshift(outputFilter.reinforcementPrompt);
            reinforcedUsersThisSession.add(userId);
            console.log(`[chatLogic:handleChatLogic] Applied reinforcement prompt. (Turns: ${conversationTurns})`);
        }

        const generationParams = {
            systemInstruction: finalSystemInstruction,
            generationConfig: { maxOutputTokens: 8192, temperature: 1.0 },
            tools: [groundingTool],
            historyForAPI: historyForAPI,
            prompt: userPrompt,
        };
        
        console.log(`[chatLogic:handleChatLogic] Calling generateResponseWithFallback with ${historyForAPI.length} history items. (Model: ${keyInstance.apiKey.substring(0, 4)}...)`);
        const arthurResponseOrObject = await generateResponseWithFallback(keyInstance, generationParams, limitCheck);
        
        let arthurResponse = null;
        let tokensUsed = 0;
        let responseMetadata = {};

        if (typeof arthurResponseOrObject === 'string') {
            arthurResponse = arthurResponseOrObject;
            console.log(`[chatLogic:handleChatLogic] Response received as string fallback (Error).`);
        } else if (arthurResponseOrObject && arthurResponseOrObject.filtered) {
            const filteredMessage = await db.getText('error_general', "لعنتی! انگار چندتا از افراد پینکرتون سرور رو به آتیش کشیدن!");
            await bot.editMessageText(filteredMessage, { chat_id: chatId, message_id: placeholder.message_id });
            console.log(`[chatLogic:handleChatLogic] END - Response was filtered/blocked.`);
            return;
        } else if (arthurResponseOrObject) {
            arthurResponse = arthurResponseOrObject.text;
            responseMetadata = arthurResponseOrObject.responseMetadata || {};
            tokensUsed = responseMetadata.totalTokenCount || 0;
            console.log(`[chatLogic:handleChatLogic] Response received (Tokens: ${tokensUsed}).`);
        }
        
        if (keyObject && keyObject.id) {
            await db.incrementKeyUsage(keyObject.id, tokensUsed);
            console.log(`[chatLogic:handleChatLogic] Incremented key usage for ID: ${keyObject.id}.`);
        }

        if (!arthurResponse) {
             arthurResponse = await db.getText('error_general', "لعنتی! انگار زبونم بند اومده.");
        }

        let historyToSave = [...history];

        historyToSave = historyToSave.filter(
            h => h.parts?.[0]?.text !== reinforcementText &&
                 h.parts?.[0]?.text !== modelAckText
        );

        historyToSave.push(
            { role: "user", parts: [{ text: userPrompt }] },
            { role: "model", parts: [{ text: arthurResponse.substring(0, 4000) }] }
        );
        
        const isReinforcedInHistory = needsReinforcement;
        
        if (needsReinforcement) {
            historyToSave.unshift(outputFilter.modelAck);
            historyToSave.unshift(outputFilter.reinforcementPrompt);
        }

        const startIndex = isReinforcedInHistory ? 2 : 0;
        
        while (historyToSave.length > maxFinalLength || calculateHistorySize(historyToSave) > MAX_HISTORY_BYTES) {
             if (historyToSave.length <= startIndex + 2) break;
             historyToSave.splice(startIndex, 2); 
             console.log(`[chatLogic:handleChatLogic] Trimmed history by 2 parts. Current size: ${historyToSave.length} (${calculateHistorySize(historyToSave)} bytes).`);
        }

        await db.saveDailyConversation(chatId, userId, historyToSave);

        // Optimized: Read global_button and isGlobalButtonEnabled from cache
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
            console.log(`[chatLogic:handleChatLogic] Adding global button to response.`);
        }

        try {
            await bot.editMessageText(arthurResponse, telegramOptions);
            console.log(`[chatLogic:handleChatLogic] Edited placeholder with final response.`);
        } catch (telegramError) {
            if (telegramError.response && telegramError.response.body.description.includes("can't parse entities")) {
                const plainTextOptions = { ...telegramOptions };
                delete plainTextOptions.parse_mode;
                await bot.editMessageText(arthurResponse, plainTextOptions).catch(err => handleTelegramApiError(err, 'handleChatLogic - final response fallback'));
                console.warn(`[chatLogic:handleChatLogic] Markdown parse failed, sent as plain text.`);
            } else {
                throw telegramError;
            }
        }

    } catch (error) {
        if (error.code === 'ETELEGRAM' && (error.response?.body?.description.includes('bot was kicked') || error.response?.body?.description.includes('chat not found'))) {
            await db.purgeChatData(chatId); 
            console.log(`[chatLogic:handleChatLogic] Bot was kicked from chat ${chatId}. Purging data.`);
            return;
        }
        
        console.error(`[chatLogic:handleChatLogic] Gemini/Telegram Error in [ChatID: ${chatId}, UserID: ${userId}]:`, error.message);
        
        let errorMessage;
        
        if (error.type === 'OVERLOADED') {
            errorMessage = await db.getText('overload_error_message', "هی رفیق مغزم ترکیده خیلی صحبت کردم ۱ ساعت دیگه تست کن");
        } else if (error.status === 503 || error.message.includes('fetch failed') || error.message.includes('empty response') || error.message.includes('timed out') || error.message.includes('Network Error')) {
            errorMessage = await db.getText('error_network', "برادر آرتور خسته شده وقت لالا هست.");
        } else {
            errorMessage = await db.getText('error_general', "لعنتی! انگار چندتا از افراد پینکرتون سرور رو به آتیش کشیدن!");
        }

        if (placeholder) {
            bot.editMessageText(errorMessage, { chat_id: chatId, message_id: placeholder.message_id }).catch(err => handleTelegramApiError(err, 'handleChatLogic - error message'));
        }
        console.log(`[chatLogic:handleChatLogic] END - Failed with error: ${error.type || 'UNKNOWN'}.`);
    } finally {
        if (keyObject) {
            keyPoolManager.releaseKey(keyObject);
        }
        activeUsers.delete(userId);
    }
}