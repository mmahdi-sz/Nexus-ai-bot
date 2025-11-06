import * as db from '../database.js';
import { editMessageSafe, escapeMarkdownV2, boldText, inlineCode } from '../utils/textFormatter.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

const textManagementKeyboard = {
    inline_keyboard: [
        [{ text: '📝 متن‌های دستورات', callback_data: 'text_menu_commands' }],
        [{ text: '🔔 متن‌های اعلان‌ها', callback_data: 'text_menu_notifications' }],
        [{ text: '❌ متن‌های خطا', callback_data: 'text_menu_errors' }],
        [{ text: '🔑 متن‌های API', callback_data: 'text_menu_api' }],
        [{ text: '📚 متن‌های آموزشی', callback_data: 'tutorial_menu_main' }],
        [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]
    ]
};

const textCategoryKeyboards = {
    'text_menu_commands': {
        title: '📝 متن‌های دستورات',
        prefix: 'command_',
        back: 'text_menu_main',
        inline_keyboard: [
            [{ text: '/new (شروع چت جدید)', callback_data: 'text_edit_command_new' }],
            [{ text: '/forget (پاک کردن حافظه)', callback_data: 'text_edit_command_forget' }],
            [{ text: '/status (وضعیت حامی/عادی)', callback_data: 'text_edit_command_status_no_premium' }],
            [{ text: '/enable (موفقیت)', callback_data: 'text_edit_enable_success' }],
            [{ text: '/enable (از قبل فعال)', callback_data: 'text_edit_enable_already_active' }],
            [{ text: '/enable (نیاز به ادمین)', callback_data: 'text_edit_enable_admin_required' }],
            [{ text: '/enable (فقط گروه)', callback_data: 'text_edit_enable_private_only' }],
            [{ text: '/help (ادمین)', callback_data: 'text_edit_help_admin' }],
            [{ text: '/help (کاربر)', callback_data: 'text_edit_help_user' }],
        ]
    },
    'text_menu_notifications': {
        title: '🔔 متن‌های اعلان‌ها',
        prefix: 'bot_added_',
        back: 'text_menu_main',
        inline_keyboard: [
            [{ text: 'استارت اولیه', callback_data: 'text_edit_start_message' }],
            [{ text: 'خوش‌آمدگویی گروه', callback_data: 'text_edit_group_welcome' }],
            [{ text: 'اضافه شدن (فعال)', callback_data: 'text_edit_bot_added_welcome_enabled' }],
            [{ text: 'اضافه شدن (جدید)', callback_data: 'text_edit_bot_added_welcome_new' }],
            [{ text: '⏱️ Cooldown چت', callback_data: 'text_edit_chat_cooldown' }],
            [{ text: '⏱️ Cooldown راهنما', callback_data: 'text_edit_api_guide_cooldown' }],
        ]
    },
    'text_menu_errors': {
        title: '❌ متن‌های خطا',
        prefix: 'error_',
        back: 'text_menu_main',
        inline_keyboard: [
            [{ text: '❌ خطای عمومی', callback_data: 'text_edit_error_general' }],
            [{ text: '❌ خطای شبکه', callback_data: 'text_edit_error_network' }],
            [{ text: '❌ خطای پردازش (Thinking)', callback_data: 'text_edit_error_thinking' }],
            [{ text: '❌ خطای بازنشانی وضعیت', callback_data: 'text_edit_error_state_reset' }],
            [{ text: '❌ خطای Callback', callback_data: 'text_edit_error_callback' }],
        ]
    },
    'text_menu_api': {
        title: '🔑 متن‌های API',
        prefix: 'apikey_',
        back: 'text_menu_main',
        inline_keyboard: [
            [{ text: 'انتظار کلید', callback_data: 'text_edit_apikey_awaiting' }],
            [{ text: 'در حال بررسی', callback_data: 'text_edit_apikey_checking' }],
            [{ text: 'کلید تکراری', callback_data: 'text_edit_apikey_duplicate' }],
            [{ text: 'کلید نامعتبر', callback_data: 'text_edit_apikey_invalid' }],
            [{ text: 'موفقیت اهدای کلید', callback_data: 'text_edit_apikey_success' }],
            [{ text: 'کاراکتر نامعتبر', callback_data: 'text_edit_apikey_invalid_chars' }],
            [{ text: 'هشدار گروه', callback_data: 'text_edit_apikey_group_warning' }],
            [{ text: 'لغو عملیات', callback_data: 'text_edit_apikey_cancel' }],
            [{ text: 'فقط متن بفرست', callback_data: 'text_edit_apikey_text_only' }],
        ]
    }
};

const tutorialMenuKeyboard = {
    inline_keyboard: [
        [{ text: '⏱️ پیام‌های محدودیت', callback_data: 'tutorial_edit_limits' }],
        [{ text: '🎓 تغییر متن و مدیا راهنمای API', callback_data: 'tutorial_api_menu' }],
        [{ text: '↩️ بازگشت', callback_data: 'text_menu_main' }]
    ]
};

const limitMessagesKeyboard = {
    inline_keyboard: [
        [{ text: '☀️ محدودیت روزانه', callback_data: 'text_edit_limit_message_day' }],
        [{ text: '📅 محدودیت هفتگی', callback_data: 'text_edit_limit_message_week' }],
        [{ text: '🗓️ محدودیت ماهانه', callback_data: 'text_edit_limit_message_month' }],
        [{ text: '💥 پیام خطای Overload', callback_data: 'text_edit_overload_error_message' }],
        [{ text: '🔗 متن دکمه راهنمای محدودیت', callback_data: 'text_edit_limit_button_text' }],
        [{ text: '↩️ بازگشت', callback_data: 'tutorial_menu_main' }]
    ]
};

const apiTutorialMenuKeyboard = {
    inline_keyboard: [
        [{ text: '📤 آپلود مدیاهای جدید', callback_data: 'tutorial_api_upload' }],
        [{ text: '✏️ ویرایش متن راهنما', callback_data: 'tutorial_api_edit_text' }],
        [{ text: '↩️ بازگشت', callback_data: 'tutorial_menu_main' }]
    ]
};


export async function handleTextManagement(bot, msg, data) {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    if (data === 'text_menu_main') {
        return editMessageSafe(bot, chatId, messageId, '**مدیریت متن‌های بات**\n\nکدام دسته از متن‌ها را می‌خواهید ویرایش کنید؟', {
            reply_markup: textManagementKeyboard,
            parse_mode: 'Markdown'
        });
    }

    if (textCategoryKeyboards[data]) {
        const menu = textCategoryKeyboards[data];
        const keyboardWithBack = { inline_keyboard: [...menu.inline_keyboard, [{ text: '↩️ بازگشت', callback_data: menu.back }]] };
        return editMessageSafe(bot, chatId, messageId, `**${menu.title}**\n\nمتن مورد نظر برای ویرایش را انتخاب کنید:`, {
            reply_markup: keyboardWithBack,
            parse_mode: 'Markdown'
        });
    }

    if (data === 'tutorial_menu_main') {
        return editMessageSafe(bot, chatId, messageId, '**مدیریت متن‌های آموزشی**\n\nاین بخش شامل متن‌های محدودیت و راهنمای API است.', {
            reply_markup: tutorialMenuKeyboard,
            parse_mode: 'Markdown'
        });
    }
    
    if (data === 'tutorial_edit_limits') {
        return editMessageSafe(bot, chatId, messageId, '⏱️ **مدیریت پیام‌های محدودیت و خطا**\n\nلطفا پیامی را که می‌خواهید ویرایش کنید، انتخاب کنید.', {
            reply_markup: limitMessagesKeyboard,
            parse_mode: 'Markdown'
        });
    }

    if (data === 'tutorial_api_menu') {
        return editMessageSafe(bot, chatId, messageId, '🎓 **مدیریت راهنمای API**', {
            reply_markup: apiTutorialMenuKeyboard,
            parse_mode: 'Markdown'
        });
    }

    if (data.startsWith('text_edit_') || data.startsWith('tutorial_edit_')) {
        const key = data.replace('text_edit_', '').replace('tutorial_edit_', '');
        
        let description = '';
        let backKey = 'text_menu_main';
        
        if (key === 'start_message') { description = 'پیام /start در چت خصوصی'; backKey = 'text_menu_notifications'; }
        else if (key === 'group_welcome') { description = 'پیام خوش‌آمدگویی گروه'; backKey = 'text_menu_notifications'; }
        else if (key.startsWith('limit_message_')) { description = `پیام محدودیت ${key.split('_').pop()}`; backKey = 'tutorial_edit_limits'; }
        else if (key === 'overload_error_message') { description = 'پیام خطای ترافیک بالا'; backKey = 'tutorial_edit_limits'; }
        else if (key.startsWith('enable_')) { description = `/enable - ${key.split('_').pop()}`; backKey = 'text_menu_commands'; }
        else if (key.startsWith('bot_added_')) { description = `خوش‌آمدگویی اضافه شدن به گروه - ${key.split('_').pop()}`; backKey = 'text_menu_notifications'; }
        else if (key.startsWith('help_')) { description = `راهنمای ${key.split('_').pop()}`; backKey = 'text_menu_commands'; }
        else if (key.startsWith('apikey_')) { description = `پیام API - ${key.split('_').pop()}`; backKey = 'text_menu_api'; }
        else if (key.startsWith('error_')) { description = `خطای سیستم - ${key.split('_').pop()}`; backKey = 'text_menu_errors'; }
        else if (key.startsWith('command_')) { description = `دستور ${key.split('_').pop()}`; backKey = 'text_menu_commands'; }
        else if (key === 'limit_button_text') { description = 'متن دکمه راهنمای محدودیت (پشتیبانی از Markdown)'; backKey = 'tutorial_edit_limits'; }

        const currentText = await db.getText(key, 'متن پیش‌فرض یافت نشد.');
        
        await db.setOwnerState(BOT_OWNER_ID, `editing_tutorial_text_${key}`, { 
            message_id: messageId, 
            key: key, 
            return_callback: backKey 
        });
        
        const extraNote = key.startsWith('limit_message_') ? escapeMarkdownV2('\n\n*نکته: متن محدودیت \\(امروز: X\\/Y\\) به صورت خودکار به انتهای پیام شما اضافه می‌شود\\.*') : '';
        if (key === 'limit_button_text') {
             extraNote += escapeMarkdownV2('\n\n*نکته: این متن باید با Markdown قالب‌بندی شود\\.*');
        }

        const editKeyboard = {
            inline_keyboard: [
                [{ text: '❌ لغو ویرایش', callback_data: `cancel_state_return_${backKey}` }],
                [{ text: '↩️ بازگشت', callback_data: backKey }]
            ]
        };

        const editText = escapeMarkdownV2(`**ویرایش: ${description}**\n\n*کلید دیتابیس:* ${inlineCode(key)}\n\n*متن فعلی:*\n`) + codeBlock(currentText) + escapeMarkdownV2('\n\nلطفاً متن جدید را ارسال کنید\\.') + extraNote;

        return editMessageSafe(bot, chatId, messageId,
            editText,
            { reply_markup: editKeyboard, parse_mode: 'MarkdownV2' }
        );
    }
    
    if (data === 'tutorial_api_upload') {
        await db.setOwnerState(BOT_OWNER_ID, 'tutorial_api_awaiting_media', { message_id: messageId, media: [] });
        const text = escapeMarkdownV2('📤 **آپلود مدیا برای راهنمای API**\n\n' +
            'لطفا عکس‌ها، ویدیوها یا فایل‌های خود را یکی‌یکی ارسال کنید\\.\n\n' +
            'پس از ارسال تمام فایل‌ها، روی دکمه "اتمام آپلود" کلیک کنید\\.\n\n' +
            '*توجه: تمام مدیاهای قبلی حذف خواهند شد\\.*');
        return editMessageSafe(bot, chatId, messageId,
            text,
            {
                inline_keyboard: [
                    [{ text: '✅ اتمام آپلود', callback_data: 'tutorial_api_finish_upload' }],
                    [{ text: '❌ لغو', callback_data: 'cancel_state_return_tutorial_api_menu' }]
                ],
                parse_mode: 'MarkdownV2'
            }
        );
    }
    if (data === 'tutorial_api_finish_upload') {
        const ownerState = await db.getOwnerState(BOT_OWNER_ID);
        const mediaData = ownerState.data.media || [];

        await db.setOwnerState(BOT_OWNER_ID, 'tutorial_api_awaiting_text', { message_id: messageId, media: mediaData });
        
        const mediaCount = mediaData.length;
        const mediaText = mediaCount > 0 ? escapeMarkdownV2(`\\(${mediaCount} فایل مدیا آپلود شده است\\)`) : '';

        const text = escapeMarkdownV2(`✏️ **مرحله نهایی: ویرایش متن راهنما** ${mediaText}\n\n` +
            'لطفا متن اصلی راهنما را ارسال کنید\\.\n\n' +
            'در صورت تمایل می‌توانید در خط آخر، متن و لینک دکمه را به شکل زیر اضافه کنید \\(اختیاری\\):\n' +
            inlineCode('دکمه: متن روی دکمه | https://your\\.link\\.com') + '\n\n' +
            'مثال:\\n' +
            inlineCode('دکمه: دریافت کلید از سایت | https://google\\.com'));

        return editMessageSafe(bot, chatId, messageId,
            text,
            { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_tutorial_api_menu' }]], parse_mode: 'MarkdownV2' }
        );
    }
    if (data === 'tutorial_api_edit_text') {
        await db.setOwnerState(BOT_OWNER_ID, 'tutorial_api_awaiting_text', { message_id: messageId, media: [] });
        const currentText = await db.getTutorialTextForApi();
        const textToShow = currentText ? escapeMarkdownV2('*متن فعلی:*\n') + codeBlock(currentText.tutorial_text) : escapeMarkdownV2('*هنوز متنی تنظیم نشده است\\.*');
        
        const text = escapeMarkdownV2(`✏️ **ویرایش متن راهنمای API**\n\n`) + textToShow + escapeMarkdownV2('\n\nلطفا متن جدید را ارسال کنید\\.\n\n' +
            'در صورت تمایل می‌توانید در خط آخر، متن و لینک دکمه را به شکل زیر اضافه کنید:\n' +
            inlineCode('دکمه: متن روی دکمه | https://your\\.link\\.com'));

        return editMessageSafe(bot, chatId, messageId,
            text,
            { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_tutorial_api_menu' }]], parse_mode: 'MarkdownV2' }
        );
    }

    return false;
}