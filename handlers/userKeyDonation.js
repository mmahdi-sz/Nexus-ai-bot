
import * as db from '../database.js';
import * as keyPoolManager from '../keyPoolManager.js';
import * as security from '../security.js';
import { validateApiKey } from '../admin/adminHandlers.js'; 
import { sendMessageSafe, editMessageSafe, escapeMarkdownV2, boldText, codeBlock, inlineCode } from '../utils/textFormatter.js';

const DONATION_STATES = {
    INITIAL: 'initial',
    GUIDE_SHOWN: 'guide_shown',
    KEY_AWAITING: 'key_awaiting',
    VALIDATING: 'validating',
    SUCCESS: 'success',
    CANCELLED: 'cancelled'
};

export async function startKeyDonationWizard(bot, msg) {
    const userId = msg.from.id;
    
    const welcomeMessage = `🎁 ${boldText('ویزارد اهدای کلید API')}

✨ با اهدای کلید، به حامی ویژه تبدیل می‌شوید\\!

${boldText('مزایای حامی:')}
\\- 🔓 استفاده نامحدود از ربات
\\- ⚡️ اولویت در پردازش
\\- 🏆 نشان حامی در پروفایل

${boldText('مراحل:')}
1\\. 📚 مرحله 1: راهنمای دریافت کلید
2\\. 🔑 مرحله 2: ارسال کلید
3\\. ✅ مرحله 3: تایید نهایی

آیا آماده شروع هستید؟`;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '▶️ شروع کنیم!', callback_data: 'donate_start' },
                { text: '❌ انصراف', callback_data: 'donate_cancel' }
            ]
        ]
    };
    
    await db.clearUserState(userId);

    await sendMessageSafe(bot, msg.chat.id, welcomeMessage, { 
        reply_markup: keyboard,
        parse_mode: 'MarkdownV2' 
    });
    
    await db.setUserState(userId, DONATION_STATES.INITIAL, {
        started_at: Date.now()
    });
}

export async function handleDonationCallback(bot, cbq) {
    const userId = cbq.from.id;
    const data = cbq.data;
    const msg = cbq.message;
    
    if (data === 'donate_start') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        
        const guideMessage = `📚 ${boldText('مرحله 1 از 3: دریافت کلید API')}

[▰▰▱▱▱] 40%

${boldText('چطور کلید API بگیریم؟')}

1\\. به سایت زیر بروید:
   🔗 https://aistudio\\.google\\.com/apikey

2\\. روی "Create API Key" کلیک کنید

3\\. کلید ایجاد شده را کپی کنید
   ⚠️ ${boldText('مهم:')} کلید شبیه این است:
   ${inlineCode('AIzaSyD..._abcd1234')} \\(39 کاراکتر\\)

4\\. برگردید اینجا و کلید را ارسال کنید

💡 ${boldText('نکته امنیتی:')}
این کلید فقط برای Gemini AI است و هزینه ندارد\\.
ما آن را رمزنگاری کرده ذخیره می‌کنیم\\.

آماده ارسال کلید هستید؟`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ آماده‌ام، کلید می‌فرستم', callback_data: 'donate_ready_to_send' }
                ],
                [
                    { text: '🔄 دوباره راهنما', callback_data: 'donate_start' },
                    { text: '❌ انصراف', callback_data: 'donate_cancel' }
                ]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, guideMessage, {
            reply_markup: keyboard,
            parse_mode: 'MarkdownV2'
        });
        
        await db.setUserState(userId, DONATION_STATES.GUIDE_SHOWN, {
            current_step: 1
        });
    }
    
    if (data === 'donate_ready_to_send') {
        await bot.answerCallbackQuery(cbq.id).catch(() => {});
        
        const awaitingMessage = `🔑 ${boldText('مرحله 2 از 3: ارسال کلید')}

[▰▰▰▰▱] 80%

الان کلید API خودتون رو برام بفرستید\\.

📋 ${boldText('فرمت صحیح:')}
${inlineCode('AIzaSyD..._abcd1234')}

⚠️ ${boldText('نکات مهم:')}
\\- فقط کلید را بفرستید \\(بدون متن اضافه\\)
\\- کلید باید با ${inlineCode('AIza')} شروع شود
\\- طول معمول: 39 کاراکتر

⏱ ${boldText('زمان باقیمانده:')} 5 دقیقه

آماده دریافت کلید شما هستم\\.\\.\\.`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '❌ انصراف', callback_data: 'donate_cancel' }]
            ]
        };
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id, awaitingMessage, {
            reply_markup: keyboard,
            parse_mode: 'MarkdownV2'
        });
        
        await db.setUserState(userId, DONATION_STATES.KEY_AWAITING, {
            current_step: 2,
            timeout_at: Date.now() + (5 * 60 * 1000), 
            guide_message_id: msg.message_id
        });
    }
    
    if (data === 'donate_cancel') {
        await bot.answerCallbackQuery(cbq.id, { text: '❌ عملیات لغو شد' }).catch(() => {});
        
        await editMessageSafe(bot, msg.chat.id, msg.message_id,
            `${boldText('❌ عملیات لغو شد')}\n\nهر وقت خواستید می‌تونید دوباره با ${inlineCode('/donate')} شروع کنید\\.`, 
            {
                parse_mode: 'MarkdownV2'
            }
        ).catch(() => {});
        
        await db.clearUserState(userId);
    }
}

export async function handleUserKeyDonation(bot, msg) {
    const userId = msg.from.id;
    const text = msg.text;
    const userState = await db.getUserState(userId);
    
    if (!userState || userState.state !== DONATION_STATES.KEY_AWAITING) {
        return false;
    }
    
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});

    if (!userState.data?.timeout_at) {
        await db.clearUserState(userId);
        await sendMessageSafe(bot, msg.chat.id, `${boldText('❌ خطا در سیستم')}\n\nلطفاً با ${inlineCode('/donate')} دوباره شروع کنید\\.`, { parse_mode: 'MarkdownV2' });
        return true;
    }

    if (Date.now() > userState.data.timeout_at) {
        await db.clearUserState(userId);
        await sendMessageSafe(bot, msg.chat.id, `${boldText('⏱ زمان شما تمام شد')}\n\nلطفاً دوباره با ${inlineCode('/donate')} شروع کنید\\.`, { parse_mode: 'MarkdownV2' });
        return true;
    }

    if (text === '/cancel' || text === '❌ انصراف') {
        await db.clearUserState(userId);
        await sendMessageSafe(bot, msg.chat.id, `${boldText('❌ عملیات لغو شد')}\n\nلطفاً دوباره با ${inlineCode('/donate')} شروع کنید\\.`, { parse_mode: 'MarkdownV2' });
        return true;
    }
    
    const newApiKey = text.trim();

    const validationSteps = [
        { check: text && typeof text === 'string', error: '❌ لطفاً فقط متن کلید را بفرستید' },
        { check: !newApiKey.startsWith('/'), error: '❌ دستور وارد نکنید، فقط کلید API' },
        { check: /^[\x00-\x7F]*$/.test(newApiKey), error: '❌ کلید نباید شامل حروف فارسی باشد' },
        { check: newApiKey.startsWith('AIza'), error: '❌ کلید باید با AIza شروع شود' },
        { check: newApiKey.length >= 35 && newApiKey.length <= 45, error: '❌ طول کلید معمولاً 39 کاراکتر است' }
    ];
    
    for (const step of validationSteps) {
        if (!step.check) {
            await sendMessageSafe(bot, msg.chat.id, escapeMarkdownV2(step.error), { parse_mode: 'MarkdownV2' });
            return true;
        }
    }
    
    const validatingMsgText = `🔍 ${boldText('مرحله 3 از 3: اعتبارسنجی')}

[▰▰▰▰▰] 100%

${boldText('در حال بررسی کلید شما...')}

\\- [⏳] اتصال به Google AI\\.\\.\\.
\\- [⏳] بررسی اعتبار\\.\\.\\.
\\- [⏳] رمزنگاری و ذخیره\\.\\.\\.

لطفاً صبر کنید\\.\\.\\.`;

    const placeholder = await sendMessageSafe(bot, msg.chat.id, validatingMsgText, { parse_mode: 'MarkdownV2' });
    
    await db.setUserState(userId, DONATION_STATES.VALIDATING, {
        current_step: 3,
        validating_message_id: placeholder.message_id
    });
    
    const existingKey = await db.getApiKeyByHash(security.hash(newApiKey));
    if (existingKey) {
        await db.clearUserState(userId);
        const duplicateText = `${boldText('❌ کلید تکراری است')}\n\nاین کلید قبلاً توسط کاربر \\(ID: ${escapeMarkdownV2(existingKey.donated_by_user_id?.toString() || 'ادمین')}\\) اهدا شده است\\. برای شروع مجدد ${inlineCode('/donate')} را بزنید`;
        await bot.editMessageText(duplicateText, {
            chat_id: msg.chat.id,
            message_id: placeholder.message_id,
            parse_mode: 'MarkdownV2'
        });
        return true;
    }

    const validationResult = await validateApiKey(newApiKey);
    
    if (!validationResult.isValid) {
        await db.clearUserState(userId);
        let errorText;

        if (validationResult.reason === 'rate_limited') {
            errorText = await db.getText('apikey_rate_limited', 'هی رفیق، انگار این کلید خسته شده. به نظر می‌رسه به سقف مصرفش رسیده. برو یه کلید کاملاً جدید با یه حساب گوگل دیگه بساز و اونو برام بفرست. منتظرتم.');
        } else {
            errorText = await db.getText('apikey_invalid', '⚠️ این کلید معتبر نیست رفیق. مطمئن شو درست کپیش کردی.');
        }

        await bot.editMessageText(errorText, {
            chat_id: msg.chat.id,
            message_id: placeholder.message_id,
            parse_mode: 'Markdown'
        });
        return true;
    }
    
    const encryptedKey = security.encrypt(newApiKey);
    const displayName = security.createDisplayName(newApiKey);
    
    const result = await db.addApiKey(encryptedKey, security.hash(newApiKey), displayName, userId);
    keyPoolManager.addApiKeyToPool(newApiKey, result.lastID);
    
    await db.clearUserState(userId);
    
    const successText = `✅ ${boldText('تبریک\\! حامی شدید')}

[▰▰▰▰▰] 100%

${boldText('مراحل تکمیل شده:')}
\\- [✅] اعتبارسنجی کلید
\\- [✅] رمزنگاری امن
\\- [✅] افزودن به استخر عمومی

🎉 ${boldText('مزایای فعال شده:')}
\\- 🔓 استفاده نامحدود از ربات
\\- ⚡️ سرعت پاسخگویی بالاتر
\\- 🏆 نشان "حامی" در پروفایل
\\- ❤️ حمایت از توسعه ربات

شناسه کلید شما: ${inlineCode(displayName)}

${inlineCode('/status')} ← مشاهده وضعیت حامی
${inlineCode('/help')} ← راهنمای استفاده`;
    
    await bot.editMessageText(successText, {
        chat_id: msg.chat.id,
        message_id: placeholder.message_id,
        parse_mode: 'MarkdownV2'
    });
    
    return true;
}


