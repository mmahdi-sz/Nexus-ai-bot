import { initializeConnector, getPool } from './database/connector.js';
import { dbQuery, dbTransaction } from './database/repository.js';
import { runMigrations } from './database/migrations.js';

import * as ChatRepo from './database/tables/chat.js';
import * as ConfigRepo from './database/tables/config.js';
import * as KeyRepo from './database/tables/keys.js';
import * as UserRepo from './database/tables/user.js';
import * as TextRepo from './database/tables/texts.js';

let appCache = {
    authorizedChats: new Set(),
    globalSettings: {}
};

export function getAppCache() {
    return appCache;
}

export function setAppCache(newCache) {
    appCache = newCache;
}

export async function initDb() {
    console.log('[database:initDb] START - Initializing database connector and running migrations.');
    await initializeConnector();
    await runMigrations();
    console.log('[database:initDb] END - Database ready.');
}

export async function getDatabaseHealth() {
    console.log('[database:getDatabaseHealth] START - Checking database health.');
    try {
        const pool = getPool();
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('[database:getDatabaseHealth] END - Health check successful.');
        return true;
    } catch (error) {
        console.error('[database:getDatabaseHealth] Database connection is unhealthy:', error.message);
        console.log('[database:getDatabaseHealth] END - Health check failed.');
        return false;
    }
}

export const purgeChatData = async (chatId) => {
    console.log(`[database:purgeChatData] START - Initiating data purge for Chat ID: ${chatId}`);
    
    const ALLOWED_TABLES_TO_CLEAN = [
        'chats',
        'group_stats',
        'daily_conversations',
        'special_chats',
        'user_message_stats',
        'request_logs'
    ];

    try {
        await dbTransaction(async (connection) => {
            let totalChanges = 0;
            for (const tableName of ALLOWED_TABLES_TO_CLEAN) {
                if (!/^[a-z_]{3,30}$/.test(tableName)) {
                    console.error(`[database:purgeChatData] CRITICAL: Invalid or disallowed table name detected in whitelist: ${tableName}`);
                    continue; 
                }
                
                const [result] = await connection.execute(`DELETE FROM ${connection.escapeId(tableName)} WHERE chat_id = ?`, [chatId]);
                if (result.affectedRows > 0) {
                    console.log(`[database:purgeChatData] Deleted ${result.affectedRows} rows from ${tableName}.`);
                    totalChanges += result.affectedRows;
                }
            }
            
            console.log(`[database:purgeChatData] Purge successful. Total rows deleted: ${totalChanges}.`);
        });
        
        if (appCache.authorizedChats.has(chatId)) {
            appCache.authorizedChats.delete(chatId);
            console.log(`[database:purgeChatData] Cache invalidated for Chat ID: ${chatId}`);
        }

        console.log(`[database:purgeChatData] END - Data purged for Chat ID: ${chatId}.`);
    } catch (error) {
        console.error(`[database:purgeChatData] CRITICAL ERROR - Failed to purge data for Chat ID: ${chatId}`, error);
        throw new Error(`Database purge operation failed for chat ${chatId}: ${error.message}`);
    }
};

export { dbQuery, dbTransaction };

export const { addChat, deactivateChat, isChatAuthorized, updateGroupStats, getAllGroupStats, getGroupDetailsList, addSpecialChat, removeSpecialChat, isSpecialChat, getAllSpecialChats } = ChatRepo;

export const { setSetting, getSetting, toggleGlobalButton, isGlobalButtonEnabled, addTutorialMedia, getAllTutorialMedia, clearTutorialMedia, setTutorialTextForApi, getTutorialTextForApi } = ConfigRepo;

export const { getText, setText, getAllTexts, getTextsByCategory } = TextRepo;

export const { addApiKey, getApiKeyByHash, getAllApiKeys, deleteApiKeyById, deactivateApiKey, isUserPremium, countDonatedKeys, getApiKeyOwner, getKeyUsage, incrementKeyUsage, resetAllKeyUsage, setKeyCooldown, logRequest, getStatsLast24h, logKeyError, countRecentKeyErrors } = KeyRepo;

export const { addSpecialUser, getSpecialUser, getAllSpecialUsers, deleteSpecialUser, updateSpecialUser, getDailyConversation, saveDailyConversation, getAllDailyConversations, clearDailyConversations, getUserMemory, updateUserMemory, logUserMessage, getUserMessageCount, getUserStats, setUserState, getUserState, clearUserState, clearAllUserStates, setOwnerState, getOwnerState, clearOwnerState, canRequestAPI, updateAPIRequestTime, getAPIRequestCooldown, getAllUserIds } = UserRepo;