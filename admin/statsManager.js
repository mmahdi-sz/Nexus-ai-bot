import * as db from '../database.js';
import { stripMarkdown, editMessageSafe, escapeMarkdownV2, boldText, inlineCode } from '../utils/textFormatter.js';

const statsMenuKeyboard = {
    inline_keyboard: [
        [{ text: '👥 آمار کاربرها', callback_data: 'stats_users' }],
        [{ text: '🏘️ آمار گروه‌ها', callback_data: 'stats_groups' }],
        [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]
    ]
};

export async function handleStatsMenu(bot, msg, data) {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    if (data === 'stats_menu_main') {
        return editMessageSafe(bot, chatId, messageId, '📊 **منوی آمار**\n\nکدام بخش را می‌خواهید مشاهده کنید؟', {
            reply_markup: statsMenuKeyboard,
            parse_mode: 'Markdown'
        });
    }
    
    if (data === 'stats_users') {
        const dayStats = await db.getUserStats('day');
        const weekStats = await db.getUserStats('week');
        const monthStats = await db.getUserStats('month');
        const allStats = await db.getUserStats('all');
        const donatedKeysCount = await db.countDonatedKeys();

        const text = `📊 *آمار کاربران*

\\- *👤 امروز:* ${escapeMarkdownV2(dayStats.unique_users.toString())} کاربر یکتا \\(${escapeMarkdownV2(dayStats.total_messages.toString())} پیام\\)
\\- *📅 هفته گذشته:* ${escapeMarkdownV2(weekStats.unique_users.toString())} کاربر یکتا \\(${escapeMarkdownV2(weekStats.total_messages.toString())} پیام\\)
\\- *🗓️ ماه گذشته:* ${escapeMarkdownV2(monthStats.unique_users.toString())} کاربر یکتا \\(${escapeMarkdownV2(monthStats.total_messages.toString())} پیام\\)
\\- *🌍 از ابتدا:* ${escapeMarkdownV2(allStats.unique_users.toString())} کاربر یکتا \\(${escapeMarkdownV2(allStats.total_messages.toString())} پیام\\)

${boldText('🔑 کلیدهای اهدا شده توسط کاربران:')} ${escapeMarkdownV2(donatedKeysCount.toString())} عدد`;


        return editMessageSafe(bot, chatId, messageId, text, { 
            reply_markup: { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'stats_menu_main' }]] },
            parse_mode: 'MarkdownV2'
        });
    }
    
    if (data === 'stats_groups' || data.startsWith('stats_groups_page_')) {
        const groupStats = await db.getAllGroupStats();
        const groupList = await db.getGroupDetailsList();
        
        const GROUPS_PER_PAGE = 20;
        const totalGroups = groupList.length;
        const totalPages = Math.ceil(totalGroups / GROUPS_PER_PAGE) || 1;
        
        let currentPage = 1;
        if (data.startsWith('stats_groups_page_')) {
            currentPage = parseInt(data.split('_').pop(), 10) || 1;
        }
        
        if (currentPage < 1) currentPage = 1;
        if (currentPage > totalPages) currentPage = totalPages;
        
        const startIndex = (currentPage - 1) * GROUPS_PER_PAGE;
        const endIndex = startIndex + GROUPS_PER_PAGE;
        const groupsOnPage = groupList.slice(startIndex, endIndex);
        
        let listText = groupsOnPage.map((g, index) => {
            const globalIndex = startIndex + index + 1;
            const title = escapeMarkdownV2(stripMarkdown(g.chat_title || 'بدون نام').substring(0, 40));
            const status = g.is_enabled ? 'فعال ✅' : 'غیرفعال ❌';
            const memberCount = escapeMarkdownV2(g.member_count.toString());
            return `${escapeMarkdownV2(globalIndex.toString())}\\. ${title} \\- ${status} \\- ${memberCount} عضو`;
        }).join('\n');
        
        if (!listText) listText = escapeMarkdownV2("هنوز گروهی ثبت نشده است");
        
        const totalGroupsEsc = escapeMarkdownV2(groupStats.total_groups.toString());
        const enabledGroupsEsc = escapeMarkdownV2(groupStats.enabled_groups.toString());
        const totalMembersEsc = escapeMarkdownV2(groupStats.total_members.toString());
        const currentPageEsc = escapeMarkdownV2(currentPage.toString());
        const totalPagesEsc = escapeMarkdownV2(totalPages.toString());
        
        const text = `🏙️ *آمار گروه‌ها*

\\- تعداد کل: ${totalGroupsEsc}
\\- گروه‌های فعال: ${enabledGroupsEsc}
\\- مجموع اعضا: ${totalMembersEsc}

${boldText(`📄 صفحه ${currentPageEsc} از ${totalPagesEsc}`)}

${listText}`;
        
        const keyboard = [];
        const navRow = [];
        
        if (currentPage > 1) {
            navRow.push({ text: '⬅️ قبلی', callback_data: `stats_groups_page_${currentPage - 1}` });
        }
        
        navRow.push({ text: `${currentPage}/${totalPages}`, callback_data: 'stats_groups' });
        
        if (currentPage < totalPages) {
            navRow.push({ text: 'بعدی ➡️', callback_data: `stats_groups_page_${currentPage + 1}` });
        }
        
        keyboard.push(navRow);
        keyboard.push([{ text: '↩️ بازگشت', callback_data: 'stats_menu_main' }]);
        
        return editMessageSafe(bot, chatId, messageId, text, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'MarkdownV2'
        });
    }

    return false;
}