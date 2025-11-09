import * as db from '../database.js';
import { GoogleGenAI } from '@google/genai';

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

export async function validateApiKey(apiKey) {
    const cleanedApiKey = apiKey.trim();

    try {
        const genAI = new GoogleGenAI({ apiKey: cleanedApiKey });
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "test",
        });
        
        const text = result.text;

        if (text && text.length > 0) {
            return { isValid: true, reason: 'success' };
        }
        return { isValid: false, reason: 'generic' };
    } catch (error) {
        console.error(`[validateApiKey] Key validation failed. Reason:`, error.message);
        if (error.message && (error.message.includes('"code":429') || error.message.includes('RESOURCE_EXHAUSTED'))) {
            return { isValid: false, reason: 'rate_limited' };
        }
        return { isValid: false, reason: 'generic' };
    }
}