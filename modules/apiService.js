
import { GoogleGenAI } from '@google/genai';
import * as keyPoolManager from '../keyPoolManager.js';

const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

const groundingTool = { 
    functionDeclarations: [{ 
        name: "googleSearch", 
        description: "Provides real-time information from Google Search." 
    }] 
};

export class APIService {
    constructor(config = {}) {
        this.config = {
            modelFallbackChain: config.modelFallbackChain || [
                "gemini-flash-lite-latest",
                "gemini-2.5-flash-lite",
                "gemini-flash-latest",
                "gemini-2.5-flash",
                "gemini-2.5-pro",
            ],
            maxRetries: config.maxRetries || 2,
            timeout: config.timeout || 30000
        };
    }

    async generateResponse({ systemInstruction, history, prompt, tools = [groundingTool] }) {
        let keyObject = await keyPoolManager.getAvailableKeyInstance(this.config);
        
        if (!keyObject) {
            throw new Error('NO_AVAILABLE_KEY');
        }

        try {
            const contents = [
                ...history,
                { role: "user", parts: [{ text: prompt }] }
            ];

            for (const modelName of this.config.modelFallbackChain) {
                try {
                    const result = await keyObject.instance.models.generateContent({
                        model: modelName,
                        contents: contents,
                        config: {
                            systemInstruction: systemInstruction,
                            temperature: 1.0,
                            maxOutputTokens: 8192,
                            safetySettings: safetySettings,
                            tools: tools
                        }
                    });

                    const responseText = this.extractText(result);
                    const metadata = this.extractMetadata(result);

                    if (responseText && responseText.trim().length > 0) {
                        return { text: responseText, metadata };
                    }
                } catch (error) {
                    if (this.isBlockedError(error)) {
                        return { filtered: true, reason: 'Content safety block' };
                    }
                    
                    if (this.isOverloadedError(error)) {
                        continue;
                    }
                    
                    throw error;
                }
            }

            throw new Error('ALL_MODELS_FAILED');
        } finally {
            if (keyObject) {
                keyPoolManager.releaseKey(keyObject);
            }
        }
    }

    extractText(result) {
        if (!result) return null;
        if (result.text) {
            return typeof result.text === 'function' ? result.text() : result.text;
        }
        const response = result.response;
        if (response?.candidates?.[0]?.content?.parts) {
            return response.candidates[0].content.parts.map(p => p.text).join('');
        }
        return null;
    }

    extractMetadata(result) {
        return result?.response?.usageMetadata || {};
    }

    isBlockedError(error) {
        return error.message?.toLowerCase().includes('blocked');
    }

    isOverloadedError(error) {
        const msg = error.message?.toLowerCase() || '';
        return msg.includes('503') || msg.includes('429') || msg.includes('server is busy');
    }
}

export const apiService = new APIService();


