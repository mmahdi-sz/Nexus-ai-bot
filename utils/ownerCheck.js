
const BOT_OWNER_IDS_STR = process.env.BOT_OWNER_IDS || process.env.BOT_OWNER_ID || '0';
export const BOT_OWNER_IDS = BOT_OWNER_IDS_STR.split(',').map(id => parseInt(id.trim(), 10)).filter(id => id > 0);

export function isOwner(userId) {
    return BOT_OWNER_IDS.includes(parseInt(userId, 10));
}


