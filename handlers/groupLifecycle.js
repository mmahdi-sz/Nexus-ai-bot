import * as db from '../database.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { handleTelegramApiError } from '../core/chatLogic.js';

let botInfo;

export function initGroupLifecycle(deps) {
    botInfo = deps.botInfo;
}

export async function handleEnableCommand(bot, msg) {
    if (msg.chat.type === 'private') {
        const privateOnlyText = await db.getText('enable_private_only', "این دستور فقط در گروه‌ها کار می‌کنه رفیق.");
        sendMessageSafe(bot, msg.chat.id, privateOnlyText);
        return;
    }

    try {
        const chatMember = await bot.getChatMember(msg.chat.id, msg.from.id);
        const isAdmin = ['creator', 'administrator'].includes(chatMember.status);

        if (!isAdmin) {
            const adminRequiredText = await db.getText('enable_admin_required', "فقط رئیس گروه (داچ) می‌تونه این دستور رو بده.");
            await sendMessageSafe(bot, msg.chat.id, adminRequiredText);
            return;
        }

        const isAlreadyEnabled = await db.isChatAuthorized(msg.chat.id);
        if (isAlreadyEnabled) {
            const alreadyActiveText = await db.getText('enable_already_active', "اینجا که قبلاً کمپ زده بودیم! آرتور آماده‌است.");
            await sendMessageSafe(bot, msg.chat.id, alreadyActiveText);
            return;
        }

        await db.addChat(msg.chat.id, msg.from.id);

        const chatDetails = await bot.getChat(msg.chat.id);
        const memberCount = await bot.getChatMemberCount(msg.chat.id);
        await db.updateGroupStats(
            msg.chat.id,
            chatDetails.title,
            memberCount,
            true
        );

        const enableSuccessText = await db.getText('enable_success', "دار و دسته ما تو این منطقه کمپ زدن! آرتور آماده‌است.");
        await sendMessageSafe(bot, msg.chat.id, enableSuccessText);

    } catch (error) {
        if (error.code === 'ETELEGRAM' && error.response?.body?.description.includes('CHAT_ADMIN_REQUIRED')) {
            const adminRequiredText = await db.getText('enable_admin_required', "هی رفیق! برای اینکه بتونم اینجا کار کنم، باید من رو ادمین گروه کنی.");
            sendMessageSafe(bot, msg.chat.id, adminRequiredText);
        } else {
            const generalError = await db.getText('error_general', "لعنتی! انگار چندتا از افراد پینکرتون سرور رو به آتیش کشیدن!");
            sendMessageSafe(bot, msg.chat.id, generalError);
        }
    }
}

export async function handleNewChatMembers(bot, msg) {
    if (!botInfo) {
        return;
    }
    
    try {
        const botWasAdded = msg.new_chat_members.some(member => member.id === botInfo.id);
        if (botWasAdded) {
            
            const isAlreadyEnabled = await db.isChatAuthorized(msg.chat.id);
            
            if (!isAlreadyEnabled) {
                const addedByUserId = msg.from?.id || 0; 
                await db.addChat(msg.chat.id, addedByUserId);

                const chatDetails = await bot.getChat(msg.chat.id);
                const memberCount = await bot.getChatMemberCount(msg.chat.id);
                await db.updateGroupStats(
                    msg.chat.id,
                    chatDetails.title,
                    memberCount,
                    true
                );
            }
            
            const welcomeMessage = await db.getText('enable_success', "دار و دسته ما تو این منطقه کمپ زدن! آرتور آماده‌است.");

            sendMessageSafe(bot, msg.chat.id, welcomeMessage).catch(async (error) => {
                handleTelegramApiError(error, `on:message - new member welcome`);
                
                if (error.response?.body?.description.includes('kicked') || error.response?.body?.description.includes('chat not found')) {
                    await db.purgeChatData(msg.chat.id);
                }
            });
        }
    } catch (error) {
        console.error('[groupLifecycle:handleNewChatMembers] Error in new_chat_members handler:', error.message);
    }
}