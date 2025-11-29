
import * as db from '../database.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { handleTelegramApiError } from '../core/chatLogic.js';
import { isOwner } from '../utils/ownerCheck.js'; // Added import

const ARABIC_PERSIAN_NUMBERS = '۰-۹\u06F0-\u06F9'; 
const NUMBER_REGEX = `([${ARABIC_PERSIAN_NUMBERS}\\d]+)`; 
const DURATION_REGEX = new RegExp(`${NUMBER_REGEX}\\s*(ثانیه|s|دقیقه|m|min|ساعت|h|روز|d|day)`, 'i');

const COMMAND_TO_TYPE = {
    'بن': 'ban', 'مسدود': 'ban', 'ban': 'ban', 'بنگ': 'ban',
    'کیک': 'kick', 'اخراج': 'kick', 'kick': 'kick', 'سیک': 'kick', 'صیک': 'kick',
    'سکوت': 'mute', 'میوت': 'mute', 'mute': 'mute',
    'حذف سکوت': 'unmute', 'حذف میوت': 'unmute', 'unmute': 'unmute',
    'حذف بن': 'unban', 'آنبن': 'unban', 'انبن': 'unban', 'unban': 'unban', 'pardon': 'unban',
};

// Modified Regex to match command only at start of string
const COMMAND_KEYS_REGEX = new RegExp(`^(${Object.keys(COMMAND_TO_TYPE).join('|').replace(/ /g, '\\s+')})(?:\\s+|$)`, 'i');

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

function getDurationText(seconds) {
    if (seconds === 0) return 'دائمی';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days} روز`);
    if (hours > 0) parts.push(`${hours} ساعت`);
    if (minutes > 0) parts.push(`${minutes} دقیقه`);
    return parts.join(' و ') || 'کمتر از یک دقیقه';
}

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
    
    if (targetId === botInfo.id || isOwner(targetId) || msg.from.id === targetId) {
        const errorText = await db.getText('guard_error_target_is_safe', "❌ به نظر می‌رسه هدف ما از افراد خودی هست یا خودتی، رفیق.");
        await sendMessageSafe(bot, chatId, errorText, { reply_to_message_id: msg.message_id });
        return true;
    }
    
    const userDisplayName = targetUsername || targetFirstName || 'ناشناس';
    const userLink = `<a href="tg://user?id=${targetId}">${userDisplayName}</a>`;
    const userInfo = `[${targetId}] ${userLink}`;
    
    let finalUntilDate = 0; 
    if (durationSeconds > 0) {
        finalUntilDate = Math.floor(Date.now() / 1000) + durationSeconds;
    } 
    
    try {
        let successText;
        const untilDate = finalUntilDate > 0 ? new Date(finalUntilDate * 1000) : null;
        const jalaliDate = untilDate ? toJalali(untilDate) : null;
        const durationText = getDurationText(durationSeconds);

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
                if (finalUntilDate > 0) {
                    successText = `✅ کاربر ${userInfo} به مدت ${durationText} مسدود شد.\n\n📅 تا تاریخ: ${jalaliDate}`;
                } else {
                    successText = `✅ کاربر ${userInfo} به صورت دائم مسدود شد.`;
                }
                break;

            case 'kick':
                await bot.banChatMember(chatId, targetId, { until_date: Math.floor(Date.now() / 1000) + 60 }); 
                await bot.unbanChatMember(chatId, targetId);
                successText = `✅ کاربر ${userInfo} از گروه اخراج شد.`;
                break;

            case 'mute':
                await bot.restrictChatMember(chatId, targetId, {
                    permissions: { can_send_messages: false }, 
                    until_date: finalUntilDate 
                });
                if (finalUntilDate > 0) {
                    successText = `✅ کاربر ${userInfo} به مدت ${durationText} سکوت شد.\n\n📅 تا تاریخ: ${jalaliDate}\n\n🔇 این کاربر نمی‌تواند در گروه پیام ارسال کند.`;
                } else {
                    successText = `✅ کاربر ${userInfo} به صورت دائم سکوت شد.\n\n🔇 این کاربر نمی‌تواند در گروه پیام ارسال کند.`;
                }
                break;
            
            case 'unmute':
                await bot.restrictChatMember(chatId, targetId, {
                    permissions: FULL_PERMISSIONS,
                    until_date: 0 
                });
                successText = `✅ سکوت کاربر ${userInfo} برداشته شد.\n\n🔊 این کاربر اکنون می‌تواند در گروه پیام ارسال کند.`;
                break;

            case 'unban':
                await bot.unbanChatMember(chatId, targetId);
                successText = `✅ مسدودیت کاربر ${userInfo} برداشته شد.\n\n✓ این کاربر می‌تواند دوباره به گروه بپیوندد.`;
                break;
        }

        // Corrected reply logic: Reply to the TARGET message if it exists, otherwise reply to the admin's command.
        const replyToId = targetMessageId || msg.message_id;
        await sendMessageSafe(bot, chatId, successText, { parse_mode: 'HTML', reply_to_message_id: replyToId });
        
        return true;

    } catch (error) {
        console.error(`[groupGuard:handleGroupGuard] Telegram API Error for ${commandType} on target ${targetId}:`, error.message);
        
        const replyOptions = targetMessageId ? { reply_to_message_id: targetMessageId } : { reply_to_message_id: msg.message_id };

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


