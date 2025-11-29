
import * as db from '../database.js';
import { editMessageSafe, escapeMarkdownV2, inlineCode, boldText, codeBlock } from '../utils/textFormatter.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

export const specialUsersMainMenuKeyboard = {
    inline_keyboard: [
        [{ text: '➕ افزودن فرد خاص', callback_data: 'user_add_start' }],
        [{ text: '✏️ ویرایش فرد خاص', callback_data: 'user_edit_list' }],
        [{ text: '➖ حذف فرد خاص', callback_data: 'user_delete_list' }],
        [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]
    ]
};

export async function handleUserManagementCallback(bot, cbq, msg, data) {
    if (data === 'user_menu_main') return editMessageSafe(bot, msg.chat.id, msg.message_id, '**مدیریت افراد خاص**\n\nرفتار آرتور را نسبت به افراد خاص شخصی‌سازی کنید.', { reply_markup: specialUsersMainMenuKeyboard, parse_mode: 'Markdown' });
    
    if (data === 'user_add_start') {
        await db.setOwnerState(BOT_OWNER_ID, 'user_add_awaiting_forward', { message_id: msg.message_id });
        return editMessageSafe(bot, msg.chat.id, msg.message_id, escapeMarkdownV2('**مرحله ۱: شناسایی کاربر**\n\nیک پیام از کاربر مورد نظر را فوروارد کنید\\.'), { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]], parse_mode: 'MarkdownV2' });
    }
    
    if (data === 'user_edit_list' || data === 'user_delete_list') {
        const users = await db.getAllSpecialUsers();
        const action = data === 'user_edit_list' ? 'ویرایش' : 'حذف';
        
        if (users.length === 0) {
            bot.answerCallbackQuery(cbq.id, { text: `هیچ فرد خاصی برای ${action} ثبت نشده است.`, show_alert: false }).catch(() => { });
            return editMessageSafe(bot, msg.chat.id, msg.message_id, 
                escapeMarkdownV2(`❌ هیچ فرد خاصی برای **${action}** ثبت نشده است\\.\n\nبرای افزودن یک فرد جدید، روی دکمه زیر کلیک کنید:`), 
                { inline_keyboard: [
                    [{ text: '➕ افزودن فرد خاص', callback_data: 'user_add_start' }],
                    [{ text: '↩️ بازگشت', callback_data: 'user_menu_main' }]
                ],
                parse_mode: 'MarkdownV2'
            });
        }
        
        const icon = action === 'ویرایش' ? '✏️' : '🗑️';
        const callbackAction = data === 'user_edit_list' ? 'edit' : 'delete';
        
        const keyboard = users.map(u => ([{ text: `${icon} ${u.display_name} (ID: ${u.user_id})`, callback_data: `user_${callbackAction}_select_${u.user_id}` }]));
        
        if (action === 'ویرایش') {
            keyboard.push([{ text: '🧪 تست پرامپت', callback_data: `user_test_prompt_list` }]);
        }

        keyboard.push([{ text: '↩️ بازگشت', callback_data: 'user_menu_main' }]);
        
        return editMessageSafe(bot, msg.chat.id, msg.message_id, `کدام فرد را برای **${action}** انتخاب می‌کنید؟`, { inline_keyboard: keyboard, parse_mode: 'Markdown' });
    }
    
    if (data.startsWith('user_edit_select_')) {
        const userId = parseInt(data.split('_').pop(), 10);
        const user = await db.getSpecialUser(userId);
        if (!user) return editMessageSafe(bot, msg.chat.id, msg.message_id, 'کاربر یافت نشد!', { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'user_edit_list' }]] });
        const keyboard = [
            [{ text: '🔢 ویرایش ID عددی', callback_data: `user_edit_field_id_${userId}` }],
            [{ text: '🏷️ ویرایش نام نمایشی', callback_data: `user_edit_field_name_${userId}` }],
            [{ text: '📜 ویرایش پرامپت', callback_data: `user_edit_field_prompt_${userId}` }],
            [{ text: '🧪 تست پرامپت', callback_data: `user_test_prompt_${userId}` }],
            [{ text: '↩️ بازگشت', callback_data: 'user_edit_list' }]
        ];
        return editMessageSafe(bot, msg.chat.id, msg.message_id, escapeMarkdownV2(`ویرایش اطلاعات **${user.display_name} (ID: ${user.user_id})**`), { inline_keyboard: keyboard, parse_mode: 'MarkdownV2' });
    }
    
    if (data.startsWith('user_test_prompt_')) {
        const action = data.startsWith('user_test_prompt_execute') ? 'execute' : 'select';
        if (action === 'select') {
            // Handles "user_test_prompt_123" or list
            if (data === 'user_test_prompt_list') {
                 // Show list logic if needed, but currently it goes to select user first
                 return handleUserManagementCallback(bot, cbq, msg, 'user_edit_list');
            }
            return handleUserTestPrompt(bot, cbq);
        }
        // Execute logic handled inside handleUserTestPrompt if needed, or we delegate back
        return handleUserTestPrompt(bot, cbq);
    }
    
    if (data.startsWith('user_edit_field_')) {
        const [, , field, userId] = data.split('_');
        await db.setOwnerState(BOT_OWNER_ID, `user_edit_awaiting_${field}`, { message_id: msg.message_id, user_id: userId });
        let instruction = '';
        const backCallback = `user_edit_select_${userId}`;

        if (field === 'id') instruction = escapeMarkdownV2(`یک پیام از کاربر جدید فوروارد کنید (با ID جدید)\\.\n\n*ID فعلی:* ${inlineCode(userId)}`);
        if (field === 'name') instruction = escapeMarkdownV2('نام نمایشی جدید را ارسال کنید\\.');
        if (field === 'prompt') {
            const user = await db.getSpecialUser(userId);
            instruction = escapeMarkdownV2(`پرامپت رفتار جدید را ارسال کنید\\.\n\n*پرامپت فعلی:*\n`) + (user?.prompt ? `\`\`\`\n${user.prompt}\n\`\`\`` : escapeMarkdownV2('\\- یافت نشد\\-'));
        }
        const editKeyboard = {
            inline_keyboard: [
                [{ text: '❌ لغو ویرایش', callback_data: `cancel_state_return_${backCallback}` }],
                [{ text: '↩️ بازگشت', callback_data: backCallback }]
            ]
        };
        return editMessageSafe(bot, msg.chat.id, msg.message_id, escapeMarkdownV2(`**ویرایش ${field} (برای ID: ${userId})**\n\n`) + instruction, { reply_markup: editKeyboard, parse_mode: 'MarkdownV2' });
    }
    
    if (data.startsWith('user_delete_select_')) {
        const userId = parseInt(data.split('_').pop(), 10);
        await db.deleteSpecialUser(userId);
        bot.answerCallbackQuery(cbq.id, { text: `فرد خاص (ID: ${userId}) با موفقیت حذف شد.`, show_alert: true }).catch(() => { });
        return handleUserManagementCallback(bot, cbq, msg, 'user_delete_list');
    }

    return false;
}

export async function handleUserManagementInput(bot, msg, ownerState, originalPanelMessageId, goBackTo) {
    const text = msg.text;
    const { state, data } = ownerState;

    if (state === 'user_add_awaiting_forward') {
        if (!msg.forward_from) {
            await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('❌ این یک پیام فوروارد شده نیست\\. لطفاً یک پیام را فوروارد کنید\\.'), { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]], parse_mode: 'MarkdownV2' });
            return true;
        }
        const userId = msg.forward_from.id;
        const existingUser = await db.getSpecialUser(userId);
        if (existingUser) {
            await db.clearOwnerState(BOT_OWNER_ID);
            await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('❌ این کاربر قبلاً به لیست اضافه شده است\\.'), { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'user_menu_main' }]], parse_mode: 'MarkdownV2' });
            goBackTo('user_menu_main').catch(() => {});
            return true;
        }
        await db.setOwnerState(BOT_OWNER_ID, 'user_add_awaiting_name', { ...data, user_id: userId });
        editMessageSafe(bot, msg.chat.id, originalPanelMessageId, '**مرحله ۲: نام نمایشی**\n\nنامی برای این فرد وارد کنید (مثلاً: دنیل).', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]] }, parse_mode: 'Markdown' }).catch(() => {});
        return true;
    }
    
    if (state === 'user_add_awaiting_name') {
        const displayName = text.trim();
        
        if (displayName.length < 2 || displayName.length > 50) {
            await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('⚠️ نام باید بین 2 تا 50 کاراکتر باشد.'), { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]] }, parse_mode: 'MarkdownV2' }).catch(() => {});
            return true;
        }

        await db.setOwnerState(BOT_OWNER_ID, 'user_add_awaiting_prompt', { ...data, display_name: displayName });
        editMessageSafe(bot, msg.chat.id, originalPanelMessageId, '**مرحله ۳: پرامپت رفتار**\n\nدستورالعمل رفتار آرتور با این فرد را بنویسید.', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]] }, parse_mode: 'Markdown' }).catch(() => {});
        return true;
    }
    
    if (state === 'user_add_awaiting_prompt') {
        const prompt = text.trim();
        const MAX_PROMPT_LENGTH = 2000;
        const MIN_PROMPT_LENGTH = 20;

        if (prompt.length < MIN_PROMPT_LENGTH || prompt.length > MAX_PROMPT_LENGTH) {
             editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2(`❌ پرامپت رفتار باید بین ${MIN_PROMPT_LENGTH} تا ${MAX_PROMPT_LENGTH} کاراکتر باشد\\.`), { 
                reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_state_return_user_menu_main' }]] },
                parse_mode: 'MarkdownV2'
            }).catch(() => {});
            return true;
        }

        await db.addSpecialUser(data.user_id, data.display_name, prompt);
        await db.clearOwnerState(BOT_OWNER_ID);
        
        await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, '✅ فرد جدید با موفقیت اضافه شد\\.', { reply_markup: { inline_keyboard: [[{ text: '↩️ بازگشت به لیست', callback_data: 'user_edit_list' }]] }, parse_mode: 'MarkdownV2' }).catch(() => {});
        
        setTimeout(() => {
             goBackTo('user_edit_list').catch(() => {}); 
        }, 1500); 

        return true;
    }
    
    if (state.startsWith('user_edit_awaiting_')) {
        const field = state.replace('user_edit_awaiting_', '');
        const originalUserId = parseInt(data.user_id, 10);
        let updates = {};
        let finalUserId = originalUserId;
        const backCallback = `user_edit_select_${originalUserId}`;

        if (field === 'id') {
            if (!msg.forward_from) {
                await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('❌ لطفاً یک پیام فوروارد شده ارسال کنید\\.'), { inline_keyboard: [[{ text: '❌ لغو', callback_data: `cancel_state_return_${backCallback}` }]] , parse_mode: 'MarkdownV2'}).catch(() => {});
                return true;
            }
            updates.newUserId = msg.forward_from.id;
            finalUserId = updates.newUserId;
            const existingUserWithNewId = await db.getSpecialUser(updates.newUserId);
            if (existingUserWithNewId && existingUserWithNewId.user_id !== originalUserId) {
                await db.clearOwnerState(BOT_OWNER_ID);
                await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('❌ ID جدید قبلاً برای کاربر دیگری ثبت شده است\\.'), { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: backCallback }]], parse_mode: 'MarkdownV2'}).catch(() => {});
                goBackTo(`user_edit_select_${originalUserId}`).catch(() => {});
                return true;
            }
        }
        if (field === 'name') {
            const displayName = text.trim();
            if (displayName.length < 2 || displayName.length > 50) {
                await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2('⚠️ نام باید بین 2 تا 50 کاراکتر باشد.'), { inline_keyboard: [[{ text: '❌ لغو', callback_data: `cancel_state_return_${backCallback}` }]], parse_mode: 'MarkdownV2' }).catch(() => {});
                return true;
            }
            updates.newDisplayName = displayName;
        }
        if (field === 'prompt') {
            const prompt = text.trim();
            const MAX_PROMPT_LENGTH = 2000;
            const MIN_PROMPT_LENGTH = 20;

            if (prompt.length < MIN_PROMPT_LENGTH || prompt.length > MAX_PROMPT_LENGTH) {
                 editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2(`❌ پرامپت رفتار باید بین ${MIN_PROMPT_LENGTH} تا ${MAX_PROMPT_LENGTH} کاراکتر باشد\\.`), { 
                    reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: `cancel_state_return_${backCallback}` }]] },
                    parse_mode: 'MarkdownV2'
                }).catch(() => {});
                return true;
            }
            updates.newPrompt = prompt;
        }

        await db.updateSpecialUser(originalUserId, updates);
        await db.clearOwnerState(BOT_OWNER_ID);

        await editMessageSafe(bot, msg.chat.id, originalPanelMessageId, escapeMarkdownV2(`✅ ${field === 'id' ? 'ID' : field === 'name' ? 'نام' : 'پرامپت'} با موفقیت ویرایش شد\\.` ), { parse_mode: 'MarkdownV2' }).catch(() => { });

        setTimeout(() => goBackTo(`user_edit_select_${finalUserId}`).catch(() => {}), 1500);
        return true;
    }
    return false;
}

export async function handleUserTestPrompt(bot, cbq) {
    const data = cbq.data;
    const currentChatId = cbq.message.chat.id;
    const messageId = cbq.message.message_id;

    if (data.startsWith('user_test_prompt_execute_')) {
        const userId = parseInt(data.split('_').pop(), 10);
        await bot.answerCallbackQuery(cbq.id, { text: 'در حال ارسال پیام تست...' });
        
        const user = await db.getSpecialUser(userId);
        if (!user) {
            return editMessageSafe(bot, currentChatId, messageId, '❌ کاربر پیدا نشد.');
        }

        const testMessage = "سلام رفیق. فقط میخواستم ببینم لحن جدیدت چطوره؟";
        
        const systemInstruction = `--- USER ${user.user_id} TEST MODE ---
This is a test of your specific prompt for user ${user.user_id} (${user.display_name}).
Respond using ONLY the provided prompt as your core instruction, ignoring all other system context for this single message.
YOUR RESPONSE MUST BE IN PERSIAN.
Specific Prompt to use: ${user.prompt}`;
        
        try {
            // We need an API key to test. We can use keyPoolManager or temporary instance if we have access.
            // Since this file is not importing keyPoolManager, we'll assume 'bot' has a way or we need to import it.
            // Better approach: Use apiService if possible, or just handle error if no keys.
            
            // FIX: Importing apiService dynamically to avoid circular dep issues if any, 
            // or assume this function is called where apiService is available. 
            // Actually, let's keep it simple: 
            // We will use the 'keyPoolManager' to get a key manually here.
            
            const { getAvailableKeyInstance, releaseKey } = await import('../keyPoolManager.js');
            const keyObject = await getAvailableKeyInstance({ keyDailyRequestLimit: 999999, keyDailyTokenLimit: 99999999 }); // Force get key
            
            if (!keyObject) {
                 return editMessageSafe(bot, currentChatId, messageId, '❌ هیچ کلید API فعالی برای تست وجود ندارد.');
            }

            const result = await keyObject.instance.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: testMessage }] }],
                config: { systemInstruction: systemInstruction }
            });
            
            await releaseKey(keyObject);

            const responseText = result.response.text();
            
            const finalText = `🧪 *نتیجه تست پرامپت برای ${escapeMarkdownV2(user.display_name)}*\n\n${boldText('پیام آرتور:')}\n${codeBlock(responseText)}\n\n[👇 بازگشت به تنظیمات]`;

            await editMessageSafe(bot, currentChatId, messageId, finalText, {
                reply_markup: {
                    inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: `user_edit_select_${userId}` }]]
                },
                parse_mode: 'MarkdownV2'
            });

        } catch (e) {
            console.error(`Error testing user prompt ${userId}:`, e.message);
            await editMessageSafe(bot, currentChatId, messageId, `❌ خطایی در زمان تست پرامپت رخ داد. (Error: ${e.message.substring(0, 50)})`);
        }
        return true;
    }

    const userId = parseInt(data.split('_').pop(), 10);
    await bot.answerCallbackQuery(cbq.id).catch(() => {});
    
    const specialUser = await db.getSpecialUser(userId);
    if (!specialUser) {
        return bot.answerCallbackQuery(cbq.id, { text: 'کاربر یافت نشد', show_alert: true });
    }
    
    const testText = `🧪 ${boldText('تست پرامپت برای ')}${escapeMarkdownV2(specialUser.display_name)}\n\n${codeBlock(specialUser.prompt)}\n\nآیا می‌خواهید این پرامپت را تست کنید؟`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ تست با پیام نمونه', callback_data: `user_test_prompt_execute_${userId}` }],
            [{ text: '◀️ بازگشت', callback_data: `user_edit_select_${userId}` }]
        ]
    };
    
    return editMessageSafe(bot, currentChatId, messageId, testText, {
        reply_markup: keyboard,
        parse_mode: 'MarkdownV2'
    });
}


