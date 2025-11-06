import { GoogleGenAI } from '@google/genai';
import * as db from '../database.js';

const MODEL_FALLBACK_CHAIN = [
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-2.5-flash", 
    "gemini-2.5-pro", 
    "gemini-pro",
];

const MAX_API_RETRIES = 2;
const TIMEOUT_MS = 30000;

export const safetySettings = [
    {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE",
    },
    {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE",
    },
    {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE",
    },
    {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE",
    },
];

export const groundingTool = { functionDeclarations: [{ name: "googleSearch", description: "Provides real-time information from Google Search." }] };


export function getTextFromResult(result) {
    if (!result) return null;

    if (result.text) {
        return typeof result.text === 'function' ? result.text() : result.text;
    }
    
    const response = result.response;
    if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            return candidate.content.parts.map(p => p.text).join('');
        }
    }
    return null;
}

export function getUsageMetadata(result) {
    if (!result || !result.response || !result.response.usageMetadata) return {};
    return result.response.usageMetadata;
}

export async function generateResponseWithFallback(keyInstance, generationParams, limitCheck) {
    console.log('[geminiApi:generateResponseWithFallback] START - Initiating content generation.');
    let lastError = null;
    
    const limitLog = limitCheck && !limitCheck.isPremium && limitCheck.usage 
        ? ` | Limits: Day ${limitCheck.usage.day.used}/${limitCheck.usage.day.limit}`
        : '';

    for (const modelName of MODEL_FALLBACK_CHAIN) {
        for (let retry = 0; retry <= MAX_API_RETRIES; retry++) {
            const abortController = new AbortController();
            let timeoutId = null;
            
            try {
                console.log(`[geminiApi:generateResponseWithFallback] Attempting with model: ${modelName} (Retry: ${retry}/${MAX_API_RETRIES})${limitLog}`);

                const cleanHistory = generationParams.historyForAPI.filter(msg => {
                    if (msg.role === 'user' && msg.parts && msg.parts[0]?.text?.includes('--- CORE IDENTITY ---')) {
                        return false;
                    }
                    if (!msg.role || !msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) {
                        return false;
                    }
                    if (typeof msg.parts[0].text !== 'string' || msg.parts[0].text.trim().length === 0) {
                        return false;
                    }
                    return true;
                });

                const contents = [
                    ...cleanHistory,
                    { role: "user", parts: [{ text: generationParams.prompt }] }
                ];
                
                console.log(`[geminiApi:generateResponseWithFallback] Cleaned history size: ${cleanHistory.length}.`);

                const requestConfig = {
                    model: modelName,
                    contents: contents,
                    config: {
                        systemInstruction: generationParams.systemInstruction || undefined,
                        temperature: generationParams.generationConfig?.temperature,
                        maxOutputTokens: generationParams.generationConfig?.maxOutputTokens,
                        safetySettings: safetySettings
                    }
                };
                
                if (generationParams.tools && Array.isArray(generationParams.tools)) {
                    requestConfig.config.tools = generationParams.tools;
                }
                
                const requestConfigWithSignal = { ...requestConfig, signal: abortController.signal };

                timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

                const result = await keyInstance.models.generateContent(requestConfigWithSignal);
                
                clearTimeout(timeoutId);
                timeoutId = null;
                
                const responseText = getTextFromResult(result);
                const responseMetadata = getUsageMetadata(result);

                if (responseText && responseText.trim().length > 0) {
                     console.log(`[geminiApi:generateResponseWithFallback] SUCCESS from ${modelName} (Tokens: ${responseMetadata.totalTokenCount})`);
                     console.log('[geminiApi:generateResponseWithFallback] END - Successful response.');
                     return { text: responseText, responseMetadata };
                }

                console.warn(`[geminiApi:generateResponseWithFallback] Model ${modelName} returned valid object but no text. Trying next...`);
                lastError = new Error("Model returned empty but valid response.");
                break; 

            } catch (error) {
                lastError = error;
                
                const errorMessage = error.message.toLowerCase();
                const isOverloaded = errorMessage.includes('503') || errorMessage.includes('429') || errorMessage.includes('server is busy');
                const isNetworkError = error.name === 'AbortError' || errorMessage.includes('fetch failed') || errorMessage.includes('timeout');
                const isBlocked = errorMessage.includes('blocked');

                if (isBlocked) {
                     console.warn(`[geminiApi:generateResponseWithFallback] Model ${modelName} blocked the prompt. Reason:`, error.message);
                     console.log('[geminiApi:generateResponseWithFallback] END - Content filtered.');
                     return { filtered: true, reason: 'Content safety block' };
                }

                if (isOverloaded) {
                    console.warn(`[geminiApi:generateResponseWithFallback] Model ${modelName} failed due to overload/429/503. Trying next model...`);
                    const overloadError = new Error("All models are overloaded.");
                    overloadError.type = 'OVERLOADED';
                    throw overloadError;
                }
                
                if (isNetworkError) {
                    if (retry < MAX_API_RETRIES) {
                        console.warn(`[geminiApi:generateResponseWithFallback] Model ${modelName} failed due to temporary network issue. Retrying in ${1000 * (retry + 1)}ms...`);
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
                        continue; 
                    }
                    console.warn(`[geminiApi:generateResponseWithFallback] Model ${modelName} failed network check after max retries. Trying next model...`);
                    break; 
                } else {
                    console.error(`[geminiApi:generateResponseWithFallback] An unrecoverable error occurred with model ${modelName}.`);
                    throw error;
                }
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
        }
    }

    console.error("[geminiApi:generateResponseWithFallback] All models in the fallback chain failed.");
    
    if (lastError && lastError.message.includes('blocked')) {
        console.log('[geminiApi:generateResponseWithFallback] END - Content filtered after all retries.');
        return { filtered: true, reason: 'Content safety block after retries' };
    }

    console.log('[geminiApi:generateResponseWithFallback] END - All models failed.');
    throw lastError || new Error("All models failed without a specific error.");
}