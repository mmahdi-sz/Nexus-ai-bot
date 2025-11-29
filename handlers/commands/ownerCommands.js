
import * as db from '../../database.js';
import { sendMessageSafe, escapeMarkdownV2, inlineCode } from '../../utils/textFormatter.js';
import { handleTelegramApiError } from '../../core/chatLogic.js';
import { startBroadcastWizard } from '../../admin/broadcastManager.js';
import { isOwner } from '../../utils/ownerCheck.js';

function toJalali(date) {
    const g2j = (gy, gm, gd) => {
        const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        let jy = (gy <= 1600) ? 0 : 979;
        gy -= (gy <= 1600) ? 621 : 1600;
        let gy2 = (gm > 2) ? (gy + 1) : gy;
        let days = (365 * gy) + (Math.floor((gy2 + 3) / 4)) - (Math.floor((gy2 + 99) / 100)) + 
                   (Math.floor((gy2 + 399) / 400)) - 80 + gd + g_d_m[gm - 1];
        jy += 33 * Math.floor(days / 12053);
        days %= 12053;
        jy += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days > 365) {
            jy += Math.floor((days - 1) / 365);
            days = (days - 1) % 365;
        }
        const sal_a = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];
        let jm, jd;
        for (let i = 0; i < 12; i++) {
            const v = sal_a[i];
            if (days < v) {
                jm = (i === 0) ? 12 : i;
                jd = days - sal_a[i - 1] + 1;
                break;
            }
        }
        if (!jm) { jm = 12; jd = days - sal_a[11] + 1; }
        return [jy, jm, jd];
    };
    
    const [jy, jm, jd] = g2j(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

export async function handleStatsCommand(bot, msg) {
    if (!isOwner(msg.from.id)) {
        return;
    }

    try {
        const dayStats = await db.getUserStats('day');
        const allStats = await db.getUserStats('all');
        const groupStats = await db.getAllGroupStats();
        const activeKeys = await db.getAllApiKeys();
        const donatedKeys = await db.countDonatedKeys();

        const now = new Date();
        const jalaliDate = toJalali(now);
        const timeString = now.toLocaleTimeString('fa-IR');

        const text = `📊 *آمار لحظه‌ای ربات آرتور*

👤 *کاربران \\(۲۴ ساعت اخیر\\):*
   \\- کاربران یکتا: *${escapeMarkdownV2(dayStats.unique_users.toString())} نفر*
   \\- کل پیام‌ها: *${escapeMarkdownV2(dayStats.total_messages.toString())} پیام*

👥 *کاربران \\(کل\\):*
   \\- کاربران یکتا: *${escapeMarkdownV2(allStats.unique_users.toString())} نفر*
   \\- کل پیام‌ها: *${escapeMarkdownV2(allStats.total_messages.toString())} پیام*

🏘️ *گروه‌ها:*
   \\- گروه‌های فعال: *${escapeMarkdownV2(groupStats.enabled_groups.toString())} عدد*
   \\- مجموع اعضا \\(تخمینی\\): *${escapeMarkdownV2(groupStats.total_members.toString())} نفر*

🔑 *وضعیت کلیدهای API:*
   \\- کلیدهای عمومی فعال: *${escapeMarkdownV2(activeKeys.length.toString())} عدد*
   \\- کلیدهای اهدا شده توسط کاربران: *${escapeMarkdownV2(donatedKeys.toString())} عدد*

📅 *تاریخ:* ${escapeMarkdownV2(jalaliDate)}
🕐 *ساعت:* ${escapeMarkdownV2(timeString)}`;

        await sendMessageSafe(bot, msg.chat.id, text);
        
    } catch (error) {
        const errorText = await db.getText('error_general', "❌ یه مشکلی تو شمردن پیش اومد رفیق. لاگ‌ها رو چک کن.");
        bot.sendMessage(msg.chat.id, errorText);
    }
}

export async function handleClearStatesCommand(bot, msg) {
    if (!isOwner(msg.from.id)) {
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
    if (!isOwner(msg.from.id)) {
        return;
    }
    try {
        await startBroadcastWizard(bot, msg);
    } catch (error) {
        const errorText = await db.getText('error_general', "خطایی در شروع فرآیند ارسال همگانی رخ داد.");
        bot.sendMessage(msg.chat.id, errorText).catch(err => handleTelegramApiError(err, 'onText:/broadcast - error'));
    }
}

export async function handleResetPromptsCommand(bot, msg) {
    if (!isOwner(msg.from.id)) {
        return;
    }

    try {
        await db.setSetting('prompts', null);
        
        const text = `✅ *پرامپت‌ها با موفقیت ریست شدند*

📋 دیتابیس پرامپت‌ها پاکسازی شد. ربات در راه‌اندازی بعدی از فایل‌های پیش‌فرض استفاده خواهد کرد.

🔄 *لطفاً ربات را ریستارت کنید تا تغییرات اعمال شود.*`;
        
        await sendMessageSafe(bot, msg.chat.id, text);
        
    } catch (error) {
        const errorText = await db.getText('error_general', "❌ خطایی در ریست پرامپت‌ها رخ داد.");
        bot.sendMessage(msg.chat.id, errorText);
    }
}


