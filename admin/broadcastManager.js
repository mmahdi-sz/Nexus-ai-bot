
import * as db from '../database.js';
import { sendMessageSafe, editMessageSafe, escapeMarkdownV2, boldText, codeBlock, inlineCode } from '../utils/textFormatter.js';
import { handleTelegramApiError } from '../core/chatLogic.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
const BOT_ID = parseInt(process.env.BOT_ID || '0', 10);
const BROADCAST_TIMEOUT_MS = 10 * 60 * 1000;

const BROADCAST_WIZARD_STATES = {
    SELECT_TYPE: 'select_type',
    SELECT_TARGET: 'select_target',
    ENTER_CONTENT: 'enter_content',
    PREVIEW: 'preview',
    CONFIRM: 'confirm',
    SENDING: 'sending',
    COMPLETED: 'completed'
};

export async function startBroadcastWizard(bot, msg) {
    const ownerId = msg.from.id;
    
    const welcomeText = `📢 *ویزارد پخش همگانی*

🎯 *مراحل:*
[1]ـ انتخاب نوع ارسال
[2]ـ انتخاب مخاطبان
[3]ـ تنظیم محتوا
[4]ـ پیش‌نمایش
[5]ـ تایید و ارسال

⚠️ *توجه:*
\\- این عملیات غیرقابل بازگشت است
\\- ارسال ممکن است چند دقیقه طول بکشد
\\- می‌توانید در هر مرحله لغو کنید

شروع می‌کنیم؟`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '▶️ شروع', callback_data: 'broadcast_wiz_start' }],
            [{ text: '❌ انصراف', callback_data: 'broadcast_wiz_cancel' }]
        ]
    };
    
    await db.clearOwnerState(ownerId);
    
    await sendMessageSafe(bot, msg.chat.id, welcomeText, { 
        reply_markup: keyboard,
        parse_mode: 'MarkdownV2' 
    });
}

async function getBroadcastTargetStats() {
    const userStats = await db.getUserStats('all');
    const groupStats = await db.getAllGroupStats();
    
    const userCount = userStats.unique_users;
    const groupCount = groupStats.enabled_groups;
    const allCount = userCount + groupCount;
    
    let allUserIds = await db.getAllUserIds();
    allUserIds = allUserIds.map(u => u.user_id).filter(id => id !== BOT_OWNER_ID);

    const allGroupIds = (await db.getGroupDetailsList()).filter(g => g.is_enabled).map(g => g.chat_id);
    
    return { 
        userCount, 
        groupCount, 
        allCount, 
        allUserIds, 
        allGroupIds 
    };
}

async function showBroadcastPreview(bot, ownerId, messageId, content, type, target) {
    const { allUserIds, allGroupIds, userCount, groupCount, allCount } = await getBroadcastTargetStats();
    
    let targetChatIds = [];
    let recipientCount = 0;
    
    if (target === 'users') {
        targetChatIds = allUserIds;
        recipientCount = userCount;
    } else if (target === 'groups') {
        targetChatIds = allGroupIds;
        recipientCount = groupCount;
    } else if (target === 'all') {
        targetChatIds = [...new Set([...allUserIds, ...allGroupIds])];
        recipientCount = targetChatIds.length;
    }
    
    const targetDisplay = target === 'users' ? 'فقط کاربران' : target === 'groups' ? 'فقط گروه‌ها' : 'همه';
    const typeDisplay = type === 'forward' ? 'فوروارد' : type === 'pin' ? 'ساده + پین' : 'ساده';

    const previewText = `👁 *مرحله 4 از 5: پیش‌نمایش*

[▰▰▰▰▱] 80%

*تنظیمات:*
\\- 📝 نوع: ${escapeMarkdownV2(typeDisplay)}
\\- 👥 مخاطب: ${escapeMarkdownV2(targetDisplay)}
\\- 📊 تعداد: ${escapeMarkdownV2(recipientCount.toString())} نفر
\\- ⏱ زمان تخمینی: ${escapeMarkdownV2(Math.ceil(recipientCount / 5).toString())} ثانیه

*پیش‌نمایش محتوا:*`;
    
    await editMessageSafe(bot, ownerId, messageId, previewText, {
        parse_mode: 'MarkdownV2'
    });
    
    let previewMessageId = null;

    if (content.type === 'message') {
        const caption = content.text + '\n\n' + escapeMarkdownV2('└────────────────┘\n\n⬆️ این همان چیزی است که کاربران خواهند دید');

        if (content.media?.type === 'photo') {
            const sent = await bot.sendPhoto(ownerId, content.media.file_id, {
                caption: caption,
                parse_mode: 'Markdown'
            }).catch(e => handleTelegramApiError(e, 'Broadcast Preview Photo'));
            previewMessageId = sent?.message_id;
        } else if (content.media?.type === 'video') {
            const sent = await bot.sendVideo(ownerId, content.media.file_id, {
                caption: caption,
                parse_mode: 'Markdown'
            }).catch(e => handleTelegramApiError(e, 'Broadcast Preview Video'));
            previewMessageId = sent?.message_id;
        } else {
            const sent = await sendMessageSafe(bot, ownerId, 
                content.text + '\n\n' + escapeMarkdownV2('└────────────────┘\n\n⬆️ این همان چیزی است که کاربران خواهند دید'),
                { parse_mode: 'Markdown' });
            previewMessageId = sent?.message_id;
        }
    } else if (content.type === 'forward') {
        const sent = await bot.forwardMessage(ownerId, content.from_chat_id, content.message_id)
            .catch(e => handleTelegramApiError(e, 'Broadcast Preview Forward'));
        
        await sendMessageSafe(bot, ownerId, 
            escapeMarkdownV2('└────────────────┘\n\n⬆️ این همان چیزی است که کاربران خواهند دید'), 
            { parse_mode: 'MarkdownV2' });
        previewMessageId = sent?.message_id;
    }
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ تایید و ارسال', callback_data: 'broadcast_wiz_confirm' }],
            [
                { text: '✏️ ویرایش محتوا', callback_data: `broadcast_wiz_content_${target}|${type}` },
                { text: '⚙️ تغییر تنظیمات', callback_data: 'broadcast_wiz_start' }
            ],
            [{ text: '❌ لغو کامل', callback_data: 'broadcast_wiz_cancel' }]
        ]
    };
    
    await sendMessageSafe(bot, ownerId, 
        boldText('آیا از ارسال این پیام مطمئن هستید؟'), 
        { reply_markup: keyboard, parse_mode: 'MarkdownV2' });
    
    await db.setOwnerState(ownerId, BROADCAST_WIZARD_STATES.PREVIEW, {
        message_id: messageId,
        content: content,
        type: type,
        target: target,
        targetChatIds: targetChatIds,
        recipientCount: recipientCount,
        step: 4
    });
}

export async function handleBroadcastContentInput(bot, msg, ownerState) {
    const ownerId = msg.from.id;
    const originalPanelMessageId = ownerState.data.message_id;
    const { type, target, timeout_at } = ownerState.data;
    
    if (Date.now() > timeout_at) {
        await db.clearOwnerState(ownerId);
        await sendMessageSafe(bot, ownerId, 
            `${boldText('⏱ زمان شما تمام شد')}\n\nلطفاً مجدداً ${inlineCode('/broadcast')} را اجرا کنید\\.`, { parse_mode: 'MarkdownV2' });
        return true;
    }
    
    let content = null;
    let mediaInfo = null;
    
    if (type === 'forward') {
        if (!msg.forward_from_chat || !msg.forward_from_message_id) {
            await sendMessageSafe(bot, ownerId, 
                `❌ لطفاً یک پیام را ${boldText('فوروارد')} کنید \\(نه کپی کنید\\)`, { reply_to_message_id: msg.message_id, parse_mode: 'MarkdownV2' });
            return true;
        }
        content = { 
            type: 'forward',
            from_chat_id: msg.forward_from_chat.id,
            message_id: msg.forward_from_message_id
        };
    } else {
        const text = msg.text || msg.caption || '';
        
        if (msg.photo) {
            mediaInfo = { type: 'photo', file_id: msg.photo[msg.photo.length - 1].file_id };
        } else if (msg.video) {
            mediaInfo = { type: 'video', file_id: msg.video.file_id };
        }

        if (text.length === 0 && !mediaInfo) {
            await sendMessageSafe(bot, ownerId, 
                '❌ پیام شما خالی است\\. لطفاً متن یا عکس/ویدیو بفرستید\\.', { reply_to_message_id: msg.message_id, parse_mode: 'MarkdownV2' });
            return true;
        }
        
        content = { type: 'message', text: text, media: mediaInfo };
    }
    
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    
    await showBroadcastPreview(bot, ownerId, originalPanelMessageId, content, type, target);
    
    return true;
}


export async function handleBroadcastWizardCallback(bot, cbq) {
    const msg = cbq.message;
    const data = cbq.data;
    const ownerId = cbq.from.id;
    const ownerState = await db.getOwnerState(ownerId);
    
    if (data === 'broadcast_wiz_start') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        
        const welcomeText = `📝 *مرحله 1 از 5: نوع ارسال*

[▰▱▱▱▱] 20%

چه نوع پیامی می‌خواهید ارسال کنید؟

🔹 *ساده:* متن \\+ عکس/ویدیو \\(شما تنظیم می‌کنید\\)
🔹 *فوروارد:* ارسال مستقیم یک پیام موجود
🔹 *ساده \\+ پین:* مثل ساده \\+ پین در گروه‌ها`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '📄 ساده', callback_data: 'broadcast_wiz_type_simple' }],
                [{ text: '📤 فوروارد', callback_data: 'broadcast_wiz_type_forward' }],
                [{ text: '📌 ساده + پین', callback_data: 'broadcast_wiz_type_pin' }],
                [{ text: '❌ انصراف', callback_data: 'broadcast_wiz_cancel' }]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, welcomeText, {
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard
        });
        
        await db.setOwnerState(ownerId, BROADCAST_WIZARD_STATES.SELECT_TYPE, {
            message_id: msg.message_id,
            step: 1
        });
    }
    
    if (data.startsWith('broadcast_wiz_type_')) {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        const type = data.replace('broadcast_wiz_type_', '');
        
        const { userCount, groupCount, allCount } = await getBroadcastTargetStats();
        const targetDisplay = (target) => {
            if (target === 'users') return `👤 فقط کاربران \\(${userCount}\\)`;
            if (target === 'groups') return `🏘 فقط گروه‌ها \\(${groupCount}\\)`;
            if (target === 'all') return `🌍 همه \\(${allCount}\\)`;
        };

        const targetText = `👥 *مرحله 2 از 5: انتخاب مخاطبان*

[▰▰▱▱▱] 40%

نوع انتخاب شده: ${inlineCode(type)}

به چه کسانی می‌خواهید پیام برسد؟

📊 *آمار لحظه‌ای:*
\\- 👤 کاربران: ${escapeMarkdownV2(userCount.toString())} نفر
\\- 🏘 گروه‌های فعال: ${escapeMarkdownV2(groupCount.toString())} عدد
\\- 🌍 مجموع: ${escapeMarkdownV2(allCount.toString())} مخاطب`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: targetDisplay('users'), callback_data: `broadcast_wiz_target_users|${type}` }],
                [{ text: targetDisplay('groups'), callback_data: `broadcast_wiz_target_groups|${type}` }],
                [{ text: targetDisplay('all'), callback_data: `broadcast_wiz_target_all|${type}` }],
                [{ text: '◀️ مرحله قبل', callback_data: 'broadcast_wiz_start' }]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, targetText, {
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard
        });
        
        await db.setOwnerState(ownerId, BROADCAST_WIZARD_STATES.SELECT_TARGET, {
            message_id: msg.message_id,
            type: type,
            step: 2
        });
    }
    
    if (data.startsWith('broadcast_wiz_target_') || data.startsWith('broadcast_wiz_content_')) {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        const parts = data.split('|');
        const target = parts[0].replace('broadcast_wiz_target_', '').replace('broadcast_wiz_content_', '');
        const type = parts[1];
        
        let contentInstruction = '';
        if (type === 'forward') {
            contentInstruction = `${boldText('محتوا را فوروارد کنید')}

لطفاً پیام مورد نظر را از جایی ${boldText('فوروارد')} کنید به اینجا\\.

⚠️ فقط یک پیام می‌توانید فوروارد کنید`;
        } else {
            contentInstruction = `${boldText('محتوای پیام را بنویسید')}

✍️ می‌توانید:
\\- متن بنویسید \\(حداکثر 4000 کاراکتر\\)
\\- عکس یا ویدیو اضافه کنید
\\- از Markdown برای قالب‌بندی استفاده کنید

📌 *مثال Markdown:*
${inlineCode('*متن ضخیم*')}
${inlineCode('_متن کج_')}
${inlineCode('`کد`')}`;
        }
        
        const contentText = `✍️ *مرحله 3 از 5: محتوا*

[▰▰▰▱▱] 60%

نوع: ${inlineCode(type)}
مخاطب: ${inlineCode(target)}

${contentInstruction}

زمان باقیمانده: 10 دقیقه`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '❌ لغو و بازگشت', callback_data: 'broadcast_wiz_cancel' }]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, contentText, {
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard
        });
        
        await db.setOwnerState(ownerId, BROADCAST_WIZARD_STATES.ENTER_CONTENT, {
            message_id: msg.message_id,
            type: type,
            target: target,
            step: 3,
            timeout_at: Date.now() + BROADCAST_TIMEOUT_MS
        });
    }
    
    if (data === 'broadcast_wiz_confirm') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        
        const { type, target, recipientCount } = ownerState.data;
        const targetDisplay = target === 'users' ? 'فقط کاربران' : target === 'groups' ? 'فقط گروه‌ها' : 'همه';

        const confirmText = `✅ *مرحله 5 از 5: تایید نهایی*

[▰▰▰▰▱] 80%

*خلاصه ارسال:*
\\- 📝 نوع: ${inlineCode(type)}
\\- 👥 مخاطب: ${escapeMarkdownV2(targetDisplay)}
\\- 📊 تعداد: ${escapeMarkdownV2(recipientCount.toString())} نفر
\\- ⏱ زمان تخمینی: ${escapeMarkdownV2(Math.ceil(recipientCount / 5).toString())} ثانیه

⚠️ *هشدار نهایی:*
این عملیات بلافاصله شروع می‌شود و قابل لغو نیست\\.

آیا مطمئن هستید؟`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ بله، ارسال شود', callback_data: 'broadcast_wiz_execute' }],
                [{ text: '🔄 ویرایش محتوا', callback_data: `broadcast_wiz_content_${target}|${type}` }],
                [{ text: '❌ لغو کامل', callback_data: 'broadcast_wiz_cancel' }]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, confirmText, {
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard
        });
    }
    
    if (data === 'broadcast_wiz_execute') {
        await bot.answerCallbackQuery(cbq.id, { text: '🚀 شروع ارسال...' }).catch(() => {});
        
        const { targetChatIds, content, type, recipientCount } = ownerState.data;
        const total = targetChatIds.length;
        const startTime = Date.now();
        
        await db.setOwnerState(ownerId, BROADCAST_WIZARD_STATES.SENDING, {
            ...ownerState.data,
            start_time: startTime,
            success_count: 0,
            fail_count: 0
        });

        const initialText = `🚀 *در حال ارسال...*

[▱▱▱▱▱] 0%

پردازش شده: 0 / ${escapeMarkdownV2(total.toString())}
✅ موفق: 0
❌ خطا: 0`;

        await editMessageSafe(bot, msg.chat.id, msg.message_id, initialText, {
            parse_mode: 'MarkdownV2'
        });
        
        let successCount = 0;
        let failCount = 0;
        const isPin = type === 'pin';

        try {
            for (let i = 0; i < total; i++) {
                const currentChatId = targetChatIds[i];
                const isGroup = currentChatId < 0;
                
                try {
                    let sentMessage;
                    
                    if (content.type === 'forward') {
                        sentMessage = await bot.forwardMessage(currentChatId, content.from_chat_id, content.message_id);
                    } else {
                        const sendOptions = { parse_mode: 'Markdown' }; 
                        if (content.media?.type === 'photo') {
                            sentMessage = await bot.sendPhoto(currentChatId, content.media.file_id, { caption: content.text, ...sendOptions });
                        } else if (content.media?.type === 'video') {
                            sentMessage = await bot.sendVideo(currentChatId, content.media.file_id, { caption: content.text, ...sendOptions });
                        } else {
                            sentMessage = await sendMessageSafe(bot, currentChatId, content.text, sendOptions);
                        }
                    }
                    successCount++;

                    if (isPin && isGroup && currentChatId !== ownerId) {
                        try {
                            const botMember = await bot.getChatMember(currentChatId, BOT_ID);
                            if (botMember && (botMember.status === 'administrator' || botMember.status === 'creator') && botMember.can_pin_messages) {
                                await bot.pinChatMessage(currentChatId, sentMessage.message_id, { disable_notification: true });
                            }
                        } catch (pinError) {
                            console.warn(`[broadcast:execute] Failed to pin message in chat ${currentChatId}: ${pinError.message}`);
                        }
                    }

                } catch (error) {
                    failCount++;
                    const errorDesc = error.response?.body?.description || '';
                    const errorCode = error.response?.body?.error_code;
                    
                    const isChatLost = errorCode === 403 || 
                                    errorCode === 400 ||
                                    errorDesc.includes('blocked') || 
                                    errorDesc.includes('kicked') ||
                                    errorDesc.includes('deactivated') ||
                                    errorDesc.includes('chat not found') ||
                                    errorDesc.includes('user is deactivated');

                    if (isChatLost) {
                        if (isGroup) {
                            await db.purgeChatData(currentChatId);
                            console.log(`[broadcast:execute] Purged data for lost group chat ${currentChatId}`);
                        } else {
                            await db.deactivateChat(currentChatId);
                            console.log(`[broadcast:execute] Deactivated user chat ${currentChatId}`);
                        }
                    } else {
                        console.warn(`[broadcast:execute] Unhandled error for chat ${currentChatId}: ${errorDesc}`);
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));

                if ((i + 1) % 5 === 0 || (i + 1) === total) {
                    const percent = Math.floor(((i + 1) / total) * 100);
                    const barCount = Math.floor(percent / 20);
                    const bars = '▰'.repeat(barCount) + '▱'.repeat(5 - barCount);
                    
                    const updateText = `🚀 *در حال ارسال...*

[${bars}] ${escapeMarkdownV2(percent.toString())}%

پردازش شده: ${escapeMarkdownV2((i + 1).toString())} / ${escapeMarkdownV2(total.toString())}
✅ موفق: ${escapeMarkdownV2(successCount.toString())}
❌ خطا: ${escapeMarkdownV2(failCount.toString())}

${i + 1 === total ? '🎉 تقریباً تمام شد\\!' : '⏳ لطفاً صبر کنید\\.\\.\\.'}`;
                    
                    await editMessageSafe(bot, msg.chat.id, msg.message_id, updateText, {
                        parse_mode: 'MarkdownV2'
                    }).catch(() => {});
                }
            }
        } catch (loopError) {
             console.error("Critical error in broadcast loop", loopError);
        } finally {
            const finalTime = Date.now();
            const durationSeconds = Math.floor((finalTime - startTime) / 1000);
            
            await db.clearOwnerState(ownerId);
            
            const finalText = `✅ *ارسال تکمیل شد\\!*

[▰▰▰▰▰] 100%

*نتیجه نهایی:*
\\- 📊 کل مخاطبان: ${escapeMarkdownV2(total.toString())}
\\- ✅ ارسال موفق: ${escapeMarkdownV2(successCount.toString())}
\\- ❌ خطا: ${escapeMarkdownV2(failCount.toString())}
\\- 📈 نرخ موفقیت: ${escapeMarkdownV2(total > 0 ? Math.floor((successCount/total)*100).toString() : '0')}%
\\- ⏱ زمان کل: ${escapeMarkdownV2(durationSeconds.toString())} ثانیه

${failCount > 0 ? boldText('⚠️ خطاها:\nکاربران ربات را بلاک کرده‌اند یا از گروه خارج شده‌اند\\.\nاطلاعات آن‌ها از دیتابیس پاک شد\\.') : ''}`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🏠 بازگشت به پنل', callback_data: 'admin_panel' }]
                ]
            };
            
            await editMessageSafe(bot, msg.chat.id, msg.message_id, finalText, {
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
            });
        }
    }
    
    if (data === 'broadcast_wiz_cancel') {
        await bot.answerCallbackQuery(cbq.id, { text: '❌ عملیات لغو شد' }).catch(() => {});
        await db.clearOwnerState(ownerId);
        await editMessageSafe(bot, msg.chat.id, msg.message_id, 
            boldText('❌ عملیات پخش همگانی لغو شد\\.'), 
            { parse_mode: 'MarkdownV2' });
    }

    return true;
}


