import * as db from '../database.js';
import { prompts } from '../prompts.js';
import { editMessageSafe, sendMessageSafe, boldText, codeBlock, inlineCode, escapeMarkdownV2 } from '../utils/textFormatter.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
const MAX_PROMPT_LENGTH = 10000;
const PROMPT_EDIT_TIMEOUT_MS = 10 * 60 * 1000;

const identityKeyboard = { inline_keyboard: [[{ text: '📜 هویت اصلی', callback_data: 'prompt_edit_identity_core' }], [{ text: '🐴 داستان زندگی', callback_data: 'prompt_edit_identity_backstory' }], [{ text: '↩️ بازگشت', callback_data: 'prompt_menu_main' }]] };
const toneKeyboard = { inline_keyboard: [[{ text: '🎭 سبک و لحن', callback_data: 'prompt_edit_tone_style' }], [{ text: '✍️ واژگان', callback_data: 'prompt_edit_tone_vocabulary' }], [{ text: '↩️ بازگشت', callback_data: 'prompt_menu_main' }]] };
const opinionsKeyboard = { inline_keyboard: [[{ text: '🌍 جهان‌بینی و نظرات کلی', callback_data: 'prompt_edit_opinions_worldview' }], [{ text: '↩️ بازگشت', callback_data: 'prompt_menu_main' }]] };
const rulesKeyboard = { inline_keyboard: [[{ text: '🛡️ حفظ شخصیت', callback_data: 'prompt_edit_rules_characterIntegrity' }], [{ text: '✍️ فرمت پاسخ', callback_data: 'prompt_edit_rules_responseFormat' }], [{ text: '↩️ بازگشت', callback_data: 'prompt_menu_main' }]] };

const promptsMainMenuKeyboard = {
    inline_keyboard: [
        [{ text: '🧑 شخصیت و هویت', callback_data: 'prompt_menu_identity' }],
        [{ text: '🗣️ لحن و سبک صحبت', callback_data: 'prompt_menu_tone' }],
        [{ text: '👁️ نظرات و دیدگاه‌ها', callback_data: 'prompt_menu_opinions' }],
        [{ text: '🔒 قوانین نهایی', callback_data: 'prompt_menu_rules' }],
        [{ text: '↩️ بازگشت', callback_data: 'admin_panel' }]
    ]
};

async function handlePromptSave(bot, cbq, msg, mainKey, subKey) {
    const ownerId = cbq.from.id;
    await bot.answerCallbackQuery(cbq.id, { text: '💾 در حال ذخیره...' }).catch(() => {});
    
    const ownerState = await db.getOwnerState(ownerId);
    const newPrompt = ownerState.data.collected_text;
    
    const currentPrompts = await db.getSetting('prompts', prompts);
    
    const keyPath = currentPrompts.system[mainKey];
    if (keyPath) {
        keyPath[subKey] = newPrompt;
    }
    
    await db.setSetting('prompts', currentPrompts);
    await db.clearOwnerState(ownerId);
    
    const successText = `✅ ${boldText('تغییرات ذخیره شد!')}

${boldText('پرامپت:')} ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)}

📊 ${boldText('جزئیات:')}
\\- طول جدید: ${escapeMarkdownV2(newPrompt.length.toString())} کاراکتر
\\- خطوط: ${escapeMarkdownV2(newPrompt.split('\n').length.toString())} خط

✨ تغییرات در مکالمات بعدی اعمال می‌شود\\.`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔧 ویرایش پرامپت دیگر', callback_data: `prompt_menu_${mainKey}` }],
            [{ text: '🏠 بازگشت به پنل اصلی', callback_data: 'admin_panel' }]
        ]
    };
    
    return editMessageSafe(bot, msg.chat.id, msg.message_id, successText, {
        reply_markup: keyboard,
        parse_mode: 'MarkdownV2'
    });
}

async function handlePromptCompare(bot, cbq, msg, mainKey, subKey) {
    await bot.answerCallbackQuery(cbq.id).catch(() => {});
    
    const ownerState = await db.getOwnerState(BOT_OWNER_ID);
    const newPrompt = ownerState.data.collected_text;
    
    const currentPrompts = await db.getSetting('prompts', prompts);
    const oldPrompt = currentPrompts?.system?.[mainKey]?.[subKey] || '';
    
    const oldLines = oldPrompt.split('\n');
    const newLines = newPrompt.split('\n');
    
    let diffOutput = `${boldText('📊 مقایسه تغییرات (نمایش 20 خط اول)')}\n\n`;
    const maxLines = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < Math.min(maxLines, 20); i++) {
        const oldLine = oldLines[i] || '';
        const newLine = newLines[i] || '';
        
        if (oldLine !== newLine) {
            const status = oldLine ? '🔄 تغییر' : '✅ اضافه';
            diffOutput += `\\* خط ${escapeMarkdownV2((i + 1).toString())}: ${escapeMarkdownV2(status)}${!oldLine && newLine ? '' : ''}\n`;
        }
    }
    
    if (maxLines > 20) {
        diffOutput += `\n... و ${escapeMarkdownV2((maxLines - 20).toString())} خط دیگر\\.\n\n`;
    }
    
    await sendMessageSafe(bot, msg.chat.id, diffOutput, { parse_mode: 'MarkdownV2' });

    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ ذخیره تغییرات', callback_data: `prompt_save_${mainKey}_${subKey}` }],
            [{ text: '✏️ ویرایش مجدد', callback_data: `prompt_edit_full_${mainKey}_${subKey}` }],
            [{ text: '❌ لغو و بازگشت', callback_data: `prompt_edit_cancel_${mainKey}_${subKey}` }]
        ]
    };
    
    return sendMessageSafe(bot, msg.chat.id, 
        boldText('آیا از ذخیره این تغییرات مطمئن هستید؟'), 
        { reply_markup: keyboard, parse_mode: 'MarkdownV2' });
}

async function handlePromptReset(bot, cbq, msg, mainKey, subKey) {
    const ownerId = cbq.from.id;
    // FIX 1: Move answerCallbackQuery to the start to prevent ETELEGRAM timeout
    await bot.answerCallbackQuery(cbq.id, { text: '🔄 بازگردانی به پیش‌فرض...' }).catch(() => {});
    
    // FIX 2: Validate the keys to handle malformed data gracefully
    if (!mainKey || !subKey) {
         console.error(`[handlePromptReset] Invalid keys: ${mainKey}.${subKey}`);
         const errorText = await db.getText('admin_error', '⚠️ یک خطای داخلی در پردازش پیام شما رخ داد\\. عملیات لغو شد\\. \\(خطای کلید پرامپت\\)');
         await editMessageSafe(bot, msg.chat.id, msg.message_id, errorText, { 
            reply_markup: { inline_keyboard: [[{ text: '🏠 بازگشت به پنل', callback_data: 'admin_panel' }]] },
            parse_mode: 'MarkdownV2'
         });
         return;
    }

    const currentPrompts = await db.getSetting('prompts', prompts);
    const defaultPrompt = prompts.system?.[mainKey]?.[subKey];

    if (!defaultPrompt) {
        console.error(`[handlePromptReset] Default prompt not found for ${mainKey}.${subKey}`);
        // FIX 3: Respond gracefully with an edit
        const errorText = await db.getText('admin_error', `❌ پرامپت پیش‌فرض برای ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)} یافت نشد\\. عملیات لغو شد\\.`);
        return editMessageSafe(bot, msg.chat.id, msg.message_id, errorText, {
            reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: `prompt_menu_${mainKey}` }]] },
            parse_mode: 'MarkdownV2'
        });
    }

    if (currentPrompts?.system?.[mainKey]) {
        currentPrompts.system[mainKey][subKey] = defaultPrompt;
    } else {
        currentPrompts.system = currentPrompts.system || {};
        currentPrompts.system[mainKey] = currentPrompts.system[mainKey] || {};
        currentPrompts.system[mainKey][subKey] = defaultPrompt;
    }
    
    await db.setSetting('prompts', currentPrompts);
    await db.clearOwnerState(ownerId);
    
    const successText = `✅ ${boldText('بازگردانی موفق')}

${boldText('پرامپت:')} ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)}

به نسخه پیش‌فرض بازگردانی شد\\. برای بررسی روی ${boldText('◀️ بازگشت')} کلیک کنید\\.`;

    // FIX 1: Add return here to prevent "No handler found" warning
    return editMessageSafe(bot, msg.chat.id, msg.message_id, successText, {
        reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: `prompt_menu_${mainKey}` }]] },
        parse_mode: 'MarkdownV2'
    });
}

// FIX 2: Implementation of the missing function handlePromptFullEdit
export async function handlePromptFullEdit(bot, cbq, msg, mainKey, subKey) {
    const ownerId = cbq.from.id;
    await bot.answerCallbackQuery(cbq.id).catch(() => {});
    
    const savedPrompts = await db.getSetting('prompts', prompts);
    const defaultPrompt = prompts.system?.[mainKey]?.[subKey] || '';
    const currentPromptsObject = { ...prompts.system?.[mainKey], ...savedPrompts?.system?.[mainKey] };
    const currentPrompt = currentPromptsObject?.[subKey] || defaultPrompt;
    
    const backCallback = `prompt_menu_${mainKey}`;
    
    // 1. Set the new state: Initial text is the current prompt, message_count is 0
    await db.setOwnerState(ownerId, `editing_prompt_full_${mainKey}_${subKey}`, {
        message_id: msg.message_id,
        main_key: mainKey,
        sub_key: subKey,
        collected_text: currentPrompt, // Pre-fill with current content
        message_count: 0,
        timeout_at: Date.now() + PROMPT_EDIT_TIMEOUT_MS,
        return_callback: backCallback
    });
    
    // 2. Prepare instructions (UPDATED INSTRUCTION TEXT)
    const instructionText = `✏️ ${boldText('ویرایش کامل پرامپت')}

${boldText('مسیر:')} ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)}

*دستورالعمل:*
\\- لطفاً متن کامل پرامپت جدید را ارسال کنید\\. (اولین پیام، متن فعلی را **جایگزین** می‌کند)\\.
\\- می‌توانید متن را در چند پیام پشت سر هم بفرستید\\. (پیام‌های بعدی با خط جدید **اضافه** می‌شوند)\\.
\\- در پایان، دکمه ${boldText('✅ اتمام ویرایش')} را فشار دهید\\.

*متن فعلی (با ${escapeMarkdownV2(currentPrompt.length.toString())} کاراکتر) در حافظه ذخیره شده است اما با اولین ورودی شما **جایگزین** خواهد شد\\.*`;

    const keyboard = {
        inline_keyboard: [
            // Button text will be updated by handlePromptEditInput after receiving text
            [{ text: '✅ اتمام ویرایش', callback_data: `prompt_finish_edit_${mainKey}_${subKey}` }],
            [{ text: '❌ لغو', callback_data: `cancel_state_return_${backCallback}` }]
        ]
    };
    
    // 3. Edit the message to show instructions and the 'Finish' button
    return editMessageSafe(bot, msg.chat.id, msg.message_id, instructionText, {
        reply_markup: keyboard,
        parse_mode: 'MarkdownV2'
    });
}


export async function handlePromptEditWizard(bot, cbq, msg, mainKey, subKey) {
    const ownerId = cbq.from.id;
    await bot.answerCallbackQuery(cbq.id).catch(() => {});
    
    const savedPrompts = await db.getSetting('prompts', prompts);
    const defaultPrompt = prompts.system?.[mainKey]?.[subKey] || '';
    const currentPromptsObject = { ...prompts.system?.[mainKey], ...savedPrompts?.system?.[mainKey] };
    const currentPrompt = currentPromptsObject?.[subKey] || defaultPrompt;
    
    const isModified = currentPrompt !== defaultPrompt;
    const charCount = currentPrompt.length;
    const lineCount = currentPrompt.split('\n').length;
    
    // Building infoText without a single global escapeMarkdownV2 wrapper
    const infoText = `📝 ${boldText('ویرایش پرامپت')}

${boldText('مسیر:')} ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)}

📊 ${boldText('اطلاعات:')}
\\- 📏 طول: ${escapeMarkdownV2(charCount.toString())} کاراکتر
\\- 📄 خطوط: ${escapeMarkdownV2(lineCount.toString())} خط
\\- 🔄 وضعیت: ${isModified ? boldText('✏️ ویرایش شده') : '📌 پیش‌فرض'}

${boldText('متن فعلی (در پیام‌های جداگانه):')}`;
    
    await editMessageSafe(bot, msg.chat.id, msg.message_id, infoText, {
        parse_mode: 'MarkdownV2'
    });
    
    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < currentPrompt.length; i += chunkSize) {
        chunks.push(currentPrompt.substring(i, i + chunkSize));
    }
    
    for (let i = 0; i < chunks.length; i++) {
        const chunkHeader = `📄 ${boldText(`بخش ${escapeMarkdownV2((i + 1).toString())} از ${escapeMarkdownV2(chunks.length.toString())}:`)}\n\n`;
        await sendMessageSafe(bot, msg.chat.id, 
            chunkHeader + codeBlock(chunks[i]), 
            { parse_mode: 'MarkdownV2' });
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✏️ ویرایش کامل', callback_data: `prompt_edit_full_${mainKey}_${subKey}` }],
            [{ text: '🔄 بازگردانی پیش‌فرض', callback_data: `prompt_reset_confirm_${mainKey}_${subKey}` }],
            [{ text: '◀️ بازگشت', callback_data: `prompt_menu_${mainKey}` }]
        ]
    };
    
    return sendMessageSafe(bot, msg.chat.id, 
        boldText('چه کاری می‌خواهید انجام دهید؟'), 
        { reply_markup: keyboard, parse_mode: 'MarkdownV2' });
}

export async function handlePromptEditInput(bot, msg, ownerState) {
    const ownerId = msg.from.id;
    const { main_key, sub_key, collected_text, message_count, timeout_at, message_id } = ownerState.data;
    const backCallback = `prompt_menu_${main_key}`;
    
    if (Date.now() > timeout_at) {
        await db.clearOwnerState(ownerId);
        await sendMessageSafe(bot, msg.chat.id, escapeMarkdownV2('⏱ زمان تمام شد\\. تغییرات ذخیره نشد\\.'), { parse_mode: 'MarkdownV2' });
        return true;
    }
    
    const newText = msg.text || '';
    
    if (message_count >= 10 && newText.length > 0) {
        await sendMessageSafe(bot, msg.chat.id, 
            escapeMarkdownV2('⚠️ حداکثر 10 پیام می‌توانید بفرستید\\. لطفاً روی "✅ اتمام ویرایش" کلیک کنید\\.'), { parse_mode: 'MarkdownV2' });
        return true;
    }
    
    let updatedText;
    let finalMessageCount = message_count + 1;

    // FIX 3: New logic for replacing old content on the first message, and appending on subsequent messages.
    if (message_count === 0) {
        // First message (message_count was 0): Replace the pre-filled content (collected_text) with the user's new input.
        updatedText = newText; 
    } else {
        // Subsequent messages: Append with a newline.
        const separator = (collected_text.length > 0) ? '\n' : '';
        updatedText = collected_text + separator + newText;
    }
    
    if (updatedText.length > MAX_PROMPT_LENGTH) {
        await sendMessageSafe(bot, msg.chat.id, 
            escapeMarkdownV2(`❌ حداکثر طول ${MAX_PROMPT_LENGTH} کاراکتر است\\. متن شما بیش از حد طولانی است\\..`), { parse_mode: 'MarkdownV2' });
        return true;
    }
    
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    
    await db.setOwnerState(ownerId, ownerState.state, {
        ...ownerState.data,
        collected_text: updatedText,
        message_count: finalMessageCount // Use the new count
    });
    
    const buttonText = `📝 ${escapeMarkdownV2(finalMessageCount.toString())} پیام دریافت شد \\(${escapeMarkdownV2(updatedText.length.toString())} حرف\\)`;
    
    await bot.editMessageReplyMarkup({
        inline_keyboard: [
            [{ 
                text: buttonText, 
                callback_data: 'noop' 
            }],
            [{ text: '✅ اتمام ویرایش', callback_data: `prompt_finish_edit_${main_key}_${sub_key}` }],
            [{ text: '❌ لغو', callback_data: `cancel_state_return_${backCallback}` }]
        ]
    }, {
        chat_id: msg.chat.id,
        message_id: message_id
    }).catch(() => {});
    
    return true;
}

export async function handlePromptFinishEdit(bot, cbq, msg, mainKey, subKey) {
    const ownerId = cbq.from.id;
    await bot.answerCallbackQuery(cbq.id).catch(() => {});
    
    const ownerState = await db.getOwnerState(ownerId);
    const newPrompt = ownerState.data.collected_text;
    
    if (!newPrompt || newPrompt.trim().length === 0) {
        await bot.answerCallbackQuery(cbq.id, { 
            text: '❌ متنی دریافت نشد!', 
            show_alert: true 
        });
        return;
    }
    
    const currentPrompts = await db.getSetting('prompts', prompts);
    const oldPrompt = currentPrompts?.system?.[mainKey]?.[subKey] || '';
    
    const oldLines = oldPrompt.split('\n').length;
    const newLines = newPrompt.split('\n').length;
    const diffLines = newLines - oldLines;
    const diffChars = newPrompt.length - oldPrompt.length;
    
    const previewText = `👁 ${boldText('پیش‌نمایش تغییرات')}

${boldText('قبل از تغییر:')}
\\- طول: ${escapeMarkdownV2(oldPrompt.length.toString())} کاراکتر
\\- خطوط: ${escapeMarkdownV2(oldLines.toString())} خط

${boldText('بعد از تغییر:')}
\\- طول: ${escapeMarkdownV2(newPrompt.length.toString())} کاراکتر \\(${diffChars > 0 ? '+' : ''}${escapeMarkdownV2(diffChars.toString())}\\)
\\- خطوط: ${escapeMarkdownV2(newLines.toString())} خط \\(${diffLines > 0 ? '+' : ''}${escapeMarkdownV2(diffLines.toString())}\\)

${boldText('متن جدید (در پیام‌های جداگانه):')}`;
    
    await editMessageSafe(bot, msg.chat.id, msg.message_id, previewText, {
        parse_mode: 'MarkdownV2'
    });
    
    const chunkSize = 2000;
    for (let i = 0; i < newPrompt.length; i += chunkSize) {
        const chunk = newPrompt.substring(i, i + chunkSize);
        await sendMessageSafe(bot, msg.chat.id, 
            codeBlock(chunk), 
            { parse_mode: 'MarkdownV2' });
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ ذخیره تغییرات', callback_data: `prompt_save_${mainKey}_${subKey}` }],
            [
                { text: '📊 مقایسه با قبلی', callback_data: `prompt_compare_${mainKey}_${subKey}` },
                { text: '✏️ ویرایش مجدد', callback_data: `prompt_edit_full_${mainKey}_${subKey}` }
            ],
            [{ text: '❌ لغو و بازگشت', callback_data: `prompt_edit_cancel_${mainKey}_${subKey}` }]
        ]
    };
    
    return sendMessageSafe(bot, msg.chat.id, 
        boldText('آیا از ذخیره این تغییرات مطمئن هستید؟'), 
        { reply_markup: keyboard, parse_mode: 'MarkdownV2' });
}


export async function handlePromptMenu(bot, msg, data) {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    if (data === 'prompt_menu_main') {
        return editMessageSafe(bot, chatId, messageId, '**مدیریت پرامپت‌ها**\n\nکدام بخش کلی را ویرایش می‌کنید؟', { reply_markup: promptsMainMenuKeyboard, parse_mode: 'Markdown' });
    }
    if (data === 'prompt_menu_identity') {
        return editMessageSafe(bot, chatId, messageId, '**شخصیت و هویت**', { reply_markup: identityKeyboard, parse_mode: 'Markdown' });
    }
    if (data === 'prompt_menu_tone') {
        return editMessageSafe(bot, chatId, messageId, '**لحن و سبک صحبت**', { reply_markup: toneKeyboard, parse_mode: 'Markdown' });
    }
    if (data === 'prompt_menu_opinions') {
        return editMessageSafe(bot, chatId, messageId, '**نظرات و دیدگاه‌ها**', { reply_markup: opinionsKeyboard, parse_mode: 'Markdown' });
    }
    if (data === 'prompt_menu_rules') {
        return editMessageSafe(bot, chatId, messageId, '**قوانین نهایی**', { reply_markup: rulesKeyboard, parse_mode: 'Markdown' });
    }

    if (data.startsWith('prompt_edit_')) {
        const keys = data.replace('prompt_edit_', '').split('_');
        const mainKey = keys[0];
        const subKey = keys[1];
        
        return handlePromptEditWizard(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_edit_full_')) {
        const keys = data.replace('prompt_edit_full_', '').split('_');
        const mainKey = keys[0];
        const subKey = keys[1];
        // FIX 2: Correctly calling the newly defined function
        return handlePromptFullEdit(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_finish_edit_')) {
        const keys = data.replace('prompt_finish_edit_', '').split('_');
        const mainKey = keys[0];
        const subKey = keys[1];
        return handlePromptFinishEdit(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_save_')) {
        const keys = data.replace('prompt_save_', '').split('_');
        const mainKey = keys[0];
        const subKey = keys[1];
        return handlePromptSave(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_compare_')) {
        const keys = data.replace('prompt_compare_', '').split('_');
        const mainKey = keys[0];
        const subKey = keys[1];
        return handlePromptCompare(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_reset_confirm_')) {
        // FIX B-1: Re-structure for a safe key path transfer
        const keyPath = data.replace('prompt_reset_confirm_', '');
        const [mainKey, subKey] = keyPath.split('_');

        const text = `⚠️ ${boldText('تایید بازگردانی به پیش‌فرض')}

آیا مطمئن هستید که می‌خواهید پرامپت ${inlineCode(mainKey)} ➜ ${inlineCode(subKey)} را به مقدار پیش‌فرض بازگردانید؟`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ بله، بازگردانی شود', callback_data: `prompt_reset_${keyPath}` }], // FIX B-1: Correct callback data
                [{ text: '❌ لغو', callback_data: `cancel_state_return_prompt_menu_${mainKey}` }]
            ]
        };
        
        return editMessageSafe(bot, chatId, messageId, text, { reply_markup: keyboard, parse_mode: 'MarkdownV2' });
    }
    
    if (data.startsWith('prompt_reset_')) {
        // FIX B-2: Use the transferred keyPath
        const [mainKey, subKey] = data.replace('prompt_reset_', '').split('_');
        return handlePromptReset(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: data }, msg, mainKey, subKey);
    }
    
    if (data.startsWith('prompt_edit_cancel_')) {
        const backCallback = data.split('_').slice(3).join('_');
        await db.clearOwnerState(BOT_OWNER_ID);
        await bot.answerCallbackQuery(msg.id, { text: '❌ عملیات ویرایش لغو شد.' }).catch(() => {});
        return handlePromptEditWizard(bot, { ...msg, from: { id: BOT_OWNER_ID }, data: `prompt_edit_${backCallback}` }, msg, backCallback.split('_')[0], backCallback.split('_')[1]);
    }


    return false;
}