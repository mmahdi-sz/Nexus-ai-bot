
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
import { isOwner } from './utils/ownerCheck.js';

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
    const userId = cbq.from.id;
    const data = cbq.data;

    if (data === 'noop') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        return;
    }

    const isUserFeature = data.startsWith('tone_') || 
                          data.startsWith('donate_') || 
                          data.startsWith('user_') ||
                          data === 'user_show_api_guide' ||
                          data === 'user_submit_key_start';

    if (isUserFeature) {
        return false;
    }

    try {
        if (!isOwner(userId)) {
            return bot.answerCallbackQuery(cbq.id, { text: '⛔ دسترسی غیرمجاز', show_alert: true });
        }

        const msg = cbq.message;

        if (data === 'admin_panel') {
            await db.clearOwnerState(userId);
            return editMessageSafe(bot, msg.chat.id, msg.message_id, '**پنل مدیریت آرتور مورگان**\n\nلطفا یک گزینه را انتخاب کنید:', {
                reply_markup: mainPanelKeyboard,
                parse_mode: 'Markdown'
            });
        }
        if (data === 'admin_close') {
            await db.clearOwnerState(userId);
            return bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
        }
        
        if (data.startsWith('cancel_state_return_')) {
            const returnCallback = data.replace('cancel_state_return_', '');
            await db.clearOwnerState(userId);
            bot.answerCallbackQuery(cbq.id, { text: await db.getText('admin_cancel', 'عملیات لغو شد.') }).catch(() => {});
            return handleCallbackQuery(bot, { ...cbq, data: returnCallback });
        }

        if (data.startsWith('stats_')) {
            const handled = await handleStatsMenu(bot, msg, data);
            if (handled) return handled;
        }
        if (data.startsWith('text_') || data.startsWith('tutorial_')) {
            const handled = await handleTextManagement(bot, msg, data);
            if (handled) return handled;
        }
        if (data.startsWith('prompt_')) {
            const handled = await handlePromptMenu(bot, msg, data);
            if (handled) return handled;
        }
        
        if (data.startsWith('broadcast_wiz_') || data === 'broadcast_menu_main') {
            const handled = await handleBroadcastWizardCallback(bot, cbq);
            if (handled) return handled;
        }

        if (data.startsWith('bot_management_') || data.startsWith('special_chat_')) {
            const handled = await handleBotConfigCallback(bot, cbq, msg, data, (returnCallback) => handleCallbackQuery(bot, { ...cbq, data: returnCallback }));
            if (handled) return handled;
        }

        if (data.startsWith('apikey_')) {
            const handled = await handleKeyManagementCallback(bot, cbq, msg, data, (returnCallback) => handleCallbackQuery(bot, { ...cbq, data: returnCallback }));
            if (handled) return handled;
        }

        if (data.startsWith('user_') && !data.startsWith('user_show_') && !data.startsWith('user_memory_')) {
            const handled = await handleUserManagementCallback(bot, cbq, msg, data);
            if (handled) return handled;
        }

    } catch (error) {
        console.error('--- [FATAL ERROR in adminPanel:handleCallbackQuery] ---');
        console.error(`An unexpected error occurred while processing data: "${cbq.data}"`);
        console.error(error);
        try {
            await bot.answerCallbackQuery(cbq.id, { text: '⚠️ یک خطای داخلی رخ داد!', show_alert: true });
            setTimeout(() => handleCallbackQuery(bot, { ...cbq, data: 'admin_panel' }).catch(() => {}), 100);
        } catch (e) {}
    }
}

export async function handleTextMessage(bot, msg, ownerState) {
    const userId = msg.from.id;
    const originalPanelMessageId = ownerState.data.message_id;
    const chatId = msg.chat.id;

    const goBackTo = (callbackData) => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        const simulatedCbq = { 
            id: `fake_${Date.now()}`,
            message: { chat: { id: chatId }, message_id: originalPanelMessageId }, 
            data: callbackData, 
            from: { id: userId } 
        };
        return handleCallbackQuery(bot, simulatedCbq);
    };

    try {
        const text = msg.text;
        bot.deleteMessage(chatId, msg.message_id).catch(() => { });

        if (text === '/cancel') {
            await db.clearOwnerState(userId);
            const errorMessage = `دستور ${inlineCode('/cancel')} دیگر پشتیبانی نمی‌شود\\. لطفاً از دکمه ${boldText('❌ لغو ویرایش')} استفاده کنید\\.`;
            await sendMessageSafe(bot, chatId, errorMessage, { parse_mode: 'MarkdownV2' });
            setTimeout(() => goBackTo('admin_panel').catch(() => {}), 2000);
            return;
        }

        const { state, data } = ownerState;

        if (state === 'awaiting_broadcast_content' || state === 'broadcast_wiz_enter_content') {
            const handled = await handleBroadcastContentInput(bot, msg, ownerState);
            if (handled) return;
        }
        
        if (state.startsWith('editing_prompt_full_')) {
            const handled = await handlePromptEditInput(bot, msg, ownerState);
            if (handled) return;
        }
        
        if (state.startsWith('editing_tutorial_text_')) {
            const newText = text.trim();
            const { key, return_callback } = data;

            if (!key) {
                 await db.clearOwnerState(userId);
                 const errorMessage = await db.getText('admin_error', '⚠️ خطای داخلی (Missing Key)');
                 await editMessageSafe(bot, chatId, originalPanelMessageId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
                 setTimeout(() => goBackTo('admin_panel').catch(() => {}), 1500);
                 return;
            }
            
            if (newText.length < 5 || newText.length > 4000) {
                const errorMessage = escapeMarkdownV2('⚠️ متن باید بین 5 تا 4000 کاراکتر باشد.');
                await editMessageSafe(bot, chatId, originalPanelMessageId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
                return;
            }

            await db.setText(key, newText);
            await db.clearOwnerState(userId);
            
            const backCallback = return_callback || 'text_menu_main';
            const successMessage = `✅ متن برای کلید ${inlineCode(key)} به‌روزرسانی شد\\.`;
            
            await editMessageSafe(bot, chatId, originalPanelMessageId, successMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
            setTimeout(() => goBackTo(backCallback).catch(() => {}), 1500);
            return;
        }
        
        if (state === 'adding_api_key') {
            const handled = await handleKeyManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) return;
        }

        if (state.startsWith('user_add_awaiting_') || state.startsWith('user_edit_awaiting_')) {
            const handled = await handleUserManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) return;
        }
        
        if (state.startsWith('set_button_awaiting_')) {
            const handled = await handleBotConfigInput(bot, msg, ownerState, originalPanelMessageId, goBackTo);
            if (handled) return;
        }
        
        if (state === 'tutorial_api_awaiting_text') {
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
            }

            await db.setTutorialTextForApi(tutorialText, buttonText, buttonUrl);
            await db.clearTutorialMedia();
            
            if (data.media && data.media.length > 0) {
                for (let i = 0; i < data.media.length; i++) {
                    const m = data.media[i];
                    await db.addTutorialMedia(m.fileId, m.fileType, m.caption, i + 1);
                }
            }

            await db.clearOwnerState(userId);
            await editMessageSafe(bot, chatId, originalPanelMessageId, '✅ راهنمای API ذخیره شد\\.', { parse_mode: 'MarkdownV2' }).catch(() => {});
            setTimeout(() => goBackTo('tutorial_api_menu').catch(() => {}), 1500);
            return;
        }

        if (state.startsWith('editing_prompt_')) {
            const keys = state.replace('editing_prompt_', '').split('_');
            const mainKey = keys[0];
            const subKey = keys[1];
            const { return_callback } = data;
            
            const currentPrompts = await db.getSetting('prompts', prompts);
            if (currentPrompts?.system && currentPrompts.system[mainKey]) {
                currentPrompts.system[mainKey][subKey] = text;
            }

            await db.setSetting('prompts', currentPrompts);
            await db.clearOwnerState(userId);

            try { await bot.deleteMessage(chatId, originalPanelMessageId).catch(() => {}); } catch (e) {}
            
            const successMessage = `✅ پرامپت ${inlineCode(mainKey)} \\-\\> ${inlineCode(subKey)} به‌روز شد\\.`;
            const confirmMsg = await sendMessageSafe(bot, chatId, successMessage, { parse_mode: 'MarkdownV2' });
            
            const backCallback = return_callback || 'prompt_menu_main';
            setTimeout(async () => {
                await bot.deleteMessage(chatId, confirmMsg.message_id).catch(() => {});
                goBackTo(backCallback).catch(() => {});
            }, 1500);
            return; 
        }

    } catch (error) {
        console.error('--- [FATAL ERROR in adminPanel:handleTextMessage] ---');
        console.error(error);
        const errorMessage = await db.getText('admin_error', "⚠️ خطای داخلی. عملیات لغو شد\\.");
        if (originalPanelMessageId && chatId) {
            await editMessageSafe(bot, chatId, originalPanelMessageId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(async () => {
                 await sendMessageSafe(bot, chatId, errorMessage, { parse_mode: 'MarkdownV2' }).catch(() => {});
            });
        }
        await db.clearOwnerState(userId);
        setTimeout(() => goBackTo('admin_panel').catch(() => {}), 2000);
    }
}


