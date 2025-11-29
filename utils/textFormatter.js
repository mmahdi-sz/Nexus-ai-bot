
export function escapeMarkdownV2(text) {
    if (!text || typeof text !== 'string') return '';
    const escaped = text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    return escaped;
}

export function boldText(text) {
    return `*${escapeMarkdownV2(text)}*`;
}

export function codeBlock(text) {
    return `\`\`\`\n${text}\n\`\`\``;
}

export function inlineCode(text) {
    // Note: The text inside inlineCode should not contain backticks itself.
    // The main escape function handles other markdown characters.
    return `\`${text.replace(/`/g, '')}\``;
}


export function stripMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    // First, remove problematic zero-width characters and other control characters
    const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
    // Then, strip markdown characters
    const stripped = cleaned.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '');
    console.log(`[textFormatter:stripMarkdown] Text stripped (Original len: ${text.length}, New len: ${stripped.length}).`);
    return stripped;
}

export async function sendMessageSafe(bot, chatId, text, options = {}) {
    console.log(`[textFormatter:sendMessageSafe] START (Chat: ${chatId}, Text len: ${text.length})`);
    const opts = {
        ...options,
        parse_mode: options.parse_mode || 'MarkdownV2'
    };

    try {
        const result = await bot.sendMessage(chatId, text, opts);
        console.log(`[textFormatter:sendMessageSafe] END - Message sent (ID: ${result.message_id}).`);
        return result;
    } catch (error) {
        if (error.response?.body?.description?.includes("can't parse entities")) {
            console.warn(`[textFormatter:sendMessageSafe] MarkdownV2 parse error, retrying as HTML`);
            opts.parse_mode = 'HTML';
            try {
                const htmlText = text
                    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                    .replace(/\*(.*?)\*/g, '<i>$1</i>')
                    .replace(/`(.*?)`/g, '<code>$1</code>');
                const result = await bot.sendMessage(chatId, htmlText, opts);
                console.log(`[textFormatter:sendMessageSafe] END - Message sent as HTML (ID: ${result.message_id}).`);
                return result;
            } catch (htmlError) {
                console.warn('[textFormatter:sendMessageSafe] HTML parse error, sending as plain text');
                delete opts.parse_mode;
                try {
                    const result = await bot.sendMessage(chatId, text, opts);
                    console.log(`[textFormatter:sendMessageSafe] END - Message sent as plain text (ID: ${result.message_id}).`);
                    return result;
                } catch (fallbackError) {
                    console.error('[textFormatter:sendMessageSafe] Final fallback failed:', fallbackError.message);
                    throw fallbackError;
                }
            }
        }
        console.error('[textFormatter:sendMessageSafe] Failed to send message:', error.message);
        throw error;
    }
}


export async function editMessageSafe(bot, chatId, messageId, text, options = {}) {
    console.log(`[textFormatter:editMessageSafe] START (Chat: ${chatId}, Msg ID: ${messageId}, Text len: ${text.length})`);
    const opts = {
        chat_id: chatId,
        message_id: messageId,
        ...options,
        parse_mode: options.parse_mode || 'MarkdownV2'
    };

    try {
        const result = await bot.editMessageText(text, opts);
        console.log(`[textFormatter:editMessageSafe] END - Message edited with ${opts.parse_mode}.`);
        return result;
    } catch (error) {
        if (error.response?.body?.description?.includes('message is not modified')) {
            console.log('[textFormatter:editMessageSafe] END - Message not modified (handled).');
            return null;
        }
        if (error.response?.body?.description?.includes("can't parse entities")) {
            console.warn(`[textFormatter:editMessageSafe] MarkdownV2 parse error, retrying as HTML`);
            opts.parse_mode = 'HTML';
            try {
                 const htmlText = text
                    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                    .replace(/\*(.*?)\*/g, '<i>$1</i>')
                    .replace(/`(.*?)`/g, '<code>$1</code>');
                const result = await bot.editMessageText(htmlText, opts);
                console.log(`[textFormatter:editMessageSafe] END - Message edited as HTML.`);
                return result;
            } catch (htmlError) {
                if (htmlError.response?.body?.description?.includes('message is not modified')) {
                    console.log('[textFormatter:editMessageSafe] Edit failed: Message not modified (handled).');
                    return null;
                }
                console.warn('[textFormatter:editMessageSafe] HTML parse error, editing as plain text');
                delete opts.parse_mode;
                 try {
                    const result = await bot.editMessageText(text, opts);
                    console.log(`[textFormatter:editMessageSafe] END - Message edited as plain text.`);
                    return result;
                } catch (fallbackError) {
                    if (fallbackError.response?.body?.description?.includes('message is not modified')) {
                        console.log('[textFormatter:editMessageSafe] Edit failed: Message not modified (handled).');
                        return null;
                    }
                    console.error('[textFormatter:editMessageSafe] Final fallback failed:', fallbackError.message);
                    throw fallbackError;
                }
            }
        }
        console.error('[textFormatter:editMessageSafe] Failed to edit message:', error.message);
        throw error;
    }
}