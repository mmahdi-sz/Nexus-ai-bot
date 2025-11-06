import * as db from '../database.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { handleTelegramApiError } from '../core/chatLogic.js';

const ARABIC_PERSIAN_NUMBERS = '۰-۹\u06F0-\u06F9'; 
const NUMBER_REGEX = `([${ARABIC_PERSIAN_NUMBERS}\\d]+)`; 
const DURATION_REGEX = new RegExp(`${NUMBER_REGEX}\\s*(ثانیه|s|دقیقه|m|min|ساعت|h|روز|d|day)`, 'i');
const COMMAND_TO_TYPE = {
    'بن': 'ban', 'مسدود': 'ban', 'ban': 'ban',
    'کیک': 'kick', 'اخراج': 'kick', 'kick': 'kick',
    'سکوت': 'mute', 'میوت': 'mute', 'mute': 'mute',
    'حذف سکوت': 'unmute', 'حذف میوت': 'unmute', 'unmute': 'unmute',
    'حذف بن': 'unban', 'آنبن': 'unban', 'انبن': 'unban', 'unban': 'unban', 'pardon': 'unban',
};

const COMMAND_KEYS_REGEX = new RegExp(`^(${Object.keys(COMMAND_TO_TYPE).join('|').replace(/ /g, '\\s+')})\\s*`, 'i');

function parseDuration(durationString) {
    if (!durationString) return 0;
    
    const enDurationString = durationString.replace(/[\u06F0-\u06F9]/g, d => 
        String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30)
    ).replace(/[\u0660-\u0669]/g, d => 
        String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30)
    );

    const match = enDurationString.match(DURATION_REGEX);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    
    let seconds = 0;

    if (unit === 's' || unit === 'ثانیه') {
        seconds = value;
    } else if (unit === 'm' || unit === 'min' || unit === 'دقیقه') {
        seconds = value * 60;
    } else if (unit === 'h' || unit === 'ساعت') {
        seconds = value * 3600;
    } else if (unit === 'd' || unit === 'day' || unit === 'روز') {
        seconds = value * 86400;
    }
    
    return Math.min(seconds, 366 * 86400); 
}

async function checkBotAdminPermissions(bot, chatId) {
    try {
        const botId = parseInt(process.env.BOT_ID, 10);
        const chatMember = await bot.getChatMember(chatId, botId);
        
        if (chatMember.status !== 'administrator' && chatMember.status !== 'creator') {
            return { isAdmin: false, canRestrict: false, errorKey: 'guard_error_not_admin' };
        }
        
        if (!chatMember.can_restrict_members || !chatMember.can_delete_messages) {
            return { isAdmin: true, canRestrict: chatMember.can_restrict_members, canDelete: chatMember.can_delete_messages, errorKey: 'guard_error_no_restrict_perm' };
        }
        
        return { isAdmin: true, canRestrict: true, canDelete: true };
    } catch (error) {
        console.error('[groupGuard:checkBotAdminPermissions] Error fetching bot status:', error.message);
        return { isAdmin: false, canRestrict: false, canDelete: false, errorKey: 'guard_error_admin_check_failed' };
    }
}

function extractTargetUserAndDuration(bot, msg, commandWord) {
    let targetId = null;
    let targetUsername = null;
    let targetFirstName = null;
    let durationSeconds = 0;
    let targetMessageId = null;

    if (msg.reply_to_message) {
        targetMessageId = msg.reply_to_message.message_id;
        if (msg.reply_to_message.from) {
            targetId = msg.reply_to_message.from.id;
            targetUsername = msg.reply_to_message.from.username;
            targetFirstName = msg.reply_to_message.from.first_name;
        }
        const textAfterCommand = msg.text.substring(commandWord.length).trim();
        const durationMatch = textAfterCommand.match(DURATION_REGEX);
        if (durationMatch) {
             durationSeconds = parseDuration(durationMatch[0]);
        }
    } 
    
    if (!targetId && msg.text) {
        const textAfterCommand = msg.text.substring(commandWord.length).trim();
        const parts = textAfterCommand.split(/\s+/).filter(w => w.length > 0);
        
        for (const part of parts) {
            const durationMatch = part.match(DURATION_REGEX);
            
            if (!targetId) {
                if (!isNaN(parseInt(part)) && part.length > 5 && parseInt(part, 10) > 1000000) { 
                    targetId = parseInt(part, 10);
                } 
            }
            
            if (durationMatch) {
                durationSeconds = parseDuration(durationMatch[0]);
            }
        }
    }
    
    const finalTargetId = typeof targetId === 'number' && targetId > 0 ? targetId : null;
    
    return { 
        targetId: finalTargetId, 
        targetUsername,
        targetFirstName,
        durationSeconds,
        targetMessageId
    };
}

export async function handleGroupGuard(bot, msg, botInfo) {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private' || !msg.text) return false;

    const match = msg.text.trim().match(COMMAND_KEYS_REGEX);
    
    if (!match) return false; 
    
    const rawCommand = match[1].toLowerCase().trim();
    const commandType = COMMAND_TO_TYPE[rawCommand]; 
    const commandWord = rawCommand; 

    if (!commandType) return false; 
    
    if (msg.text.startsWith('/')) return false; 

    console.log(`[groupGuard:handleGroupGuard] START (Chat: ${chatId}, Type: ${commandType}, Raw Command: "${rawCommand}")`);
    
    const botPerms = await checkBotAdminPermissions(bot, chatId);
    const requiresRestrictPerm = ['ban', 'kick', 'mute', 'unmute', 'unban'].includes(commandType);
    
    if (requiresRestrictPerm) {
        if (!botPerms.canRestrict) {
            const errorText = await db.getText(botPerms.errorKey, "❌ آرتور مجوز کافی برای این کار رو نداره.");
            await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
            return true;
        }

        const issuerId = msg.from.id;
        try {
            const issuerMember = await bot.getChatMember(chatId, issuerId);
            const isIssuerAdmin = ['creator', 'administrator'].includes(issuerMember.status);
            
            if (!isIssuerAdmin) {
                const errorText = await db.getText('guard_error_not_admin', "❌ فقط ادمین‌های گروه اجازه صدور این فرمان را دارند.");
                await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
                return true;
            }

            if (!issuerMember.can_restrict_members) {
                const errorText = await db.getText('guard_error_no_restrict_perm', "❌ شما مجوز لازم برای محدودسازی اعضا را ندارید.");
                await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
                return true;
            }
        } catch (error) {
             console.error('[groupGuard:handleGroupGuard] Error checking issuer permissions:', error.message);
             const errorText = await db.getText('guard_error_admin_check_failed', "❌ یک خطای داخلی در بررسی دسترسی شما رخ داد.");
             await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
             return true;
        }
    }

    const { targetId, targetUsername, targetFirstName, durationSeconds, targetMessageId } = extractTargetUserAndDuration(bot, msg, commandWord);
    
    if (!targetId) {
        const errorText = await db.getText('guard_error_no_target', "❌ یوزرنیم یا ریپلای به نفر مورد نظر رو فراموش کردی رفیق.");
        await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
        return true;
    }
    
    if (targetId === botInfo.id || targetId === parseInt(process.env.BOT_OWNER_ID, 10) || msg.from.id === targetId) {
        const errorText = await db.getText('guard_error_target_is_safe', "❌ به نظر می‌رسه هدف ما از افراد خودی هست یا خودتی، رفیق.");
        await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
        return true;
    }
    
    const userDisplayName = targetUsername || targetFirstName || 'ناشناس';
    const userLink = targetUsername 
        ? `<a href="tg://user?id=${targetId}">@${targetUsername}</a>`
        : `<a href="tg://user?id=${targetId}">${userDisplayName}</a>`; 
    
    const userInfo = `[${targetId}] ${userLink}`;
    
    let finalUntilDate = 0; 
    if (durationSeconds > 0) {
        finalUntilDate = Math.floor(Date.now() / 1000) + durationSeconds;
    } 
    
    try {
        let successTextKey;

        if (botPerms.canDelete) {
            try {
                await bot.deleteMessage(chatId, msg.message_id);
            } catch (deleteError) {
                console.warn(`[groupGuard:handleGroupGuard] Failed to delete command message ${msg.message_id}:`, deleteError.message);
            }
        }

        const FULL_PERMISSIONS = {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false,
            can_promote_members: false
        };

        switch (commandType) {
            case 'ban':
                await bot.banChatMember(chatId, targetId, { until_date: finalUntilDate }); 
                successTextKey = finalUntilDate > 0 ? 'guard_success_temp_ban' : 'guard_success_ban';
                break;

            case 'kick':
                await bot.banChatMember(chatId, targetId, { until_date: Math.floor(Date.now() / 1000) + 60 }); 
                await bot.unbanChatMember(chatId, targetId);
                successTextKey = 'guard_success_kick';
                break;

            case 'mute':
                await bot.restrictChatMember(chatId, targetId, {
                    permissions: { can_send_messages: false }, 
                    until_date: finalUntilDate 
                });
                successTextKey = finalUntilDate > 0 ? 'guard_success_mute' : 'guard_success_mute_permanent';
                break;
            
            case 'unmute':
                await bot.restrictChatMember(chatId, targetId, {
                    permissions: FULL_PERMISSIONS,
                    until_date: 0 
                });
                successTextKey = 'guard_success_unmute';
                break;

            case 'unban':
                await bot.unbanChatMember(chatId, targetId);
                successTextKey = 'guard_success_unban';
                break;
        }

        let successText = await db.getText(successTextKey, `✅ عملیات ${commandType} با موفقیت انجام شد.`);
        
        if (successTextKey === 'guard_success_ban') {
            successText = `✅ کاربر ${userInfo} مسدود شد. این فرد دیگه از دار و دسته ما نیست!`;
        } else if (successTextKey === 'guard_success_temp_ban') {
            successText = `✅ کاربر ${userInfo} موقت مسدود شد. بعد از مدتی آزاد می‌شه.`;
        } else if (successTextKey === 'guard_success_kick') {
            successText = `✅ کاربر ${userInfo} کیک شد. حالا می‌تونه بره دنبال زندگی جدید.`;
        } else if (successTextKey === 'guard_success_mute_permanent') {
            successText = `✅ کاربر ${userInfo} سکوت دائمی شد. بهتره فکر کنه قبل از حرف زدن.`;
        } else if (successTextKey === 'guard_success_mute') {
            successText = `✅ کاربر ${userInfo} سکوت موقت شد. بهتره فکر کنه قبل از حرف زدن.`;
        } else if (successTextKey === 'guard_success_unmute') {
            successText = `✅ کاربر ${userInfo} سکوت شکسته شد! حالا می‌تونه دوباره حرف بزنه.`;
        } else if (successTextKey === 'guard_success_unban') {
            successText = `✅ کاربر ${userInfo} رفع مسدودیت شد. این فرد می‌تونه دوباره برگرده.`;
        }
        
        await sendMessageSafe(bot, chatId, successText, { parse_mode: 'HTML' });
        
        return true;

    } catch (error) {
        console.error(`[groupGuard:handleGroupGuard] Telegram API Error for ${commandType} on target ${targetId}:`, error.message);
        
        const replyOptions = targetMessageId ? { reply_to_message_id: targetMessageId } : {};

        if (error.response?.body?.description?.includes('user is an administrator')) {
            const errorText = await db.getText('guard_error_target_is_admin', "❌ این رفیق یه تفنگدار قدیمیه، نمی‌تونم لمسش کنم!");
            await sendMessageSafe(bot, chatId, errorText, replyOptions);
        } else {
            const errorText = await db.getText('guard_error_telegram_api', "❌ یه خطای تلگرامی پیش اومد. مطمئن شو که هدف در گروه هست.");
            await sendMessageSafe(bot, chatId, errorText, replyOptions);
        }
        return true;
    }
}