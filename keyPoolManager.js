import { GoogleGenAI } from "@google/genai";
import cron from 'node-cron';
import crypto from 'crypto';
import * as db from './database.js';
import { Mutex } from 'async-mutex'; 

let keyPool = [];
const activeLeases = new Map();
const leaseMutex = new Mutex(); 
const STALE_LEASE_THRESHOLD_MS = 2 * 60 * 1000;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function addApiKeyToPool(apiKey, id) {
    console.log(`[keyPoolManager:addApiKeyToPool] START (Key ID: ${id})`);
    if (keyPool.some(k => k.id === id)) {
        console.warn(`[keyPoolManager:addApiKeyToPool] Key with ID ${id} already in the pool. Skipping.`);
        return;
    }
    const newKeyObject = {
        id: id,
        apiKey: apiKey,
        instance: new GoogleGenAI({ apiKey })
    };
    keyPool.push(newKeyObject);
    console.log(`[keyPoolManager:addApiKeyToPool] END - Dynamically added new API key (ID: ${id}). Total keys: ${keyPool.length}`);
}

export function removeApiKeyFromPool(id) {
    console.log(`[keyPoolManager:removeApiKeyFromPool] START (Key ID: ${id})`);
    const keyIndex = keyPool.findIndex(k => k.id === id);
    if (keyIndex > -1) {
        keyPool.splice(keyIndex, 1);
        console.log(`[keyPoolManager:removeApiKeyFromPool] END - Dynamically removed API key (ID: ${id}). Total keys: ${keyPool.length}`);
    } else {
        console.log(`[keyPoolManager:removeApiKeyFromPool] END - Key ID ${id} not found in pool.`);
    }
}

export async function getAvailableKeyInstance(appConfig) {
    console.log('[keyPoolManager:getAvailableKeyInstance] START - Attempting to acquire key lease.');
    const release = await leaseMutex.acquire(); 
    
    try {
        if (!(await db.getDatabaseHealth())) {
            console.error("[keyPoolManager:getAvailableKeyInstance] Database is unhealthy. Cannot proceed.");
            return null;
        }

        const shuffledPool = shuffleArray([...keyPool]);
        const reqLimit = appConfig.keyDailyRequestLimit;
        const tokenLimit = appConfig.keyDailyTokenLimit;
        console.log(`[keyPoolManager:getAvailableKeyInstance] Pool size: ${keyPool.length}. Limits: ${reqLimit} reqs / ${tokenLimit} tokens.`);

        for (const key of shuffledPool) {
            const existingLease = activeLeases.get(key.id);
            if (existingLease) {
                const leaseAge = Date.now() - existingLease.timestamp;
                if (leaseAge > STALE_LEASE_THRESHOLD_MS) {
                    console.warn(`[keyPoolManager:getAvailableKeyInstance] Removing stale lease for key ID ${key.id} (Age: ${leaseAge}ms).`);
                    activeLeases.delete(key.id);
                } else {
                    console.log(`[keyPoolManager:getAvailableKeyInstance] Key ID ${key.id} is actively leased. Skipping.`);
                    continue;
                }
            }

            const usage = await db.getKeyUsage(key.id);
            const now = new Date();

            if (usage) {
                if (usage.cooldown_until && usage.cooldown_until > now) {
                    console.warn(`[keyPoolManager:getAvailableKeyInstance] Key ID ${key.id} is in cooldown. Skipping.`);
                    continue;
                }
                
                if (usage.request_count >= reqLimit || usage.token_count >= tokenLimit) {
                    console.warn(`[keyPoolManager:getAvailableKeyInstance] Key ID ${key.id} has reached its daily limit. Req: ${usage.request_count}/${reqLimit}, Tokens: ${usage.token_count}/${tokenLimit}. Applying cooldown.`);
                    const cooldownEnd = new Date(now.getTime() + 4 * 60 * 60 * 1000);
                    await db.setKeyCooldown(key.id, cooldownEnd); 
                    continue;
                }
            }

            const leaseId = crypto.randomUUID();
            const leasedKey = { ...key, leaseId };
            activeLeases.set(key.id, { leaseId, timestamp: Date.now() });

            console.log(`[keyPoolManager:getAvailableKeyInstance] END - Leased key ID ${key.id} with lease ${leaseId}.`);
            return leasedKey;
        }

        console.error("[keyPoolManager:getAvailableKeyInstance] END - No available API keys found in the pool.");
        return null;
    } catch (error) {
        console.error("[keyPoolManager:getAvailableKeyInstance] Error during key leasing process:", error);
        return null;
    } finally {
        release(); 
    }
}

export async function releaseKey(leasedKey) {
    console.log(`[keyPoolManager:releaseKey] START (Key ID: ${leasedKey?.id}, Lease ID: ${leasedKey?.leaseId})`);
    const release = await leaseMutex.acquire(); 
    try {
        if (leasedKey && leasedKey.id && leasedKey.leaseId) {
            const activeLease = activeLeases.get(leasedKey.id);
            if (activeLease && activeLease.leaseId === leasedKey.leaseId) {
                activeLeases.delete(leasedKey.id);
                console.log(`[keyPoolManager:releaseKey] END - Released key ID ${leasedKey.id} from lease ${leasedKey.leaseId}.`);
            } else {
                console.warn(`[keyPoolManager:releaseKey] WARNING: Key ID ${leasedKey.id} not found in active leases or lease ID mismatch.`);
            }
        } else {
            console.warn(`[keyPoolManager:releaseKey] WARNING: Invalid leasedKey object provided.`);
        }
    } finally {
        release();
    }
}

export function scheduleKeyUsageReset() {
    console.log('[keyPoolManager:scheduleKeyUsageReset] START - Scheduling daily reset job.');
    cron.schedule('0 0 * * *', async () => {
        console.log('[keyPoolManager:scheduleKeyUsageReset:cron] --- Running daily key usage reset job ---');
        try {
            await db.resetAllKeyUsage();
            console.log('[keyPoolManager:scheduleKeyUsageReset:cron] Successfully reset daily usage for all API keys.');
        } catch (error) {
            console.error('[keyPoolManager:scheduleKeyUsageReset:cron] An error occurred during the scheduled key usage reset:', error);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });
    console.log('[keyPoolManager:scheduleKeyUsageReset] END - Scheduled daily key usage reset to run at 00:00 UTC.');
}


export function resetKeyPool() {
    console.log(`[keyPoolManager:resetKeyPool] START - Clearing pool (Current size: ${keyPool.length}).`);
    keyPool = [];
    activeLeases.clear();
    console.log('[keyPoolManager:resetKeyPool] END - Pool and active leases cleared.');
}