
import * as db from './database.js';
import { checkPrivateChatStatus } from './core/chatLogic.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
const PRIVATE_CHAT_REQUIREMENT_LIMIT = 5;

export async function checkUserLimit(userId, appConfig) {
    const numericUserId = parseInt(userId, 10);
    
    if (numericUserId === BOT_OWNER_ID && BOT_OWNER_ID !== 0) {
        return {
            allowed: true,
            isPremium: true,
            isOwner: true
        };
    }

    const isPremium = await db.isUserPremium(userId);
    if (isPremium) {
        return {
            allowed: true,
            isPremium: true
        };
    }

    const LIMITS = appConfig.userLimits;

    const dayCount = await db.getUserMessageCount(userId, 'day');

    const usage = {
        day: {
            used: dayCount,
            limit: LIMITS.day
        }
    };
    
    if (dayCount >= PRIVATE_CHAT_REQUIREMENT_LIMIT && dayCount < LIMITS.day) {
        return {
            allowed: true,
            isPremium: false,
            usage,
            requiresPrivateChatCheck: true
        };
    }
    
    if (dayCount >= LIMITS.day) {
        const message = await db.getText('limit_message_day', `رفیق، سهمیه امروزت تموم شده. فردا دوباره سر بزن.`);
        return {
            allowed: false,
            type: 'day',
            message: message, 
            usage
        };
    }

    return {
        allowed: true,
        isPremium: false,
        usage
    };
}

export async function createAPIRequestButton() {
    const buttonText = await db.getText('limit_button_text', '🤠 **راهنما و کمک به زندگی به آرتور** (بدون محدودیت)');
    
    const deepLinkUrl = `https://t.me/${process.env.BOT_USERNAME || 'ArthurBot'}?start=show_api_guide`;
    
    return {
        inline_keyboard: [[
            {
                text: buttonText, 
                url: deepLinkUrl
            }
        ]]
    };
}

export async function createPrivateChatRequiredButton() {
    const buttonText = await db.getText('private_chat_required_button_text', '✅ استارت/آنبلاک کردن چت خصوصی');
    
    const deepLinkUrl = `https://t.me/${process.env.BOT_USERNAME || 'ArthurBot'}`;
    
    return {
        inline_keyboard: [[
            {
                text: buttonText, 
                url: deepLinkUrl
            }
        ]]
    };
}


