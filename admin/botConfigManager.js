import * as db from '../database.js';
import { editMessageSafe, escapeMarkdownV2 } from '../utils/textFormatter.js';
import { generateDeletionMenu } from './adminHandlers.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

export const botManagementKeyboard = {
    inline_keyboard: [
        [{ text: '🔗 تغییر دکمه شیشه‌ای بات', callback_data: 'bot_management_set_button' }],
        [{ text: '🔘 فعال/غیرفعال کردن دکمه', callback_data: 'bot_toggle_button' }],
        [{ text: '🏙️ مدیریت گروه‌های ویژه', callback_data: 'bot_management_special_chats' }],
        [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]
    ]
};

export const specialChatsKeyboard = {
    inline_keyboard: [
        [{ text: '➕ افزودن گروه فعلی', callback_data: 'special_chat_add_current' }],
        [{ text: '➖ حذف گروه ویژه', callback_data: 'special_chat_delete_list' }],
        [{ text: '↩️ بازگشت', callback_data: 'bot_management_main' }]
    ]
};

export async function handleBotConfigCallback(bot, cbq, msg, data, goBackTo) {
    if (data === 'bot_management_main') return editMessageSafe(bot, msg.chat.id, msg.message_id, '**مدیریت بات**', { reply_markup: botManagementKeyboard });
    
    if (data === 'bot_toggle_button') {
        const isEnabled = await db.toggleGlobalButton();
        bot.answerCallbackQuery(cbq.id, {
            text: `دکمه شیشه‌ای سراسری ${isEnabled ? '✅ فعال' : '❌ غیرفعال'} شد.`,
            show_alert: true
        }).catch(() => { });
        const statusText = `✅ وضعیت دکمه شیشه‌ای با موفقیت تغییر کرد\\.\n\nوضعیت فعلی: *${isEnabled ? 'فعال' : 'غیرفعال'}*`;
        return editMessageSafe(bot, msg.chat.id, msg.message_id, statusText, { reply_markup: botManagementKeyboard, parse_mode: 'MarkdownV2' });
    }
    
    if (data === 'bot_management_set_button') {
        await db.setOwnerState(BOT_OWNER_ID, 'set_button_awaiting_url', { message_id: msg.message_id });
        const setText = '*مرحله ۱ از ۲: لینک دکمه*\n\nلطفا لینک کامل مورد نظر را بفرستید\\. برای حذف دکمه فعلی، `none` را ارسال کنید\\.\n\nمثال: `https://t\\.me/YourChannel`';
        return editMessageSafe(bot, msg.chat.id, msg.message_id, setText, { parse_mode: 'MarkdownV2', inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_bot_management_main' }]] });
    }
    
    if (data === 'bot_management_special_chats') return editMessageSafe(bot, msg.chat.id, msg.message_id, '**مدیریت گروه‌های ویژه**\n\nدر گروه‌های ویژه، دکمه شیشه‌ای نمایش داده نمی‌شود.', { reply_markup: specialChatsKeyboard });
    
    if (data === 'special_chat_add_current') {
        if (msg.chat.type === 'private') {
            return bot.answerCallbackQuery(cbq.id, { text: 'این گزینه فقط در گروه‌ها قابل استفاده است.', show_alert: true }).catch(() => { });
        }
        try {
            const chatDetails = await bot.getChat(msg.chat.id);
            await db.addSpecialChat(msg.chat.id, chatDetails.title);
            bot.answerCallbackQuery(cbq.id, { text: `گروه "${chatDetails.title}" به لیست ویژه اضافه شد.`, show_alert: true }).catch(() => { });
            const successText = `✅ گروه *${escapeMarkdownV2(chatDetails.title)}* به لیست ویژه اضافه شد\\.\n\nدر گروه‌های ویژه، دکمه شیشه‌ای نمایش داده نمی‌شود\\.`;
            return editMessageSafe(bot, msg.chat.id, msg.message_id, successText, { parse_mode: 'MarkdownV2', reply_markup: specialChatsKeyboard });
        } catch (error) {
            console.error("Error adding special chat:", error);
            bot.answerCallbackQuery(cbq.id, { text: 'خطایی در افزودن گروه رخ داد.', show_alert: true }).catch(() => { });
        }
    }
    
    if (data === 'special_chat_delete_list') {
        const menu = await generateDeletionMenu(db.getAllSpecialChats, {
            emptyText: 'هیچ گروه ویژه‌ای ثبت نشده است.',
            backCallback: 'bot_management_special_chats',
            title: 'کدام گروه را از لیست ویژه حذف می‌کنید؟',
            itemTextKey: 'chat_title',
            itemIdKey: 'chat_id',
            callbackPrefix: 'special_chat_delete_confirm_'
        });
        return editMessageSafe(bot, msg.chat.id, msg.message_id, menu.text, { reply_markup: menu.keyboard });
    }
    
    if (data.startsWith('special_chat_delete_confirm_')) {
        const chatId = parseInt(data.split('_').pop(), 10);
        await db.removeSpecialChat(chatId);
        bot.answerCallbackQuery(cbq.id, { text: `گروه از لیست ویژه حذف شد.`, show_alert: true }).catch(() => { });
        return goBackTo('special_chat_delete_list');
    }

    return false;
}

export async function handleBotConfigInput(bot, msg, ownerState, originalPanelMessageId, goBackTo) {
    const text = msg.text;
    const { state, data } = ownerState;

    if (state === 'set_button_awaiting_url') {
        const url = text.trim();
        if (url.toLowerCase() === 'none') {
            await db.setSetting('global_button', null);
            await db.clearOwnerState(BOT_OWNER_ID);
            await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, '✅ دکمه شیشه‌ای سراسری با موفقیت حذف شد.').catch(() => { });
            setTimeout(() => goBackTo('bot_management_main').catch(() => {}), 1500);
            return true;
        }
        await db.setOwnerState(BOT_OWNER_ID, 'set_button_awaiting_text', { ...data, url: url });
        const instructionText = '*مرحله ۲ از ۲: متن دکمه*\n\nلینک دریافت شد\\. اکنون متن مورد نظر برای نمایش روی دکمه را ارسال کنید\\. ';
        editMessageSafe(bot, msg.chat.id, originalPanelMessageId, instructionText, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_bot_management_main' }]] } }).catch(() => {});
        return true;
    }
    
    if (state === 'set_button_awaiting_text') {
        const buttonText = text.trim();
        const buttonData = { text: buttonText, url: data.url };
        await db.setSetting('global_button', buttonData);
        await db.clearOwnerState(BOT_OWNER_ID);
        await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, '✅ دکمه شیشه‌ای با موفقیت تنظیم شد.').catch(() => { });
        setTimeout(() => goBackTo('bot_management_main').catch(() => {}), 1500);
        return true;
    }
    return false;
}