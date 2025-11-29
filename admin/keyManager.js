
import * as db from '../database.js';
import * as security from '../security.js';
import { addApiKeyToPool, removeApiKeyFromPool } from '../keyPoolManager.js';
import { editMessageSafe, escapeMarkdownV2, boldText, inlineCode } from '../utils/textFormatter.js';
import { generateDeletionMenu, validateApiKey } from './adminHandlers.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

export const apiKeysPanelKeyboard = { inline_keyboard: [[{ text: '➕ افزودن کلید', callback_data: 'apikey_add' }], [{ text: '➖ حذف کلید', callback_data: 'apikey_delete_menu' }], [{ text: '📋 لیست کلیدها', callback_data: 'apikey_list' }], [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]] };
export const backToApiKeysKeyboard = { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'apikey_menu_main' }]] };


export async function handleKeyManagementCallback(bot, cbq, msg, data, goBackTo) {
    if (data === 'apikey_menu_main') return editMessageSafe(bot, msg.chat.id, msg.message_id, '**مدیریت کلیدهای API**', { reply_markup: apiKeysPanelKeyboard, parse_mode: 'Markdown' });
    
    if (data === 'apikey_add') {
        await db.setOwnerState(BOT_OWNER_ID, 'adding_api_key', { message_id: msg.message_id });
        
        const infoText = `لطفا کلید API جدید Gemini را ارسال کنید\\.

⚠️ *توجه:* کلیدهای اهدایی کاربران از طریق ویزارد ${inlineCode('/donate')} مدیریت می‌شوند\\. این بخش فقط برای افزودن دستی کلیدهای ادمین است\\.`;
        
        return editMessageSafe(bot, msg.chat.id, msg.message_id, infoText, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_apikey_menu_main' }]], parse_mode: 'MarkdownV2' });
    }

    if (data === 'apikey_list') {
        const keys = await db.getAllApiKeys();
        const keyList = keys.length > 0 ? keys.map((k, i) => {
            const index = escapeMarkdownV2((i + 1).toString());
            const keyId = escapeMarkdownV2(k.id.toString());
            const userType = k.donated_by_user_id ? ' \\- 👥 کاربر' : '';
            return `${index}\\. ${inlineCode(k.display_name)} \\(ID: ${keyId}\\)${userType}`;
        }).join('\n') : 'هیچ کلیدی یافت نشد.';
        
        const listText = `*لیست کلیدهای API فعال:*\n\n${keyList}`;
        
        return editMessageSafe(bot, msg.chat.id, msg.message_id, listText, { 
            reply_markup: backToApiKeysKeyboard,
            parse_mode: 'MarkdownV2' 
        });
    }

    if (data === 'apikey_delete_menu') {
        const menu = await generateDeletionMenu(db.getAllApiKeys, {
            emptyText: 'هیچ کلیدی برای حذف وجود ندارد.',
            backCallback: 'apikey_menu_main',
            title: 'کدام کلید را می‌خواهید حذف کنید؟',
            itemTextKey: 'display_name',
            itemIdKey: 'id',
            callbackPrefix: 'apikey_delete_confirm_'
        });

        if (menu.keyboard.inline_keyboard.length === 1) {
            bot.answerCallbackQuery(cbq.id, { text: 'هیچ کلیدی برای حذف وجود ندارد.', show_alert: false }).catch(() => { });
        }
        return editMessageSafe(bot, msg.chat.id, msg.message_id, menu.text, { reply_markup: menu.keyboard });
    }

    if (data.startsWith('apikey_delete_confirm_')) {
        const keyId = parseInt(data.split('_').pop(), 10);
        await db.deleteApiKeyById(keyId);
        removeApiKeyFromPool(keyId);
        bot.answerCallbackQuery(cbq.id, { text: `کلید با شناسه ${keyId} حذف شد.`, show_alert: true }).catch(() => { });
        return goBackTo('apikey_delete_menu');
    }
    return false;
}

export async function handleKeyManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo) {
    const text = msg.text;
    const { state } = ownerState;

    if (state === 'adding_api_key') {
        const newApiKey = text.trim();

        if (!/^[\x00-\x7F]*$/.test(newApiKey)) {
             await db.clearOwnerState(BOT_OWNER_ID);
             const errorText = escapeMarkdownV2(await db.getText('apikey_invalid_chars', "⚠️ این کلید API شامل کاراکترهای نامعتبر فارسی یا غیرASCII است\\. مطمئن شوید فقط کاراکترهای انگلیسی و اعداد را کپی کرده‌اید\\."));
             await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, errorText, {
                 reply_markup: backToApiKeysKeyboard,
                 parse_mode: 'MarkdownV2'
             }).catch(() => {});
             return true;
        }

        const keyHash = security.hash(newApiKey);
        const existingKey = await db.getApiKeyByHash(keyHash);
        if (existingKey) {
            await db.clearOwnerState(BOT_OWNER_ID);
            const errorText = escapeMarkdownV2(await db.getText('apikey_duplicate', 'این کلید قبلاً در سیستم ثبت شده است\\.'));
             await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, errorText, {
                reply_markup: backToApiKeysKeyboard,
                parse_mode: 'MarkdownV2'
            }).catch(() => {});
            return true;
        }

        await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2(await db.getText('apikey_checking', '⏳ در حال اعتبارسنجی کلید API...'))).catch(() => {});
        const validationResult = await validateApiKey(newApiKey);

        if (!validationResult.isValid) {
            await db.clearOwnerState(BOT_OWNER_ID);
            let errorText;

            if (validationResult.reason === 'rate_limited') {
                errorText = escapeMarkdownV2(await db.getText('apikey_rate_limited', 'هی رفیق، انگار این کلید خسته شده. به نظر می‌رسه به سقف مصرفش رسیده. برو یه کلید کاملاً جدید با یه حساب گوگل دیگه بساز و اونو برام بفرست. منتظرتم.'));
            } else {
                errorText = escapeMarkdownV2(await db.getText('apikey_invalid', '⚠️ این کلید معتبر نیست رفیق\\. مطمئن شو درست کپیش کردی\\.'));
            }
            
            await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, errorText, {
                reply_markup: backToApiKeysKeyboard,
                parse_mode: 'MarkdownV2'
            }).catch(() => {});
            return true;
        }

        const encryptedKey = security.encrypt(newApiKey);
        const displayName = security.createDisplayName(newApiKey);
        const result = await db.addApiKey(encryptedKey, keyHash, displayName, null); 
        const newKeyId = result.lastID;
        addApiKeyToPool(newApiKey, newKeyId);

        await db.clearOwnerState(BOT_OWNER_ID);
        const successText = `✅ کلید ${inlineCode(displayName)} با موفقیت به استخر عمومی اضافه شد\\.`;
        await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, successText, {
            reply_markup: apiKeysPanelKeyboard,
            parse_mode: 'MarkdownV2'
        }).catch(() => {});
        return true;
    }
    return false;
}


