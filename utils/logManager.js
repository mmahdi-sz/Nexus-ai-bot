
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import cron from 'node-cron';

const LOG_DIR = './logs';
const CURRENT_LOG_FILE = path.join(LOG_DIR, 'bot.log');

let logStream = null;

async function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

async function compressLog(sourceFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const compressedFile = path.join(LOG_DIR, `bot_${timestamp}.log.gz`);
    
    try {
        const source = fs.createReadStream(sourceFile);
        const destination = fs.createWriteStream(compressedFile);
        const gzip = createGzip();
        
        await pipeline(source, gzip, destination);
        
        fs.unlinkSync(sourceFile);
        
        console.log(`[LogManager] Compressed log to: ${compressedFile}`);
        return compressedFile;
    } catch (error) {
        console.error('[LogManager] Failed to compress log:', error.message);
        throw error;
    }
}

async function rotateLog() {
    if (logStream) {
        logStream.end();
        logStream = null;
    }
    
    if (fs.existsSync(CURRENT_LOG_FILE)) {
        await compressLog(CURRENT_LOG_FILE);
    }
    
    logStream = fs.createWriteStream(CURRENT_LOG_FILE, { flags: 'a' });
    
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = (...args) => {
        const message = args.join(' ');
        const logMessage = `[LOG] ${new Date().toISOString()} ${message}\n`;
        if (logStream) logStream.write(logMessage);
        originalLog(...args);
    };
    
    console.error = (...args) => {
        const message = args.join(' ');
        const logMessage = `[ERROR] ${new Date().toISOString()} ${message}\n`;
        if (logStream) logStream.write(logMessage);
        originalError(...args);
    };
    
    console.warn = (...args) => {
        const message = args.join(' ');
        const logMessage = `[WARN] ${new Date().toISOString()} ${message}\n`;
        if (logStream) logStream.write(logMessage);
        originalWarn(...args);
    };
    
    console.log('[LogManager] Log rotation complete.');
}

export async function initializeLogging() {
    await ensureLogDir();
    await rotateLog();
    
    cron.schedule('0 0 * * *', async () => {
        console.log('[LogManager] Daily log rotation triggered...');
        await rotateLog();
    }, {
        scheduled: true,
        timezone: "Asia/Tehran"
    });
    
    console.log('[LogManager] Logging system initialized.');
}

export async function cleanOldLogs(daysToKeep = 30) {
    if (!fs.existsSync(LOG_DIR)) return;
    
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000;
    
    for (const file of files) {
        if (file === 'bot.log') continue;
        
        const filePath = path.join(LOG_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`[LogManager] Deleted old log: ${file}`);
        }
    }
}


