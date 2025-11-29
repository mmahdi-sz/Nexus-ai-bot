
import * as db from '../database.js';
import { sendMessageSafe, editMessageSafe, escapeMarkdownV2, boldText } from '../utils/textFormatter.js';

export async function handleUserPanelCallback(bot, cbq) {
    const userId = cbq.from.id;
    const data = cbq.data;
    const msg = cbq.message;

    if (data === 'user_memory_manage') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});

        const memory = await db.getUserMemory(userId);

        if (!memory || !memory.summary) {
            const noMemoryText = `🧠 ${boldText('حافظه شما')}\n\nهنوز چیزی از شما یاد نگرفتم رفیق\\.`;
            return editMessageSafe(bot, msg.chat.id, msg.message_id, noMemoryText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '◀️ بازگشت', callback_data: 'user_back_to_panel' }]
                    ]
                },
                parse_mode: 'MarkdownV2'
            });
        }

        const memoryParts = memory.summary.split('\n').filter(m => m.trim().length > 0);
        let memoryText = `🧠 ${boldText('حافظه شما')}\n\n`;
        memoryParts.forEach((part, index) => {
            memoryText += `${index + 1}\\. ${escapeMarkdownV2(part)}\n`;
        });

        const keyboard = {
            inline_keyboard: [
                [{ text: '✏️ تغییر حافظه', callback_data: 'user_memory_edit' }],
                [{ text: '🗑️ پاک کردن حافظه', callback_data: 'user_memory_delete_confirm' }],
                [{ text: '◀️ بازگشت', callback_data: 'user_back_to_panel' }]
            ]
        };

        return editMessageSafe(bot, msg.chat.id, msg.message_id, memoryText, {
            reply_markup: keyboard,
            parse_mode: 'MarkdownV2'
        });
    }

    if (data === 'user_memory_edit') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});

        await db.setUserState(userId, 'user_editing_memory', {
            panel_message_id: msg.message_id
        });

        const instructionText = `✏️ ${boldText('ویرایش حافظه')}\n\nمتن جدید حافظه خود را ارسال کنید\\.\n\nهر خط یک خاطره جداگانه است\\.`;

        return editMessageSafe(bot, msg.chat.id, msg.message_id, instructionText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ لغو', callback_data: 'user_memory_manage' }]
                ]
            },
            parse_mode: 'MarkdownV2'
        });
    }

    if (data === 'user_memory_delete_confirm') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});

        const confirmText = `⚠️ ${boldText('تأیید حذف حافظه')}\n\nآیا مطمئن هستید که می‌خواهید تمام حافظه من از شما پاک شود؟`;

        return editMessageSafe(bot, msg.chat.id, msg.message_id, confirmText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ بله، پاک کن', callback_data: 'user_memory_delete_execute' }],
                    [{ text: '❌ لغو', callback_data: 'user_memory_manage' }]
                ]
            },
            parse_mode: 'MarkdownV2'
        });
    }

    if (data === 'user_memory_delete_execute') {
        await bot.answerCallbackQuery(cbq.id, { text: 'حافظه پاک شد.' }).catch(() => {});

        await db.updateUserMemory(userId, '');

        const successText = `✅ ${boldText('حافظه پاک شد')}\n\nتمام اطلاعاتی که از شما یاد گرفته بودم پاک شد\\.`;

        return editMessageSafe(bot, msg.chat.id, msg.message_id, successText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '◀️ بازگشت', callback_data: 'user_back_to_panel' }]
                ]
            },
            parse_mode: 'MarkdownV2'
        });
    }

    if (data === 'user_show_status') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});

        const isPremium = await db.isUserPremium(userId);
        const config = await db.getSetting('config', {});
        const LIMITS = config.userLimits || { day: 26 };
        
        const dayCount = await db.getUserMessageCount(userId, 'day');
        
        let statusText = `📊 ${boldText('وضعیت پیام‌های شما')}\n\n`;
        
        if (isPremium) {
            statusText += `⭐ شما یک *حامی* هستید\\!\n🔓 محدودیت پیام برای شما نداریم رفیق\\! 🤠`;
        } else {
            statusText += `💬 *پیام‌های باقی‌مانده:*\n`;
            statusText += `  \\- امروز: ${escapeMarkdownV2(dayCount.toString())}/${escapeMarkdownV2(LIMITS.day.toString())}\n\n`;
            statusText += `می‌خوای حامی بشی و بدون محدودیت حرف بزنیم؟\nدستور ${escapeMarkdownV2('/donate')} رو بزن\\.`;
        }

        return editMessageSafe(bot, msg.chat.id, msg.message_id, statusText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '◀️ بازگشت', callback_data: 'user_back_to_panel' }]
                ]
            },
            parse_mode: 'MarkdownV2'
        });
    }

    if (data === 'user_back_to_panel') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});

        const isPremium = await db.isUserPremium(userId);

        let statusText = `👤 **پروفایل شما**\n\n`;
        statusText += isPremium ? `⭐️ شما یک **حامی** هستید!\n\n` : `👤 کاربر عادی\n\n`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🧠 مدیریت حافظه', callback_data: 'user_memory_manage' }],
                [{ text: '📊 وضعیت پیام‌ها', callback_data: 'user_show_status' }],
                [{ text: '❌ بستن', callback_data: 'user_close_panel' }]
            ]
        };

        return editMessageSafe(bot, msg.chat.id, msg.message_id, statusText, {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        });
    }

    if (data === 'user_close_panel') {
        await bot.answerCallbackQuery(cbq.id, { text: 'پنل بسته شد.' }).catch(() => {});
        return bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }
}

export async function handleUserMemoryInput(bot, msg, userState) {
    const userId = msg.from.id;
    const text = msg.text;
    if (userState.state === 'user_editing_memory') {
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});

        const newMemory = text.trim();

        if (newMemory.length < 10) {
            await sendMessageSafe(bot, msg.chat.id, 'حافظه باید حداقل 10 کاراکتر باشه.');
            return true;
        }

        if (newMemory.length > 2000) {
            await sendMessageSafe(bot, msg.chat.id, 'حافظه باید حداکثر 2000 کاراکتر باشه.');
            return true;
        }

        await db.updateUserMemory(userId, newMemory);
        await db.clearUserState(userId);

        const panelMessageId = userState.data.panel_message_id;

        const successText = `✅ ${boldText('حافظه بروزرسانی شد')}\n\nاطلاعات جدید ذخیره شد\\.`;

        await bot.editMessageText(successText, {
            chat_id: msg.chat.id,
            message_id: panelMessageId,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '◀️ بازگشت', callback_data: 'user_memory_manage' }]
                ]
            }
        }).catch(() => {});

        return true;
    }

    return false;
}


