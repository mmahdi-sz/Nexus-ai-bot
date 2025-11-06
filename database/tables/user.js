import { dbQuery } from '../repository.js';

export const addSpecialUser = (userId, displayName, prompt) => {
    return dbQuery(
        `INSERT INTO special_users (user_id, display_name, prompt) VALUES (?, ?, ?)`,
        [userId, displayName, prompt]
    );
};

export const getSpecialUser = async (userId) => {
    const rows = await dbQuery(`SELECT * FROM special_users WHERE user_id = ?`, [userId]);
    return rows.length > 0 ? rows[0] : null;
};

export const getAllSpecialUsers = () => {
    return dbQuery(`SELECT user_id, display_name FROM special_users ORDER BY display_name`);
};

export const deleteSpecialUser = (userId) => {
    return dbQuery(`DELETE FROM special_users WHERE user_id = ?`, [userId]);
};

export const updateSpecialUser = (originalUserId, { newUserId, newDisplayName, newPrompt }) => {
    const updates = [];
    const params = [];
    if (newUserId !== undefined) { updates.push("user_id = ?"); params.push(newUserId); }
    if (newDisplayName !== undefined) { updates.push("display_name = ?"); params.push(newDisplayName); }
    if (newPrompt !== undefined) { updates.push("prompt = ?"); params.push(newPrompt); }
    if (updates.length === 0) return Promise.resolve();
    const sql = `UPDATE special_users SET ${updates.join(', ')} WHERE user_id = ?`;
    params.push(originalUserId);
    return dbQuery(sql, params);
};

export const getDailyConversation = async (chatId, userId) => {
    const rows = await dbQuery("SELECT history_json FROM daily_conversations WHERE chat_id = ? AND user_id = ?", [chatId, userId]);
    return rows.length > 0 ? rows[0].history_json : []; 
};

export const saveDailyConversation = (chatId, userId, history) => {
    const historyJson = JSON.stringify(history);
    return dbQuery(
        `INSERT INTO daily_conversations (chat_id, user_id, history_json) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE history_json = ?`,
        [chatId, userId, historyJson, historyJson]
    );
};

export const getAllDailyConversations = () => {
    return dbQuery("SELECT * FROM daily_conversations");
};

export const clearDailyConversations = () => {
    return dbQuery("DELETE FROM daily_conversations");
};

export const getUserMemory = async (userId) => {
    const rows = await dbQuery("SELECT summary FROM user_memories WHERE user_id = ?", [userId]);
    return rows.length > 0 ? rows[0] : null;
};

export const updateUserMemory = async (userId, newSummary) => {
    const existingMemory = await getUserMemory(userId);
    const updatedSummary = existingMemory && existingMemory.summary
        ? `${existingMemory.summary}\n${newSummary}`
        : newSummary;

    return dbQuery(
        `INSERT INTO user_memories (user_id, summary) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE summary = ?`,
        [userId, updatedSummary, updatedSummary]
    );
};

export const logUserMessage = (userId, chatId) => {
    const today = new Date().toISOString().split('T')[0];
    return dbQuery(
        `INSERT INTO user_message_stats (user_id, chat_id, message_date, message_count) 
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE message_count = message_count + 1`,
        [userId, chatId, today]
    );
};

export const getUserMessageCount = async (userId, period = 'day') => {
    let dateFilter = '';
    
    if (period === 'day') {
        dateFilter = `AND message_date = CURDATE()`;
    } else if (period === 'week') {
        dateFilter = `AND message_date >= (CURDATE() - INTERVAL 7 DAY)`;
    } else if (period === 'month') {
        dateFilter = `AND message_date >= (CURDATE() - INTERVAL 30 DAY)`;
    } else {
        dateFilter = ``;
    }

    const rows = await dbQuery(
        `SELECT COALESCE(SUM(message_count), 0) as total 
         FROM user_message_stats WHERE user_id = ? ${dateFilter}`,
        [userId]
    );

    return rows[0].total;
};

export const getUserStats = async (period = 'all') => {
    let dateFilter = '';

    if (period === 'day') {
        dateFilter = `WHERE message_date = CURDATE()`;
    } else if (period === 'week') {
        dateFilter = `WHERE message_date >= (CURDATE() - INTERVAL 7 DAY)`;
    } else if (period === 'month') {
        dateFilter = `WHERE message_date >= (CURDATE() - INTERVAL 30 DAY)`;
    }

    const rows = await dbQuery(
        `SELECT COUNT(DISTINCT user_id) as unique_users, 
                COALESCE(SUM(message_count), 0) as total_messages 
         FROM user_message_stats ${dateFilter}`
    );
    return rows.length > 0 ? rows[0] : { unique_users: 0, total_messages: 0 };
};

export const getAllUserIds = () => {
    return dbQuery(`SELECT DISTINCT user_id FROM user_message_stats`);
};

export const setUserState = (userId, state, data = {}) => {
    return dbQuery(
        `INSERT INTO user_state (user_id, state, data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state = ?, data = ?`,
        [userId, state, JSON.stringify(data), state, JSON.stringify(data)]
    );
};

export const getUserState = async (userId) => {
    const rows = await dbQuery("SELECT state, data FROM user_state WHERE user_id = ?", [userId]);
    if (rows.length === 0) return null;
    return { state: rows[0].state, data: rows[0].data || {} };
};

export const clearUserState = (userId) => {
    return dbQuery("DELETE FROM user_state WHERE user_id = ?", [userId]);
};

export const clearAllUserStates = () => {
    return dbQuery("DELETE FROM user_state");
};

export const setOwnerState = (ownerId, state, data = {}) => {
    return dbQuery(
        `INSERT INTO owner_state (owner_id, state, data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state = ?, data = ?`,
        [ownerId, state, JSON.stringify(data), state, JSON.stringify(data)]
    );
};

export const getOwnerState = async (ownerId) => {
    const rows = await dbQuery("SELECT state, data FROM owner_state WHERE owner_id = ?", [ownerId]);
    if (rows.length === 0) return { state: null, data: {} };
    
    let dataObject = rows[0].data;
    if (typeof dataObject === 'string') {
        try {
            dataObject = JSON.parse(dataObject);
        } catch (e) {
            dataObject = {};
        }
    }
    return { state: rows[0].state, data: dataObject || {} };
};

export const clearOwnerState = (ownerId) => {
    return dbQuery(
        "DELETE FROM owner_state WHERE owner_id = ?",
        [ownerId]
    );
};

export const canRequestAPI = async (userId) => {
    const cooldownHours = 4;
    const rows = await dbQuery(
        `SELECT last_request FROM api_request_cooldown WHERE user_id = ?`,
        [userId]
    );

    if (rows.length === 0) return true;

    const lastRequest = new Date(rows[0].last_request);
    const now = new Date();
    const diffHours = (now - lastRequest) / (1000 * 60 * 60);

    return diffHours >= cooldownHours;
};

export const updateAPIRequestTime = (userId) => {
    return dbQuery(
        `INSERT INTO api_request_cooldown (user_id, last_request) 
         VALUES (?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE last_request = CURRENT_TIMESTAMP`,
        [userId]
    );
};

export const getAPIRequestCooldown = async (userId) => {
    const rows = await dbQuery(
        `SELECT last_request FROM api_request_cooldown WHERE user_id = ?`,
        [userId]
    );

    if (rows.length === 0) return null;

    const lastRequest = new Date(rows[0].last_request);
    const now = new Date();
    const remainingMs = (4 * 60 * 60 * 1000) - (now - lastRequest);

    if (remainingMs <= 0) return null;

    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    return { hours, minutes };
};