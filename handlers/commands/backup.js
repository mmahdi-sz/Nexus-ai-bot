import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { sendMessageSafe, editMessageSafe } from '../../utils/textFormatter.js';

const execAsync = promisify(exec);

const MAX_TELEGRAM_FILE_SIZE = 50 * 1024 * 1024;
const BACKUP_DIR = './backups';

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function ensureBackupDir() {
    console.log('[backup:ensureBackupDir] Checking backup directory.');
    try {
        await fs.access(BACKUP_DIR);
    } catch {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        console.log('[backup:ensureBackupDir] Created backup directory');
    }
}

async function getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
}

async function createDatabaseBackup() {
    console.log('[backup:createDatabaseBackup] START - Creating SQL dump.');
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `arthur_backup_${timestamp}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || 3306;
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME;
    
    if (!dbUser || !dbPassword || !dbName) {
        throw new Error('Database credentials not found in environment variables (DB_USER, DB_PASSWORD, DB_NAME)');
    }
    
    const dumpCommand = `mysqldump --skip-ssl -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbName} --single-transaction --quick --lock-tables=false > "${filepath}"`;
    
    try {
        await execAsync(dumpCommand, {
            env: { ...process.env, MYSQL_PWD: dbPassword }
        });
        
        const fileSize = await getFileSize(filepath);
        console.log(`[backup:createDatabaseBackup] SQL dump created (Size: ${formatFileSize(fileSize)}).`);
        return { filepath, fileSize, filename };
    } catch (error) {
        try {
            await fs.unlink(filepath);
        } catch {}
        
        const stderr = error.stderr || error.message;
        const enhancedError = new Error(`Backup failed. Error: ${stderr.trim()}`);
        enhancedError.originalError = error;
        throw enhancedError;
    }
}

async function compressBackup(sqlFilePath) {
    console.log('[backup:compressBackup] START - Compressing with gzip.');
    const gzipPath = `${sqlFilePath}.gz`;
    
    await execAsync(`gzip -c "${sqlFilePath}" > "${gzipPath}"`);
    
    const compressedSize = await getFileSize(gzipPath);
    
    await fs.unlink(sqlFilePath);
    
    console.log(`[backup:compressBackup] END - Compression successful (Size: ${formatFileSize(compressedSize)}).`);
    return { filepath: gzipPath, fileSize: compressedSize };
}

async function cleanOldBackups() {
    console.log('[backup:cleanOldBackups] START - Cleaning old backups.');
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        let deleteCount = 0;
        
        for (const file of files) {
            const filePath = path.join(BACKUP_DIR, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtimeMs > maxAge) {
                await fs.unlink(filePath);
                console.log(`[backup:cleanOldBackups] Deleted old backup: ${file}`);
                deleteCount++;
            }
        }
        console.log(`[backup:cleanOldBackups] END - Cleaned ${deleteCount} old files.`);
    } catch (error) {
        console.error('[backup:cleanOldBackups] Error cleaning old backups:', error.message);
    }
}

async function checkMysqldumpAvailability() {
    try {
        await execAsync('mysqldump --version');
        return true;
    } catch (error) {
        return false;
    }
}

export async function handleBackupCommand(bot, msg) {
    console.log(`[backup:handleBackupCommand] START (User: ${msg.from.id})`);
    const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
    
    if (msg.from.id !== BOT_OWNER_ID) {
        console.log('[backup:handleBackupCommand] END - Not owner, ignoring.');
        return;
    }

    const hasMysqldump = await checkMysqldumpAvailability();
    if (!hasMysqldump) {
        const errorText = 
            `❌ **mysqldump یافت نشد**\n\n` +
            `برای استفاده از این قابلیت، mysqldump باید روی سرور نصب باشد.\n\n` +
            `**نصب:**\n` +
            '`apt-get install mysql-client` (Ubuntu/Debian)\n' +
            '`yum install mysql` (CentOS/RHEL)';
        
        await sendMessageSafe(bot, msg.chat.id, errorText, { 
            reply_to_message_id: msg.message_id,
            parse_mode: 'Markdown'
        });
        console.log('[backup:handleBackupCommand] END - mysqldump not available.');
        return;
    }
    
    const statusMsg = await sendMessageSafe(bot, 
        msg.chat.id,
        '⏳ **در حال تهیه پشتیبان از دیتابیس...**\n\nلطفاً صبر کنید، این کار ممکن است چند دقیقه طول بکشد.',
        { reply_to_message_id: msg.message_id }
    );
    
    let backupFilepath = null;
    
    try {
        await editMessageSafe(bot, 
            msg.chat.id,
            statusMsg.message_id,
            '🔄 **مرحله ۱/۳:** دریافت داده‌ها از MariaDB...'
        );
        
        let backup = await createDatabaseBackup();
        backupFilepath = backup.filepath;
        
        await editMessageSafe(bot, 
            msg.chat.id,
            statusMsg.message_id,
            `🔄 **مرحله ۲/۳:** فشرده‌سازی فایل backup (${formatFileSize(backup.fileSize)})...`
        );
        
        backup = await compressBackup(backup.filepath);
        backupFilepath = backup.filepath;

        if (backup.fileSize > MAX_TELEGRAM_FILE_SIZE) {
            const errorText = 
                `❌ **خطا: حجم فایل زیاد است**\n\n` +
                `حجم فایل backup: ${formatFileSize(backup.fileSize)}\n` +
                `حداکثر مجاز تلگرام: ${formatFileSize(MAX_TELEGRAM_FILE_SIZE)}\n\n` +
                `لطفاً از mysqldump مستقیم استفاده کنید.`;
                
            await editMessageSafe(bot, 
                msg.chat.id,
                statusMsg.message_id,
                errorText
            );
            
            await fs.unlink(backupFilepath);
            backupFilepath = null;
            console.log('[backup:handleBackupCommand] END - Backup file too large.');
            return;
        }
        
        await editMessageSafe(bot, 
            msg.chat.id,
            statusMsg.message_id,
            `🔄 **مرحله ۳/۳:** ارسال فایل backup (${formatFileSize(backup.fileSize)})...`
        );
        
        const caption = 
            `✅ **Backup موفق**\n\n` +
            `📅 تاریخ: ${new Date().toLocaleString('fa-IR')}\n` +
            `📦 حجم: ${formatFileSize(backup.fileSize)}\n` +
            `💾 دیتابیس: ${process.env.DB_NAME || 'Unknown'}\n\n` +
            `برای بازیابی:\n` +
            '`gunzip < backup.sql.gz | mysql -u user -p dbname`';
        
        await bot.sendDocument(
            msg.chat.id,
            backup.filepath,
            {
                caption: caption,
                parse_mode: 'Markdown'
            }
        );
        
        await bot.deleteMessage(msg.chat.id, statusMsg.message_id).catch(() => {});
        
        console.log('[backup:handleBackupCommand] Backup sent successfully.');
        
    } catch (error) {
        console.error('❌ [backup:handleBackupCommand] CRITICAL ERROR:', error.originalError || error);
        
        const errorMessage = `❌ **خطا در تهیه پشتیبان**\n\n` +
            `*مشکل:* ${error.message || 'خطای ناشناخته'}\n\n` +
            `اطمینان حاصل کنید که mysqldump روی سرور نصب شده و دسترسی شبکه دارد.`;
        
        await editMessageSafe(bot, 
            msg.chat.id,
            statusMsg.message_id,
            errorMessage
        ).catch(() => {
            bot.sendMessage(msg.chat.id, errorMessage).catch(() => {});
        });
        
    } finally {
        if (backupFilepath) {
            try {
                await fs.unlink(backupFilepath);
                console.log(`[backup:handleBackupCommand] Temporary file deleted: ${backupFilepath}`);
            } catch (e) {
                console.error(`[backup:handleBackupCommand] Failed to delete temporary file ${backupFilepath}:`, e.message);
            }
        }
        await cleanOldBackups();
        console.log('[backup:handleBackupCommand] END - Final cleanup.');
    }
}