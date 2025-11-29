
import { GoogleGenAI } from '@google/genai';
import * as db from './database.js';
import * as security from './security.js';
import * as keyPoolManager from './keyPoolManager.js';
import { prompts } from './prompts.js';

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);

async function generateMemorySummary(userId, conversationHistory) {
    if (conversationHistory.length === 0) return null;

    const keyObject = await keyPoolManager.getAvailableKeyInstance();
    if (!keyObject) {
        console.warn(`[MemoryManager] No API key available to generate memory summary for user ${userId}. Skipping.`);
        return null;
    }
    
    let keyInstance = keyObject.instance;
    
    try {
        const conversationText = conversationHistory
            .map(msg => `${msg.role === 'user' ? 'User' : 'Arthur'}: ${msg.parts[0].text}`)
            .join('\n');

        const systemInstruction = prompts.getMemoryPrompt();
        
        const result = await keyInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ 
                role: "user", 
                parts: [{ text: `--- CONVERSATION LOG ---\n${conversationText}` }] 
            }],
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                maxOutputTokens: 1024
            }
        });

        const summary = result.text.trim();
        
        if (keyObject && keyObject.id) {
            await db.incrementKeyUsage(keyObject.id);
        }

        if (summary.toLowerCase().includes('i cannot fulfill this request') || summary.length < 20) {
            console.warn(`[MemoryManager] Generated summary for user ${userId} was too short or denied. Skipping save.`);
            return null;
        }

        return summary;

    } catch (error) {
        console.error(`[MemoryManager] Error generating summary for user ${userId}:`, error.message);
        return null;
    } finally {
        keyPoolManager.releaseKey(keyObject);
    }
}

export async function processAndSummarizeDailyLogs() {
    const allConversations = await db.getAllDailyConversations();
    const uniqueUsers = {};
    
    for (const conv of allConversations) {
        if (!uniqueUsers[conv.user_id]) {
            uniqueUsers[conv.user_id] = [];
        }
        const history = conv.history_json; 
        if (Array.isArray(history)) {
            const cleanedHistory = history.filter(h => 
                h.role !== 'system' && 
                !h.parts?.[0]?.text?.includes('--- CORE IDENTITY ---') &&
                !h.parts?.[0]?.text?.includes('Acknowledge the above rules')
            );
            uniqueUsers[conv.user_id].push(...cleanedHistory);
        }
    }
    
    let summariesProcessed = 0;
    
    for (const userId in uniqueUsers) {
        const history = uniqueUsers[userId];
        if (history.length > 5) {
            const newSummary = await generateMemorySummary(parseInt(userId, 10), history);
            
            if (newSummary) {
                await db.updateUserMemory(parseInt(userId, 10), newSummary);
                summariesProcessed++;
            }
        }
    }
    
    await db.clearDailyConversations();
    
    console.log(`[MemoryManager] Finished daily processing. Summaries generated: ${summariesProcessed}. Total conversations cleared: ${allConversations.length}.`);
    
    return { summariesProcessed, conversationsCleared: allConversations.length };
}

export default { processAndSummarizeDailyLogs };


