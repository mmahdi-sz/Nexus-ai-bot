
import { dbQuery } from '../repository.js';
import { getAppCache } from '../../database.js';

export const addChat = async (chatId, userId) => {
    console.log(`[db:chat:addChat] Querying (Chat: ${chatId}, User: ${userId})`);
    const result = await dbQuery(
        `INSERT INTO chats (chat_id, is_enabled, enabled_by_user_id) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE is_enabled = 1, enabled_by_user_id = ?`,
        [chatId, userId, userId]
    );
    
    // Cache Update
    getAppCache().authorizedChats.add(chatId);
    
    return result;
};

export const deactivateChat = async (chatId) => {
    console.log(`[db:chat:deactivateChat] Querying (Chat: ${chatId})`);
    await dbQuery("UPDATE chats SET is_enabled = 0 WHERE chat_id = ?", [chatId]);
    await dbQuery("UPDATE group_stats SET is_enabled = 0 WHERE chat_id = ?", [chatId]);
    
    // Cache Update
    getAppCache().authorizedChats.delete(chatId);
};

export const isChatAuthorized = async (chatId) => {
    // Optimized: Check cache first
    const cache = getAppCache();
    if (cache.authorizedChats.has(chatId)) {
        return true;
    }
    
    console.log(`[db:chat:isChatAuthorized] Querying (Chat: ${chatId}) - Cache Miss`);
    const rows = await dbQuery("SELECT is_enabled FROM chats WHERE chat_id = ?", [chatId]);
    const isAuthorized = rows.length > 0 ? rows[0].is_enabled === 1 : false;

    // Optional: Add to cache if authorized to prevent future misses (though main logic is on startup/addChat)
    if (isAuthorized) {
        cache.authorizedChats.add(chatId);
    }
    
    return isAuthorized;
};

export const updateGroupStats = (chatId, chatTitle, memberCount, isEnabled) => {
    console.log(`[db:chat:updateGroupStats] Querying (Chat: ${chatId}, Title: ${chatTitle})`);
    return dbQuery(
        `INSERT INTO group_stats (chat_id, chat_title, member_count, is_enabled) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE chat_title = ?, 
                                 member_count = ?,
                                 is_enabled = ?,
                                 last_updated = CURRENT_TIMESTAMP`,
        [chatId, chatTitle, memberCount, isEnabled ? 1 : 0, chatTitle, memberCount, isEnabled ? 1 : 0]
    );
};

export const getAllGroupStats = async () => {
    console.log(`[db:chat:getAllGroupStats] Querying for aggregate stats.`);
    const rows = await dbQuery(`
        SELECT 
            COUNT(*) as total_groups,
            SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) as enabled_groups,
            COALESCE(SUM(member_count), 0) as total_members
        FROM group_stats
    `);
    return rows.length > 0 ? rows[0] : { total_groups: 0, enabled_groups: 0, total_members: 0 };
};

export const getGroupDetailsList = () => {
    console.log(`[db:chat:getGroupDetailsList] Querying for group list.`);
    return dbQuery(`SELECT * FROM group_stats ORDER BY member_count DESC`);
};

export const addSpecialChat = (chatId, chatTitle) => {
    console.log(`[db:chat:addSpecialChat] Querying (Chat: ${chatId}, Title: ${chatTitle})`);
    return dbQuery(
        `INSERT INTO special_chats (chat_id, chat_title) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE chat_title = ?`,
        [chatId, chatTitle, chatTitle]
    );
};

export const removeSpecialChat = (chatId) => {
    console.log(`[db:chat:removeSpecialChat] Querying (Chat: ${chatId})`);
    return dbQuery(
        "DELETE FROM special_chats WHERE chat_id = ?",
        [chatId]
    );
};

export const isSpecialChat = async (chatId) => {
    console.log(`[db:chat:isSpecialChat] Querying (Chat: ${chatId})`);
    const rows = await dbQuery("SELECT chat_id FROM special_chats WHERE chat_id = ?", [chatId]);
    return rows.length > 0;
};

export const getAllSpecialChats = () => {
    console.log(`[db:chat:getAllSpecialChats] Querying for special chats list.`);
    return dbQuery("SELECT * FROM special_chats ORDER BY chat_title");
};


