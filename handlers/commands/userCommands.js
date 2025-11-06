import * as db from '../../database.js';
import { sendMessageSafe, escapeMarkdownV2 } from '../../utils/textFormatter.js';
import { handleTelegramApiError } from '../../core/chatLogic.js';
import { startKeyDonationWizard } from '../userKeyDonation.js';

export async function handleNewCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    try {
        await db.saveDailyConversation(chatId, userId, []);
        
        const message = await db.getText('command_new', 
            'باشه رفیق، دفتر خاطرات رو پاک کردم. از اول شروع می‌کنیم.');
        
        await sendMessageSafe(bot, chatId, message, {
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        handleTelegramApiError(error, 'handleNewCommand');
    }
}

export async function handleForgetCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    try {
        await db.updateUserMemory(userId, ''); 
        
        const message = await db.getText('command_forget',
            'همه چیزهایی که ازت یاد گرفتم رو فراموش کردم رفیق. مثل اولین روز.');
        
        await sendMessageSafe(bot, chatId, message, {
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        handleTelegramApiError(error, 'handleForgetCommand');
    }
}

export async function handleStatusCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    try {
        const isPremium = await db.isUserPremium(userId);
        const config = await db.getSetting('config', {});
        const LIMITS = config.userLimits || { day: 10, week: 40, month: 100 };
        
        const dayCount = await db.getUserMessageCount(userId, 'day');
        const weekCount = await db.getUserMessageCount(userId, 'week');
        const monthCount = await db.getUserMessageCount(userId, 'month');
        
        let statusText = `📊 *وضعیت شما رفیق:*\n\n`;
        
        if (isPremium) {
            const premiumText = await db.getText('command_status_premium', '⭐ شما یک *حامی* هستید\\!\n🔓 محدودیت پیام برای شما نداریم رفیق\\! 🤠');
            statusText += premiumText;
        } else {
            const noPremiumText = await db.getText('command_status_no_premium', 
                'می‌خوای حامی بشی و بدون محدودیت حرف بزنیم؟\nدستور /donate رو بزن.');
                
            statusText += `💬 *پیام‌های باقی‌مانده:*\n`;
            statusText += `  \\- امروز: ${escapeMarkdownV2(dayCount.toString())}/${escapeMarkdownV2(LIMITS.day.toString())}\n`;
            statusText += `  \\- این هفته: ${escapeMarkdownV2(weekCount.toString())}/${escapeMarkdownV2(LIMITS.week.toString())}\n`;
            statusText += `  \\- این ماه: ${escapeMarkdownV2(monthCount.toString())}/${escapeMarkdownV2(LIMITS.month.toString())}\n\n`;
            statusText += escapeMarkdownV2(noPremiumText);
        }
        
        return sendMessageSafe(bot, chatId, statusText, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'MarkdownV2'
        });
    } catch (error) {
        handleTelegramApiError(error, 'handleStatusCommand');
    }
}

export async function handleDonateCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    try {
        if (msg.chat.type !== 'private') {
            const groupErrorText = await db.getText('donate_group_error', "رفیق، برای اهدای کلید باید به چت خصوصی من بیای. اینجا فقط اسلحه می‌کشیم.");
            return sendMessageSafe(bot, chatId, groupErrorText);
        }
        
        await db.clearUserState(userId); 
        await startKeyDonationWizard(bot, msg);

    } catch (error) {
        handleTelegramApiError(error, 'handleDonateCommand');
    }
}