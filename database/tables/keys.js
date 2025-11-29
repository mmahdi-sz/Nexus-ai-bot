
import { dbQuery } from '../repository.js';

export const addApiKey = async (encryptedKey, keyHash, displayName, donatedByUserId = null) => {
    console.log(`[db:keys:addApiKey] Querying (Display Name: ${displayName}, User: ${donatedByUserId || 'Admin'})`);
    const result = await dbQuery(
        "INSERT INTO api_keys (encrypted_key, key_hash, display_name, donated_by_user_id) VALUES (?, ?, ?, ?)",
        [encryptedKey, keyHash, displayName, donatedByUserId]
    );
    return { lastID: result.insertId };
};

export const getApiKeyByHash = async (keyHash) => {
    console.log(`[db:keys:getApiKeyByHash] Querying (Hash: ${keyHash.substring(0, 10)}...)`);
    const rows = await dbQuery("SELECT * FROM api_keys WHERE key_hash = ?", [keyHash]);
    return rows.length > 0 ? rows[0] : null;
};

export const getAllApiKeys = () => {
    console.log(`[db:keys:getAllApiKeys] Querying all active keys.`);
    return dbQuery("SELECT id, encrypted_key, display_name FROM api_keys WHERE is_active = 1");
}

export const deleteApiKeyById = (id) => {
    console.log(`[db:keys:deleteApiKeyById] Querying DELETE (ID: ${id})`);
    return dbQuery("DELETE FROM api_keys WHERE id = ?", [id]);
};

export const deactivateApiKey = (keyId) => {
    console.log(`[db:keys:deactivateApiKey] Querying (ID: ${keyId})`);
    return dbQuery("UPDATE api_keys SET is_active = 0 WHERE id = ?", [keyId]);
};

export const isUserPremium = async (userId) => {
    console.log(`[db:keys:isUserPremium] Querying (User: ${userId})`);
    const rows = await dbQuery("SELECT 1 FROM api_keys WHERE donated_by_user_id = ? AND is_active = 1 LIMIT 1", [userId]);
    return rows.length > 0;
};

export const countDonatedKeys = async () => {
    console.log(`[db:keys:countDonatedKeys] Querying count.`);
    const rows = await dbQuery("SELECT COUNT(*) as count FROM api_keys WHERE donated_by_user_id IS NOT NULL");
    return rows.length > 0 ? rows[0].count : 0;
};

export const getApiKeyOwner = async (keyId) => {
    console.log(`[db:keys:getApiKeyOwner] Querying (Key ID: ${keyId})`);
    const rows = await dbQuery("SELECT donated_by_user_id FROM api_keys WHERE id = ?", [keyId]);
    return rows.length > 0 ? rows[0] : null;
};

export const getKeyUsage = async (keyId) => {
    console.log(`[db:keys:getKeyUsage] Querying (Key ID: ${keyId})`);
    const rows = await dbQuery("SELECT * FROM api_key_usage WHERE key_id = ?", [keyId]);
    return rows.length > 0 ? rows[0] : null;
};

export const incrementKeyUsage = (keyId, tokensUsed = 0) => {
    console.log(`[db:keys:incrementKeyUsage] Querying (Key ID: ${keyId}, Tokens: ${tokensUsed})`);
    return dbQuery(
        `INSERT INTO api_key_usage (key_id, request_count, token_count) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE request_count = request_count + 1, token_count = token_count + ?`,
        [keyId, tokensUsed, tokensUsed]
    );
};

export const resetAllKeyUsage = () => {
    console.log(`[db:keys:resetAllKeyUsage] Querying RESET all usage.`);
    return dbQuery("UPDATE api_key_usage SET request_count = 0, token_count = 0, last_reset = CURRENT_TIMESTAMP, cooldown_until = NULL");
};

export const setKeyCooldown = (keyId, cooldownUntil) => {
    console.log(`[db:keys:setKeyCooldown] Querying (Key ID: ${keyId}, Until: ${cooldownUntil.toISOString()})`);
    return dbQuery("UPDATE api_key_usage SET cooldown_until = ? WHERE key_id = ?", [cooldownUntil, keyId]);
};

export const logRequest = (userId, chatId, keyId, tokensUsed, isPremium) => {
    console.log(`[db:keys:logRequest] Querying (User: ${userId}, Key: ${keyId}, Tokens: ${tokensUsed})`);
    return dbQuery(
        "INSERT INTO request_logs (user_id, chat_id, key_id_used, tokens_used, is_premium_user) VALUES (?, ?, ?, ?, ?)",
        [userId, chatId, keyId, tokensUsed, isPremium ? 1 : 0]
    );
};

export const getStatsLast24h = async () => {
    console.log(`[db:keys:getStatsLast24h] Querying last 24h stats.`);
    const rows = await dbQuery(`
        SELECT 
            COUNT(*) as total_requests, 
            SUM(tokens_used) as total_tokens,
            COUNT(DISTINCT user_id) as unique_users
        FROM request_logs WHERE created_at > (NOW() - INTERVAL 1 DAY)
    `);
    return rows.length > 0 ? rows[0] : { total_requests: 0, total_tokens: 0, unique_users: 0 };
};

export const logKeyError = (keyId, errorType, errorMessage) => {
    console.log(`[db:keys:logKeyError] Querying (Key: ${keyId}, Type: ${errorType})`);
    return dbQuery("INSERT INTO key_errors (key_id, error_type, error_message) VALUES (?, ?, ?)", [keyId, errorType, errorMessage]);
};

export const countRecentKeyErrors = async (keyId, errorType, timeWindow = '1 hour') => {
    console.log(`[db:keys:countRecentKeyErrors] Querying (Key: ${keyId}, Type: ${errorType}, Window: ${timeWindow})`);
    const rows = await dbQuery(
        "SELECT COUNT(*) as count FROM key_errors WHERE key_id = ? AND error_type = ? AND occurred_at > (NOW() - INTERVAL ?)",
        [keyId, errorType, timeWindow.toUpperCase().replace(' ', '')]
    );
    return rows[0];
};


