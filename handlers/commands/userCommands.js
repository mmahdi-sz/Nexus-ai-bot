
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
        const LIMITS = config.userLimits || { day: 26 };
        
        const dayCount = await db.getUserMessageCount(userId, 'day');
        
        let statusText = `📊 *وضعیت شما رفیق:*\n\n`;
        
        if (isPremium) {
            const premiumText = await db.getText('command_status_premium', '⭐ شما یک *حامی* هستید\\!\n🔓 محدودیت پیام برای شما نداریم رفیق\\! 🤠');
            statusText += premiumText;
        } else {
            const noPremiumText = await db.getText('command_status_no_premium', 
                'می‌خوای حامی بشی و بدون محدودیت حرف بزنیم؟\nدستور /donate رو بزن.');
                
            statusText += `💬 *پیام‌های باقی‌مانده:*\n`;
            statusText += `  \\- امروز: ${escapeMarkdownV2(dayCount.toString())}/${escapeMarkdownV2(LIMITS.day.toString())}\n\n`;
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

export async function handleUserCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (msg.chat.type !== 'private') {
        return sendMessageSafe(bot, chatId, "این دستور فقط در چت خصوصی کار می‌کنه.");
    }

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

    sendMessageSafe(bot, chatId, statusText, {
        reply_markup: keyboard,
        parse_mode: 'Markdown'
    });
}

export async function handleToneCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    try {
        const currentTone = await db.getUserTone(userId);
        
        const keyboard = {
            inline_keyboard: [
                [
                    { 
                        text: currentTone === 'rude' ? '✅ بی‌ادب و فحش‌دار' : '⚪️ بی‌ادب و فحش‌دار', 
                        callback_data: 'tone_set_rude' 
                    }
                ],
                [
                    { 
                        text: currentTone === 'polite' ? '✅ با ادب و مشتی' : '⚪️ با ادب و مشتی', 
                        callback_data: 'tone_set_polite' 
                    }
                ]
            ]
        };
        
        const text = `🎭 *تنظیم لحن آرتور*

لحن فعلی: *${currentTone === 'rude' ? 'بی‌ادب و فحش‌دار' : 'با ادب و مشتی'}*

لحن مورد نظر رو انتخاب کن:`;
        
        await sendMessageSafe(bot, chatId, text, {
            reply_markup: keyboard,
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        handleTelegramApiError(error, 'handleToneCommand');
    }
}

export async function handleRefreshMemoryCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    try {
        const history = await db.getDailyConversation(chatId, userId);
        
        if (!history || history.length < 10) {
            return sendMessageSafe(bot, chatId, 
                'هنوز به اندازه کافی با هم حرف نزدیم که چیزی یادم بمونه رفیق.',
                { reply_to_message_id: msg.message_id }
            );
        }
        
        const memoryManager = await import('../../memoryManager.js');
        const summary = await memoryManager.processAndSummarizeDailyLogs();
        
        if (summary) {
            await sendMessageSafe(bot, chatId, 
                '✅ حافظه‌ام رو تازه کردم. الان بهتر یادمه چی‌کارا هستی.',
                { reply_to_message_id: msg.message_id }
            );
        }
    } catch (error) {
        handleTelegramApiError(error, 'handleRefreshMemoryCommand');
    }
}


