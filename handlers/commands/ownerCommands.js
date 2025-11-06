import * as db from '../../database.js';
import { sendMessageSafe, escapeMarkdownV2, inlineCode } from '../../utils/textFormatter.js';
import { handleTelegramApiError } from '../../core/chatLogic.js';
import { startBroadcastWizard } from '../../admin/broadcastManager.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

export async function handleStatsCommand(bot, msg) {
    if (msg.from.id !== BOT_OWNER_ID) {
        return;
    }

    try {
        const dayStats = await db.getUserStats('day');
        const allStats = await db.getUserStats('all');
        const groupStats = await db.getAllGroupStats();
        const activeKeys = await db.getAllApiKeys();
        const donatedKeys = await db.countDonatedKeys();

        const text = `📊 *آمار لحظه‌ای ربات آرتور*
\\-\\-\\-
👤 *کاربران \\(۲۴ ساعت اخیر\\):*
   \\- کاربران یکتا: *${escapeMarkdownV2(dayStats.unique_users.toString())} نفر*
   \\- کل پیام‌ها: *${escapeMarkdownV2(dayStats.total_messages.toString())} پیام*
\\-\\-\\-
👥 *کاربران \\(کل\\):*
   \\- کاربران یکتا: *${escapeMarkdownV2(allStats.unique_users.toString())} نفر*
   \\- کل پیام‌ها: *${escapeMarkdownV2(allStats.total_messages.toString())} پیام*
\\-\\-\\-
🏘️ *گروه‌ها:*
   \\- گروه‌های فعال: *${escapeMarkdownV2(groupStats.enabled_groups.toString())} عدد*
   \\- مجموع اعضا \\(تخمینی\\): *${escapeMarkdownV2(groupStats.total_members.toString())} نفر*
\\-\\-\\-
🔑 *وضعیت کلیدهای API:*
   \\- کلیدهای عمومی فعال: *${escapeMarkdownV2(activeKeys.length.toString())} عدد*
   \\- کلیدهای اهدا شده توسط کاربران: *${escapeMarkdownV2(donatedKeys.toString())} عدد*`;

        await sendMessageSafe(bot, msg.chat.id, text);
        
    } catch (error) {
        const errorText = await db.getText('error_general', "❌ یه مشکلی تو شمردن پیش اومد رفیق. لاگ‌ها رو چک کن.");
        bot.sendMessage(msg.chat.id, errorText);
    }
}

export async function handleClearStatesCommand(bot, msg) {
    if (msg.from.id !== BOT_OWNER_ID) {
        return;
    }

    try {
        const result = await db.clearAllUserStates();
        const affectedCount = result?.affectedRows || 0;
        
        const message = `✅ وضعیت ${escapeMarkdownV2(affectedCount.toString())} کاربر با موفقیت پاکسازی شد\\.\n\nکاربران گیر افتاده می‌توانند مکالمه عادی را ادامه دهند\\.`;
        
        await sendMessageSafe(bot, msg.chat.id, message);
        
    } catch (error) {
        const errorText = await db.getText('error_general', "❌ خطایی در پاکسازی وضعیت کاربران رخ داد. لاگ‌ها رو چک کن.");
        bot.sendMessage(msg.chat.id, errorText);
    }
}

export async function handleBroadcastCommand(bot, msg) {
    if (msg.from.id !== BOT_OWNER_ID) {
        return;
    }
    try {
        await startBroadcastWizard(bot, msg);
    } catch (error) {
        const errorText = await db.getText('error_general', "خطایی در شروع فرآیند ارسال همگانی رخ داد.");
        bot.sendMessage(msg.chat.id, errorText).catch(err => handleTelegramApiError(err, 'onText:/broadcast - error'));
    }
}