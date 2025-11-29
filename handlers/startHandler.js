
import * as db from '../database.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { handleCallbackQuery } from '../adminPanel.js';
import { handleTelegramApiError } from '../core/chatLogic.js';

let BOT_OWNER_ID;
let botInfo;

export function initStartHandler(deps) {
    BOT_OWNER_ID = deps.BOT_OWNER_ID;
    botInfo = deps.botInfo;
    console.log('[startHandler:initStartHandler] Initialized.');
}

export async function handleStartCommand(bot, msg, match) {
    console.log(`[startHandler:handleStartCommand] START (User: ${msg.from.id}, Payload: ${match?.[1] || 'none'})`);
    const payload = match?.[1];
    const userId = msg.from.id;

    // --- OWNER START LOGIC ---
    if (userId === BOT_OWNER_ID) {
        if (payload === 'submitkey') {
            await db.clearOwnerState(BOT_OWNER_ID);
        }
        bot.sendMessage(msg.chat.id, await db.getText('start_loading_admin', "درحال بارگذاری پنل مدیریت..."))
            .then(sentMsg => {
                handleCallbackQuery(bot, { message: sentMsg, data: 'admin_panel', from: msg.from });
            })
            .catch(err => handleTelegramApiError(err, 'onText:/start - admin panel'));
        console.log('[startHandler:handleStartCommand] END - Owner: Opening admin panel.');
        return;
    }

    // --- USER START LOGIC ---
    try {
        // 1. Handle Deep Link for API Guide
        if (payload === 'show_api_guide' && msg.chat.type === 'private') {
            await bot.answerCallbackQuery(msg.id).catch(() => {});
            
            const mediaList = await db.getAllTutorialMedia();
            const tutorialText = await db.getTutorialTextForApi();
            const startLink = `https://t.me/${botInfo.username}?start=submitkey`;
            
            const canRequest = await db.canRequestAPI(userId);
            if (!canRequest) {
                const cooldown = await db.getAPIRequestCooldown(userId);
                if (cooldown) {
                    const message = await db.getText('api_guide_cooldown', '⏱️ رفیق، باید {hours} ساعت و {minutes} دقیقه دیگه صبر کنی تا بتونی دوباره راهنما رو ببینی.');
                    console.log('[startHandler:handleStartCommand] END - User: Cooldown for API guide.');
                    return bot.sendMessage(msg.chat.id, message.replace('{hours}', cooldown.hours).replace('{minutes}', cooldown.minutes)).catch(err => handleTelegramApiError(err, 'show_api_guide - cooldown'));
                }
            }
            
            await db.updateAPIRequestTime(userId);
            
            if (mediaList.length === 0 && !tutorialText) {
                const noGuideText = await db.getText('tutorial_no_guide', "راهنمایی هنوز تنظیم نشده رفیق، ولی اگه کلید API داری می‌تونی همین الان اهداش کنی.");
                await bot.sendMessage(msg.chat.id, noGuideText, {
                    reply_markup: { inline_keyboard: [[{ text: await db.getText('apikey_button_text', '✅ اهدای کلید در چت خصوصی'), url: startLink }] ]}
                }).catch(err => handleTelegramApiError(err, 'show_api_guide - no tutorial'));
                console.log('[startHandler:handleStartCommand] END - User: Sent no-guide message.');
                return;
            }

            if (mediaList.length > 0) {
                for (const media of mediaList) {
                    try {
                        const sendOptions = { caption: media.caption || '' };
                        if (media.file_type === 'photo') {
                            await bot.sendPhoto(msg.chat.id, media.file_id, sendOptions);
                        } else if (media.file_type === 'video') {
                            await bot.sendVideo(msg.chat.id, media.file_id, sendOptions);
                        } else if (media.file_type === 'document') {
                            await bot.sendDocument(msg.chat.id, media.file_id, sendOptions);
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        console.error(`[startHandler:handleStartCommand] Failed to send media ${media.id}:`, error.message);
                        handleTelegramApiError(error, `show_api_guide - sending media ${media.id}`);
                    }
                }
            }
            
            if (tutorialText) {
                const keyboard = {
                    inline_keyboard: [
                        [{ text: await db.getText('apikey_button_text', '✅ اهدای کلید در چت خصوصی'), url: startLink }]
                    ]
                };

                if (tutorialText.button_url && tutorialText.button_text) {
                    keyboard.inline_keyboard.unshift([{
                        text: tutorialText.button_text,
                        url: tutorialText.button_url
                    }]);
                }
                
                await sendMessageSafe(bot, msg.chat.id, tutorialText.tutorial_text, {
                    reply_markup: keyboard
                });
            }
            console.log('[startHandler:handleStartCommand] END - User: Sent API guide (media/text).');
            return;
        }

        // 2. Handle Deep Link for API Key Submission
        if (payload === 'submitkey' && msg.chat.type === 'private') {
            await db.setUserState(userId, 'awaiting_user_api_key');
            const awaitingText = await db.getText('apikey_awaiting', "عالیه رفیق. حالا کلید API خودت رو که از آموزش‌ها یاد گرفتی، برام بفرست.");
            await sendMessageSafe(bot, msg.chat.id, awaitingText);
            console.log('[startHandler:handleStartCommand] END - User: Set key submission state.');
            return;
        }

        // 3. Handle Regular /start
        const startMessage = await db.getText('start_message', "من آرتورم، آرتور مورگان. کاری داشتی؟");
        const inviteLink = `https://t.me/${botInfo.username}?startgroup=true`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '➕ افزودن به گروه', url: inviteLink }]
            ]
        };

        sendMessageSafe(bot, msg.chat.id, startMessage, {
            reply_markup: keyboard
        });
        console.log('[startHandler:handleStartCommand] END - User: Sent regular start message.');
    } catch (error) {
        console.error('[startHandler:handleStartCommand] Error in /start handler for user:', error.message);
    }
}


