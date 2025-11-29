
import crypto from 'crypto';
import 'dotenv/config';

// --- Configuration ---
// Make sure to set a strong, 32-character key in your .env file.
// You can generate one using: node -e "console.log(crypto.randomBytes(32).toString('hex'));"
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    console.error('FATAL ERROR: ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in your .env file.');
    process.exit(1);
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM, the IV is typically 12 or 16 bytes. 16 is common.
const AUTH_TAG_LENGTH = 16;
const KEY = Buffer.from(ENCRYPTION_KEY, 'hex');

/**
 * Encrypts a piece of text using AES-256-GCM.
 * @param {string} text The text to encrypt.
 * @returns {string} The encrypted text, encoded as a hex string (iv:authTag:encryptedData).
 */
export function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    // Combine iv, authTag, and encrypted data into a single string for storage.
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a piece of text that was encrypted with the encrypt function.
 * @param {string} encryptedText The encrypted hex string (iv:authTag:encryptedData).
 * @returns {string} The original, decrypted text.
 */
export function decrypt(encryptedText) {
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted text format.');
        }

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedData = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error("Decryption failed:", error.message);
        // Return null or throw an error to indicate failure.
        // Returning null is often safer to prevent crashes.
        return null; 
    }
}

/**
 * Computes the SHA-256 hash of a given text.
 * @param {string} text The text to hash.
 * @returns {string} The SHA-256 hash as a hex string.
 */
export function hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Creates a display name for an API key (e.g., "sk-...a1b2").
 * @param {string} apiKey The full API key.
 * @returns {string} A shortened, safe-to-display name.
 */
export function createDisplayName(apiKey) {
    if (typeof apiKey !== 'string' || apiKey.length < 8) {
        return 'Invalid Key';
    }
    const start = apiKey.substring(0, 4);
    const end = apiKey.substring(apiKey.length - 4);
    return `${start}...${end}`;
}


