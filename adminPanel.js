import { GoogleGenAI } from '@google/genai';
import * as db from './database.js';
import * as security from './security.js';
import { prompts } from './prompts.js';
import { addApiKeyToPool, removeApiKeyFromPool } from './keyPoolManager.js';
import { handleTelegramApiError } from './core/chatLogic.js';
import { escapeMarkdownV2, stripMarkdown, sendMessageSafe, editMessageSafe, boldText, inlineCode } from './utils/textFormatter.js';
import { handlePromptMenu, handlePromptEditInput } from './admin/promptManager.js';
import { handleTextManagement } from './admin/textManager.js';
import { handleStatsMenu } from './admin/statsManager.js';
import { generateDeletionMenu, validateApiKey } from './admin/adminHandlers.js'; 
import { handleKeyManagementCallback, handleKeyManagementInput, apiKeysPanelKeyboard, backToApiKeysKeyboard } from './admin/keyManager.js';
import { handleUserManagementCallback, handleUserManagementInput, specialUsersMainMenuKeyboard } from './admin/userManager.js';
import { handleBotConfigCallback, handleBotConfigInput, botManagementKeyboard, specialChatsKeyboard } from './admin/botConfigManager.js';
import { handleBroadcastContentInput, handleBroadcastWizardCallback } from './admin/broadcastManager.js';


const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
const BOT_ID = parseInt(process.env.BOT_ID || '0', 10);

const mainPanelKeyboard = {
    inline_keyboard: [
        [{ text: '🤖 مدیریت بات', callback_data: 'bot_management_main' }],
        [{ text: '📊 آمار بات', callback_data: 'stats_menu_main' }],
        [{ text: '📝 مدیریت پرامپت‌ها', callback_data: 'prompt_menu_main' }],
        [{ text: '📄 مدیریت متن‌های بات', callback_data: 'text_menu_main' }],
        [{ text: '👥 مدیریت افراد خاص', callback_data: 'user_menu_main' }],
        [{ text: '🔑 مدیریت API Keys', callback_data: 'apikey_menu_main' }],
        [{ text: '❌ بستن پنل', callback_data: 'admin_close' }]
    ]
};
export async function handleCallbackQuery(bot, cbq) {
    console.log(`[adminPanel:handleCallbackQuery] START (User: ${cbq.from.id}, Data: "${cbq.data}")`);
    try {
        const msg = cbq.message;
        const data = cbq.data;

        if (data === 'admin_panel') {
            await db.clearOwnerState(BOT_OWNER_ID);
            console.log(`[adminPanel:handleCallbackQuery] END - Nav to admin_panel.`);
            return editMessageSafe(bot, msg.chat.id, msg.message_id, '**پنل مدیریت آرتور مورگان**\n\nلطفا یک گزینه را انتخاب کنید:', {
                reply_markup: mainPanelKeyboard,
                parse_mode: 'Markdown'
            });
        }
        if (data === 'admin_close') {
            await db.clearOwnerState(BOT_OWNER_ID);
            console.log(`[adminPanel:handleCallbackQuery] END - Closing panel.`);
            return bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
        }
        
        if (data.startsWith('cancel_state_return_')) {
            const returnCallback = data.replace('cancel_state_return_', '');
            await db.clearOwnerState(BOT_OWNER_ID);
            bot.answerCallbackQuery(cbq.id, { text: await db.getText('admin_cancel', 'عملیات لغو شد.') }).catch(() => {});
            console.log(`[adminPanel:handleCallbackQuery] END - State cancelled, returning to: ${returnCallback}`);
            return handleCallbackQuery(bot, { ...cbq, data: returnCallback });
        }

        if (data.startsWith('stats_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleStatsMenu...`);
            const handled = await handleStatsMenu(bot, msg, data);
            if (handled) return handled;
        }
        if (data.startsWith('text_') || data.startsWith('tutorial_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleTextManagement...`);
            const handled = await handleTextManagement(bot, msg, data);
            if (handled) return handled;
        }
        if (data.startsWith('prompt_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handlePromptMenu...`);
            const handled = await handlePromptMenu(bot, msg, data);
            if (handled) return handled;
        }
        
        if (data.startsWith('broadcast_wiz_') || data === 'broadcast_menu_main') {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleBroadcastWizardCallback...`);
            const handled = await handleBroadcastWizardCallback(bot, cbq);
            if (handled) return handled;
        }

        if (data.startsWith('bot_management_') || data.startsWith('special_chat_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleBotConfigCallback...`);
            const handled = await handleBotConfigCallback(bot, cbq, msg, data, (returnCallback) => handleCallbackQuery(bot, { ...cbq, data: returnCallback }));
            if (handled) return handled;
        }

        if (data.startsWith('apikey_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleKeyManagementCallback...`);
            const handled = await handleKeyManagementCallback(bot, cbq, msg, data, (returnCallback) => handleCallbackQuery(bot, { ...cbq, data: returnCallback }));
            if (handled) return handled;
        }

        if (data.startsWith('user_')) {
            console.log(`[adminPanel:handleCallbackQuery] Delegating to handleUserManagementCallback...`);
            const handled = await handleUserManagementCallback(bot, cbq, msg, data);
            if (handled) return handled;
        }

        console.warn(`[adminPanel:handleCallbackQuery] WARNING: No handler found for callback data: "${data}"`);
        console.log(`[adminPanel:handleCallbackQuery] END - No handler found.`);

    } catch (error) {
        console.error('--- [FATAL ERROR in adminPanel:handleCallbackQuery] ---');
        console.error(`An unexpected error occurred while processing data: "${cbq.data}"`);
        console.error(error);
        console.error('------------------------------------------');
        try {
            await bot.answerCallbackQuery(cbq.id, { text: '⚠️ یک خطای داخلی رخ داد!', show_alert: true });
            setTimeout(() => handleCallbackQuery(bot, { ...cbq, data: 'admin_panel' }).catch(() => {}), 100);
        } catch (e) {
            console.error('Could not even send error message to user.', e);
        }
    }
}

export async function handleTextMessage(bot, msg, ownerState) {
    console.log(`[adminPanel:handleTextMessage] START (User: ${msg.from.id}, State: "${ownerState.state}")`);
    const originalPanelMessageId = ownerState.data.message_id;
    const chatId = msg.chat.id;

    const goBackTo = (callbackData) => {
        console.log(`[adminPanel:handleTextMessage:goBackTo] Returning to callback: ${callbackData}`);
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        const simulatedCbq = { message: { chat: { id: chatId }, message_id: originalPanelMessageId }, data: callbackData, from: { id: BOT_OWNER_ID } };
        return handleCallbackQuery(bot, simulatedCbq);
    };

    try {
        const text = msg.text;

        bot.deleteMessage(chatId, msg.message_id).catch(() => { });

        if (text === '/cancel') {
            await db.clearOwnerState(BOT_OWNER_ID);
            const errorMessage = `دستور ${inlineCode('/cancel')} دیگر پشتیبانی نمی‌شود\\. لطفاً از دکمه ${boldText('❌ لغو ویرایش')} که در بالای صفحه وضعیت نمایش داده شده است، استفاده کنید\\.`;
            await sendMessageSafe(bot, chatId, errorMessage, { parse_mode: 'MarkdownV2' });
            setTimeout(() => goBackTo('admin_panel').catch(() => {}), 2000);
            console.log(`[adminPanel:handleTextMessage] END - /cancel used.`);
            return;
        }

        const { state, data } = ownerState;

        if (state === 'awaiting_broadcast_content' || state === 'broadcast_wiz_enter_content') {
            console.log(`[adminPanel:handleTextMessage] Delegating to handleBroadcastContentInput...`);
            const handled = await handleBroadcastContentInput(bot, msg, ownerState);
            if (handled) {
                console.log(`[adminPanel:handleTextMessage] END - Handled by handleBroadcastContentInput.`);
                return;
            }
        }
        
        if (state.startsWith('editing_prompt_full_')) {
            console.log(`[adminPanel:handleTextMessage] Delegating to handlePromptEditInput...`);
            const handled = await handlePromptEditInput(bot, msg, ownerState);
            if (handled) {
                console.log(`[adminPanel:handleTextMessage] END - Handled by handlePromptEditInput.`);
                return;
            }
        }
        
        if (state.startsWith('editing_tutorial_text_')) {
            const newText = text.trim();
            const { key, return_callback } = data;

            console.log(`[adminPanel:handleTextMessage] Processing key edit: ${key}`);

            if (!key || typeof key !== 'string' || key.length === 0) {
                 console.error("[adminPanel:handleTextMessage] CRITICAL ERROR: Key is missing in ownerState data. Data:", data);
                 await db.clearOwnerState(BOT_OWNER_ID);
                 const errorMessage = await db.getText('admin_error', '⚠️ یک خطای داخلی در پردازش پیام شما رخ داد\\. عملیات لغو شد\\. \\(خطای کلید متن\\)');
                 await editMessageSafe(bot, chatId, originalPanelMessageId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
                 setTimeout(() => goBackTo('admin_panel').catch(() => {}), 1500);
                 console.log(`[adminPanel:handleTextMessage] END - Text edit failed (missing key).`);
                 return;
            }
            
            await db.setText(key, newText);
            await db.clearOwnerState(BOT_OWNER_ID);
            
            const backCallback = return_callback || 'text_menu_main';
            
            const successMessage = `✅ متن برای کلید ${inlineCode(key)} با موفقیت به‌روزرسانی شد\\.`;
            await editMessageSafe(bot, chatId, originalPanelMessageId, successMessage, { parse_mode: 'MarkdownV2' }).catch(() => {
                console.warn(`[adminPanel:handleTextMessage] Could not edit confirmation message ID ${originalPanelMessageId}. Proceeding to goBackTo.`);
            });

            setTimeout(() => goBackTo(backCallback).catch((e) => {
                 console.error(`[adminPanel:handleTextMessage] Error during goBackTo execution:`, e);
            }), 1500);
            console.log(`[adminPanel:handleTextMessage] END - Text edit successful for key: ${key}`);
            return;
        }
        
        if (state === 'adding_api_key') {
            console.log(`[adminPanel:handleTextMessage] Delegating to handleKeyManagementInput...`);
            const handled = await handleKeyManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) {
                console.log(`[adminPanel:handleTextMessage] END - Handled by handleKeyManagementInput.`);
                return;
            }
        }

        if (state.startsWith('user_add_awaiting_') || state.startsWith('user_edit_awaiting_')) {
            console.log(`[adminPanel:handleTextMessage] Delegating to handleUserManagementInput...`);
            const handled = await handleUserManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) {
                console.log(`[adminPanel:handleTextMessage] END - Handled by handleUserManagementInput.`);
                return;
            }
        }
        
        if (state.startsWith('set_button_awaiting_')) {
            console.log(`[adminPanel:handleTextMessage] Delegating to handleBotConfigInput...`);
            const handled = await handleBotConfigInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) {
                console.log(`[adminPanel:handleTextMessage] END - Handled by handleBotConfigInput.`);
                return;
            }
        }
        
        if (state === 'tutorial_api_awaiting_text') {
            console.log(`[adminPanel:handleTextMessage] Processing tutorial_api_awaiting_text...`);
            const lines = text.trim().split('\n');
            let tutorialText = lines.join('\n');
            let buttonText = await db.getText('tutorial_button_default', 'کمک به خرید فشنگ و دینامیت برای آرتور');
            let buttonUrl = null;

            const lastLine = lines[lines.length - 1];
            const buttonMatch = lastLine.match(/^دکمه:\s*(.+?)\s*\|\s*(https?:\/\/.+)$/);

            if (buttonMatch) {
                buttonText = buttonMatch[1].trim();
                buttonUrl = buttonMatch[2].trim();
                tutorialText = lines.slice(0, -1).join('\n').trim();
                console.log(`[adminPanel:handleTextMessage] Button match found (URL: ${buttonUrl ? 'YES' : 'NO'}).`);
            }

            await db.setTutorialTextForApi(tutorialText, buttonText, buttonUrl);
            
            await db.clearTutorialMedia();
            if (data.media && data.media.length > 0) {
                console.log(`[adminPanel:handleTextMessage] Saving ${data.media.length} media files.`);
                for (let i = 0; i < data.media.length; i++) {
                    const m = data.media[i];
                    await db.addTutorialMedia(m.fileId, m.fileType, m.caption, i + 1);
                }
            }

            await db.clearOwnerState(BOT_OWNER_ID);
            await editMessageSafe(bot, chatId, originalPanelMessageId, '✅ راهنمای API شامل متن و مدیا با موفقیت ذخیره و به‌روزرسانی شد\\.', { parse_mode: 'MarkdownV2' }).catch(() => {});
            setTimeout(() => goBackTo('tutorial_api_menu').catch(() => {}), 1500);
            console.log(`[adminPanel:handleTextMessage] END - Tutorial API text/media saved.`);
            return;
        }

        if (state.startsWith('editing_prompt_')) {
            console.log(`[adminPanel:handleTextMessage] Processing prompt edit...`);
            const keys = state.replace('editing_prompt_', '').split('_');
            const mainKey = keys[0];
            const subKey = keys[1];
            const { return_callback } = data;
            
            console.log(`[adminPanel:handleTextMessage] Updating prompt: ${mainKey}.${subKey}`);
            
            const currentPrompts = await db.getSetting('prompts', prompts);
            if (currentPrompts?.system && currentPrompts.system[mainKey]) {
                currentPrompts.system[mainKey][subKey] = text;
            }

            await db.setSetting('prompts', currentPrompts);
            await db.clearOwnerState(BOT_OWNER_ID);

            try {
                await bot.deleteMessage(chatId, originalPanelMessageId).catch(() => {});
            } catch (e) {
                console.warn('[adminPanel:handleTextMessage] Could not delete old panel message:', e.message);
            }
            
            const successMessage = `✅ پرامپت برای ${inlineCode(mainKey)} \\-\\> ${inlineCode(subKey)} با موفقیت به‌روزرسانی شد\\.`;
            const confirmMsg = await sendMessageSafe(bot, chatId, successMessage, { parse_mode: 'MarkdownV2' });
            
            const backCallback = return_callback || 'prompt_menu_main';

            setTimeout(async () => {
                await bot.deleteMessage(chatId, confirmMsg.message_id).catch(() => {});
                goBackTo(backCallback).catch(() => {});
            }, 1500);
            
            console.log(`[adminPanel:handleTextMessage] END - Prompt updated for: ${mainKey}.${subKey}`);
            return; 
        }
        
        console.log(`[adminPanel:handleTextMessage] END - No handler found for state: ${state}`);

    } catch (error) {
        console.error('--- [FATAL ERROR in adminPanel:handleTextMessage] ---');
        console.error(`An unexpected error occurred while processing state: "${ownerState?.state}"`);
        console.error(error);
        console.error('----------------------------------------');
        const errorMessage = await db.getText('admin_error', "⚠️ یک خطای داخلی در پردازش پیام شما رخ داد\\. عملیات لغو شد\\.");
        if (originalPanelMessageId && chatId) {
            await editMessageSafe(bot, chatId, originalPanelMessageId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(async () => {
                 await sendMessageSafe(bot, chatId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
            });
        }
        await db.clearOwnerState(BOT_OWNER_ID);
        setTimeout(() => goBackTo('admin_panel').catch(() => {}), 2000);
    }
}