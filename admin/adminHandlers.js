import * as db from '../database.js';
import { GoogleGenAI } from '@google/genai';

/**
 * ایجاد منوی حذف پویا برای API Keys یا Special Chats.
 */
export async function generateDeletionMenu(getItems, config) {
    const { emptyText, backCallback, title, itemTextKey, itemIdKey, callbackPrefix } = config;

    const items = await getItems();
    if (items.length === 0) {
        return {
            text: emptyText,
            keyboard: { inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: backCallback }]] }
        };
    }

    const keyboardRows = items.map(item => ([{
        text: `🗑️ حذف ${item[itemTextKey]}`,
        callback_data: `${callbackPrefix}${item[itemIdKey]}`
    }]));
    keyboardRows.push([{ text: '↩️ بازگشت', callback_data: backCallback }]);

    return {
        text: title,
        keyboard: { inline_keyboard: keyboardRows }
    };
}

/**
 * اعتبارسنجی یک کلید API با استفاده از یک فراخوانی ساده به Gemini.
 */
export async function validateApiKey(apiKey) {
    try {
        const genAI = new GoogleGenAI({ apiKey });
        await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: "test" }] }],
        });
        return true;
    } catch (error) {
        console.error(`[validateApiKey] Key validation failed. Reason:`, error);
        return false;
    }
}