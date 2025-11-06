import { dbQuery } from '../repository.js';

export const getText = async (key, defaultValue = null) => {
    console.log(`[db:texts:getText] Querying (Key: ${key})`);
    const rows = await dbQuery("SELECT text_value FROM tutorial_texts WHERE text_key = ?", [key]);
    return rows.length > 0 ? rows[0].text_value : defaultValue;
};

export const setText = async (key, value) => {
    console.log(`[db:texts:setText] Querying (Key: ${key})`);
    const finalValue = (value === undefined || value === null) ? '' : value; 

    return dbQuery(
        `INSERT INTO tutorial_texts (text_key, text_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE text_value = ?`,
        [key, finalValue, finalValue]
    );
};

export const getAllTexts = () => {
    console.log(`[db:texts:getAllTexts] Querying all texts.`);
    return dbQuery("SELECT * FROM tutorial_texts ORDER BY text_key");
};

export const getTextsByCategory = (category) => {
    console.log(`[db:texts:getTextsByCategory] Querying (Category: ${category})`);
    return dbQuery("SELECT * FROM tutorial_texts WHERE text_key LIKE ? ORDER BY text_key", [`${category}%`]);
};