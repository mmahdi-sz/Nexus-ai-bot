
import { dbQuery } from '../repository.js';
import { getAppCache } from '../../database.js';

export const setSetting = async (key, value) => {
    console.log(`[db:config:setSetting] Querying (Key: ${key})`);
    const valueJson = JSON.stringify(value);
    const result = await dbQuery(
        `INSERT INTO app_settings (key_name, value_json) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value_json = ?`,
        [key, valueJson, valueJson]
    );

    if (getAppCache().globalSettings.hasOwnProperty(key)) {
        getAppCache().globalSettings[key] = value;
    }
    
    return result;
};

export const getSetting = async (key, defaultValue = null) => {
    const cache = getAppCache();
    if (cache.globalSettings.hasOwnProperty(key)) {
        return cache.globalSettings[key] !== undefined ? cache.globalSettings[key] : defaultValue;
    }
    
    console.log(`[db:config:getSetting] Querying (Key: ${key}) - Cache Miss`);
    const rows = await dbQuery("SELECT value_json FROM app_settings WHERE key_name = ?", [key]);
    if (rows.length === 0) return defaultValue;
    
    let value = rows[0].value_json;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            console.error(`[db:config:getSetting] Error parsing JSON for key ${key}:`, e.message);
            return value; 
        }
    }

    return value;
};

export const toggleGlobalButton = async () => {
    const key = 'global_button_enabled';
    console.log(`[db:config:toggleGlobalButton] Querying for current status.`);
    
    const current = await getSetting(key, true);
    const newValue = !current;
    
    await setSetting(key, newValue);
    console.log(`[db:config:toggleGlobalButton] New value: ${newValue}`);
    return newValue;
};

export const isGlobalButtonEnabled = async () => {
    const key = 'global_button_enabled';
    const cache = getAppCache();
    if (cache.globalSettings.hasOwnProperty(key)) {
        return cache.globalSettings[key] !== undefined ? cache.globalSettings[key] : true;
    }
    
    console.log(`[db:config:isGlobalButtonEnabled] Querying status - Cache Miss.`);
    return await getSetting(key, true);
};

export const addTutorialMedia = (fileId, fileType, caption, sortOrder) => {
    console.log(`[db:config:addTutorialMedia] Querying (File Type: ${fileType}, Order: ${sortOrder})`);
    return dbQuery(
        `INSERT INTO api_tutorial_media (file_id, file_type, caption, sort_order) 
         VALUES (?, ?, ?, ?)`,
        [fileId, fileType, caption, sortOrder]
    );
};

export const getAllTutorialMedia = () => {
    console.log(`[db:config:getAllTutorialMedia] Querying all media.`);
    return dbQuery(`SELECT * FROM api_tutorial_media ORDER BY sort_order`);
};

export const clearTutorialMedia = () => {
    console.log(`[db:config:clearTutorialMedia] Querying DELETE all media.`);
    return dbQuery(`DELETE FROM api_tutorial_media`);
};

export const setTutorialTextForApi = (text, buttonText, buttonUrl) => {
    console.log(`[db:config:setTutorialTextForApi] Querying (Button URL: ${buttonUrl ? 'YES' : 'NO'})`);
    return dbQuery(
        `INSERT INTO api_tutorial_text (id, tutorial_text, button_text, button_url) 
         VALUES (1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
            tutorial_text = ?,
            button_text = ?,
            button_url = ?`,
        [text, buttonText, buttonUrl, text, buttonText, buttonUrl]
    );
};

export const getTutorialTextForApi = async () => {
    console.log(`[db:config:getTutorialTextForApi] Querying text.`);
    const rows = await dbQuery(`SELECT * FROM api_tutorial_text WHERE id = 1`);
    return rows.length > 0 ? rows[0] : null;
};

export const setBackupChannel = (channelId, channelTitle) => {
    return dbQuery(
        `INSERT INTO backup_channels (channel_id, channel_title, enabled) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE channel_title = ?, enabled = 1`,
        [channelId, channelTitle, channelTitle]
    );
};

export const getBackupChannel = async () => {
    const rows = await dbQuery("SELECT * FROM backup_channels WHERE enabled = 1 LIMIT 1");
    return rows.length > 0 ? rows[0] : null;
};

export const disableBackupChannel = () => {
    return dbQuery("UPDATE backup_channels SET enabled = 0");
};


