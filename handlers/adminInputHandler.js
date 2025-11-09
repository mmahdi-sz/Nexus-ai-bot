import * as db from '../database.js';
import { sendMessageSafe } from '../utils/textFormatter.js';
import { handleTextMessage } from '../adminPanel.js'; 

const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID || '0', 10);
const MAX_MEDIA_FILES = 8;
const MAX_FILE_SIZE_MB = 20;
const ALLOWED_FILE_TYPES = ['photo', 'video', 'document'];

function isArrayOfMediaObjects(data) {
    return Array.isArray(data) && data.every(item => typeof item === 'object' && item !== null);
}

export async function handleAdminInput(bot, msg, ownerState) {
    console.log(`[adminInputHandler:handleAdminInput] START (User: ${msg.from.id}, State: ${ownerState.state})`);
    const userId = msg.from.id;

    if (userId !== BOT_OWNER_ID) {
        console.log('[adminInputHandler:handleAdminInput] END - Not owner.');
        return false;
    }
    if (!ownerState || ownerState.state === null) {
        console.log('[adminInputHandler:handleAdminInput] END - No active owner state.');
        return false;
    }

    if (ownerState.state === 'tutorial_api_awaiting_media') {
        
        let currentData = ownerState.data;
        if (typeof currentData === 'string') {
             try { currentData = JSON.parse(currentData); } catch (e) { console.error("[adminInputHandler:handleAdminInput] Error parsing ownerState data:", e); return false; }
        }

        let fileId = null;
        let fileType = null;
        let fileSize = 0;
        const caption = msg.caption || '';
        

        if (msg.photo) {
            fileId = msg.photo[msg.photo.length - 1].file_id;
            fileType = 'photo';
            fileSize = msg.photo[msg.photo.length - 1].file_size || 0;
        } else if (msg.video) {
            fileId = msg.video.file_id;
            fileType = 'video';
            fileSize = msg.video.file_size || 0;
        } else if (msg.document) {
            fileId = msg.document.file_id;
            fileType = 'document';
            fileSize = msg.document.file_size || 0;
            
            const mimeType = msg.document.mime_type || '';
            const allowedMimes = ['image/', 'video/', 'application/pdf'];
            const isAllowedMime = allowedMimes.some(type => mimeType.startsWith(type));
            
            if (!isAllowedMime) {
                await sendMessageSafe(bot, userId, 
                    await db.getText('admin_invalid_file_type', 
                    '❌ فقط عکس، ویدیو و PDF مجاز است.'));
                console.log(`[adminInputHandler:handleAdminInput] END - Invalid MIME type: ${mimeType}.`);
                return true;
            }
        }

        if (fileId) {
            if (!isArrayOfMediaObjects(currentData.media)) {
                currentData.media = [];
            }
            
            if (!ALLOWED_FILE_TYPES.includes(fileType)) {
                await sendMessageSafe(bot, userId, 
                    await db.getText('admin_invalid_file_type', 
                    '❌ فقط عکس، ویدیو و فایل مجاز است.'));
                console.log(`[adminInputHandler:handleAdminInput] END - Invalid file type received: ${fileType}.`);
                return true;
            }
            
            if (fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
                 await sendMessageSafe(bot, userId, 
                    await db.getText('admin_file_too_large', 
                    `❌ حجم فایل نباید بیشتر از ${MAX_FILE_SIZE_MB}MB باشد.`));
                 console.log(`[adminInputHandler:handleAdminInput] END - File too large (${fileSize} bytes).`);
                 return true;
            }
            
            const isDuplicate = currentData.media.some(m => m.fileId === fileId);
            if (isDuplicate) {
                 await sendMessageSafe(bot, userId, '⚠️ این فایل قبلاً اضافه شده است.');
                 return true;
            }

            if (currentData.media.length >= MAX_MEDIA_FILES) {
                const limitText = await db.getText('admin_media_limit_reached', 
                    `❌ رفیق، حداکثر ${MAX_MEDIA_FILES} فایل برای راهنما مجاز است. لطفا با دکمه "اتمام آپلود" کار را تمام کنید.`);
                await sendMessageSafe(bot, userId, limitText);
                console.log(`[adminInputHandler:handleAdminInput] END - Media limit reached. (Count: ${currentData.media.length})`);
                return true;
            }
            
            const mediaObject = { fileId, fileType, caption };
            currentData.media.push(mediaObject);

            await db.setOwnerState(BOT_OWNER_ID, ownerState.state, currentData);

            const displayInfo = fileType === 'photo' ? 'عکس' : fileType === 'video' ? 'ویدیو' : 'فایل';
            await sendMessageSafe(bot, userId, `✅ ${displayInfo} دریافت شد. (${currentData.media.length} فایل تا کنون)`);
            console.log(`[adminInputHandler:handleAdminInput] END - Media received (Type: ${fileType}, New Count: ${currentData.media.length}).`);
            return true;
        }
        
        if (msg.text) {
             bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
             console.log(`[adminInputHandler:handleAdminInput] Delegating text input to handleTextMessage...`);
             return handleTextMessage(bot, msg, ownerState);
        }
        
        if (msg.message_id) {
             bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
             await sendMessageSafe(bot, userId, '⚠️ لطفا فقط عکس، ویدیو، فایل یا متن را ارسال کنید.');
             return true;
        }

        return false;
    }
    
    if (msg.text) {
        console.log(`[adminInputHandler:handleAdminInput] Delegating text input to handleTextMessage...`);
        return handleTextMessage(bot, msg, ownerState);
    }
    
    console.log('[adminInputHandler:handleAdminInput] END - Message type not handled.');
    return false;
}