import { dbQuery, dbTransaction } from './repository.js';

const TABLE_CREATION_QUERIES = [
    `CREATE TABLE IF NOT EXISTS chats (
        chat_id BIGINT PRIMARY KEY, 
        is_enabled BOOLEAN DEFAULT 0, 
        enabled_by_user_id BIGINT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS owner_state (
        owner_id BIGINT PRIMARY KEY, 
        state VARCHAR(255), 
        data JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    
    `CREATE TABLE IF NOT EXISTS user_state (
        user_id BIGINT PRIMARY KEY,
        state VARCHAR(255),
        data JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS app_settings (
        key_name VARCHAR(255) PRIMARY KEY, 
        value_json JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS tutorial_texts (
        text_key VARCHAR(255) PRIMARY KEY,
        text_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS api_keys (
        id INT PRIMARY KEY AUTO_INCREMENT, 
        encrypted_key TEXT NOT NULL, 
        key_hash VARCHAR(255) NOT NULL UNIQUE, 
        display_name VARCHAR(255) NOT NULL, 
        is_active BOOLEAN DEFAULT 1, 
        donated_by_user_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS api_key_usage (
        key_id INT PRIMARY KEY,
        request_count INT DEFAULT 0,
        token_count INT DEFAULT 0,
        last_reset TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cooldown_until TIMESTAMP NULL,
        FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS key_errors (
        id INT PRIMARY KEY AUTO_INCREMENT,
        key_id INT,
        error_type VARCHAR(255) NOT NULL,
        error_message TEXT,
        occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS special_users (
        user_id BIGINT PRIMARY KEY,
        display_name VARCHAR(255) NOT NULL,
        prompt TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS daily_conversations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        chat_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        history_json JSON NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_conversation (chat_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS user_memories (
        user_id BIGINT PRIMARY KEY,
        summary TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS api_request_cooldown (
        user_id BIGINT PRIMARY KEY,
        last_request TIMESTAMP NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS request_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        key_id_used INT,
        tokens_used INT,
        is_premium_user BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    
    `CREATE TABLE IF NOT EXISTS user_message_stats (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        message_date DATE NOT NULL,
        message_count INT DEFAULT 1,
        UNIQUE KEY unique_stats (user_id, chat_id, message_date),
        INDEX idx_stats_date (message_date),
        INDEX idx_stats_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    
    `CREATE TABLE IF NOT EXISTS group_stats (
        chat_id BIGINT PRIMARY KEY,
        chat_title VARCHAR(255),
        member_count INT DEFAULT 0,
        is_enabled BOOLEAN DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS special_chats (
        chat_id BIGINT PRIMARY KEY,
        chat_title VARCHAR(255) NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    
    `CREATE TABLE IF NOT EXISTS api_tutorial_media (
        id INT PRIMARY KEY AUTO_INCREMENT,
        file_id VARCHAR(255) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        caption TEXT,
        sort_order INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS api_tutorial_text (
        id INT PRIMARY KEY CHECK (id = 1),
        tutorial_text TEXT NOT NULL,
        button_text VARCHAR(255) DEFAULT 'کمک به خرید فشنگ و دینامیت برای آرتور',
        button_url VARCHAR(2048),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
];


const ALTER_TABLE_QUERIES = [
    `ALTER TABLE api_key_usage ADD COLUMN token_count INT DEFAULT 0 AFTER request_count`
];

const DEFAULT_SETTINGS = [
    { table: 'app_settings', sql: `INSERT INTO app_settings (key_name, value_json) VALUES ('global_button_enabled', 'true') ON DUPLICATE KEY UPDATE key_name = key_name` },
];

const DEFAULT_TUTORIALS = [
    { key: 'start_message', value: 'من آرتورم، آرتور مورگان. کاری داشتی؟' },
    { key: 'group_welcome', value: 'درود بر شما! لطفا جهت فعال‌سازی بات دستور زیر را در گروه بزنید (این دستور یکبار قابل استفاده است):\n\n/enable' },
    { key: 'limit_message_day', value: 'رفیق، سهمیه امروزت تموم شده. فردا دوباره سر بزن.' },
    { key: 'limit_message_week', value: 'سهمیه این هفته به پایان رسیده. هفته بعد برمی‌گردم.' },
    { key: 'limit_message_month', value: 'این ماه به سقف پیام‌هات رسیدی. ماه بعد حرف می‌زنیم رفیق.' },
    { key: 'overload_error_message', value: 'هی رفیق مغزم ترکیده خیلی صحبت کردم ۱ ساعت دیگه تست کن' }
];

const ADDITIONAL_DEFAULT_TEXTS = [
    { key: 'enable_already_active', value: 'اینجا که قبلاً کمپ زده بودیم! آرتور آماده‌است.' },
    { key: 'enable_success', value: 'دار و دسته ما تو این منطقه کمپ زدن! آرتور آماده‌است.' },
    { key: 'enable_admin_required', value: 'هی رفیق! برای اینکه بتونم اینجا کار کنم، باید من رو ادمین گروه کنی.' },
    { key: 'enable_private_only', value: 'این دستور فقط در چت خصوصی کار می‌کنه رفیق.' },
    
    { key: 'donate_group_error', value: 'رفیق، برای اهدای کلید باید به چت خصوصی من بیای. اینجا فقط اسلحه می‌کشیم.' },
    { key: 'limit_button_text', value: '🤠 **راهنما و کمک به زندگی به آرتور** (بدون محدودیت)' },
    
    { key: 'bot_added_welcome_enabled', value: 'من آرتورم، آرتور مورگان. به نظر می‌رسه قبلاً اینجا بودم.\n\nمن آماده‌ام رفیق. کافیه منشنم کنی یا رو پیام‌هام ریپلای بزنی تا حرف بزنیم.' },
    { key: 'bot_added_welcome_new', value: 'من آرتورم، آرتور مورگان. می‌تونم کلی کمکتون کنم.\n\nبرای فعال کردن من:\n1️⃣ من رو ادمین گروه کنید\n2️⃣ دستور /enable رو بزنید\n\nبعدش می‌تونید با منشن کردن یا ریپلای باهام حرف بزنید.' },
    
    { key: 'help_admin', value: '**راهنمای مالک ربات**\n\n**/start** - ورود به پنل مدیریت کامل.\n**/stats** - نمایش سریع آمار کلی ربات.\n**/broadcast** - ارسال پیام همگانی (به تمام گروه‌های فعال).\n**/backup** - تهیه و ارسال فایل پشتیبان از دیتابیس.\n**/clearstates** - پاکسازی وضعیت تمام کاربران.\n**/help** - نمایش همین راهنما.' },
    { key: 'help_user', value: 'من آرتورم، آرتور مورگان.\n\nتو گروه‌ها، با ریپلای کردن روی پیام‌هام یا منشن کردنم (@{bot_username}) می‌تونی باهام حرف بزنی.\n\nاگه ادمین گروهی، با دستور /enable می‌تونی منو تو گروهت فعال کنی.' },
    
    { key: 'apikey_awaiting', value: 'عالیه رفیق. حالا کلید API خودت رو که از آموزش‌ها یاد گرفتی، برام بفرست.' },
    { key: 'apikey_checking', value: '⏳ دارم کلیدت رو چک می‌کنم...' },
    { key: 'apikey_duplicate', value: 'این کلید قبلاً توسط کاربر (ID: {user_id}) به سیستم اهدا شده است.' },
    { key: 'apikey_invalid', value: '⚠️ این کلید معتبر نیست رفیق. مطمئن شو درست کپیش کردی.' },
    { key: 'apikey_success', value: '✅ دمت گرم! کلیدت با موفقیت به استخر عمومی اهدا شد. به عنوان یک حامی، از این پس بدون محدودیت از من استفاده خواهی کرد.' },
    { key: 'apikey_invalid_chars', value: '⚠️ این کلید API شامل کاراکترهای نامعتبر فارسی یا غیرASCII است. مطمئن شوید فقط کاراکترهای انگلیسی و اعداد را کپی کرده‌اید.' },
    { key: 'apikey_group_warning', value: 'رفیق، برای این کار باید بری چت خصوصی من. لطفاً کلید API رو اینجا نفرست.' },
    { key: 'apikey_cancel', value: 'باشه رفیق، لغوش کردم.' },
    { key: 'apikey_text_only', value: 'لطفا فقط کلید API رو بفرست. اگه پشیمون شدی /cancel رو بزن.' },
    
    { key: 'chat_cooldown', value: 'صبر کن رفیق! دارم به سوال قبلی خودت فکر می‌کنم. یکی یکی!' },
    { key: 'api_guide_cooldown', value: '⏱️ رفیق، باید {hours} ساعت و {minutes} دقیقه دیگه صبر کنی تا بتونی دوباره راهنما رو ببینی.' },
    
    { key: 'error_general', value: 'لعنتی! انگار چندتا از افراد پینکرتون سرور رو به آتیش کشیدن!' },
    { key: 'error_network', value: 'برادر آرتور خسته شده وقت لالا هست.' },
    { key: 'error_thinking', value: 'آرتور داره فکر می‌کنه...' },
    { key: 'error_state_reset', value: '⚠️ وضعیت مدیریت شما بازنشانی شد. لطفاً دوباره /start را بزنید.' },
    { key: 'error_callback', value: 'یه مشکلی پیش اومد، دوباره تلاش کن.' },
    
    { key: 'tutorial_no_guide', value: 'راهنمایی هنوز تنظیم نشده رفیق، ولی اگه کلید API داری می‌تونی همین الان اهداش کنی.' },
    
    { key: 'admin_cancel', value: 'عملیات لغو شد.' },
    { key: 'admin_error', value: '⚠️ یک خطای داخلی در پردازش پیام شما رخ داد. عملیات لغو شد.' },

    { key: 'command_new', value: 'باشه رفیق، دفتر خاطرات رو پاک کردم. از اول شروع می‌کنیم.' },
    { key: 'command_forget', value: 'همه چیزهایی که ازت یاد گرفتم رو فراموش کردم رفیق. مثل اولین روز.' },
    { key: 'command_status_no_premium', value: 'می‌خوای حامی بشی و بدون محدودیت حرف بزنیم؟\nدستور /donate رو بزن.' },
    { key: 'command_status_premium', value: '⭐ شما یک **حامی** هستید!\n🔓 محدودیت پیام برای شما نداریم رفیق! 🤠' },
    
    { key: 'guard_error_not_admin', value: '❌ برای این کار، آرتور رو باید ادمین گروه کنی!' },
    { key: 'guard_error_no_restrict_perm', value: '❌ آرتور مجوز "محدودسازی کاربران" رو نداره!' },
    { key: 'guard_error_admin_check_failed', value: '❌ یه مشکل توی چک کردن دسترسی‌های آرتور پیش اومد.' },
    { key: 'guard_error_no_target', value: '❌ یوزرنیم یا ریپلای به نفر مورد نظر رو فراموش کردی رفیق.' },
    { key: 'guard_error_target_is_safe', value: '❌ به نظر می‌رسه هدف ما از افراد خودی هست یا خودتی، رفیق.' },
    { key: 'guard_error_target_is_admin', value: '❌ این رفیق یه تفنگدار قدیمیه، نمی‌تونم لمسش کنم!' },
    { key: 'guard_error_mute_no_duration', value: '❌ برای سکوت، زمان رو مشخص کن (مثلاً: mute @user 1h)' },
    { key: 'guard_error_telegram_api', value: '❌ یه خطای تلگرامی پیش اومد. مطمئن شو که هدف در گروه هست.' },
    { key: 'guard_success_ban', value: '✅ بن شد. این مرد دیگه از دار و دسته ما نیست!' },
    { key: 'guard_success_temp_ban', value: '✅ بن موقت شد. بعد از مدتی آزاد می‌شه.' },
    { key: 'guard_success_kick', value: '✅ کیک شد. حالا می‌تونه بره دنبال زندگی جدید.' },
    { key: 'guard_success_mute', value: '✅ سکوت شد. بهتره فکر کنه قبل از حرف زدن.' },
    
    { key: 'private_chat_required_message', value: '**هی رفیق!** برای ادامه چت، لطفاً چت خصوصی آرتور رو استارت/آنبلاک کن.' },
    { key: 'private_chat_required_button_text', value: '✅ استارت/آنبلاک کردن چت خصوصی' },
];


export async function runMigrations() {
    for (const query of TABLE_CREATION_QUERIES) {
        await dbQuery(query);
    }

    try {
        await dbQuery(ALTER_TABLE_QUERIES[0]);
    } catch (alterError) {
        if (!alterError.message.includes('Duplicate column name')) {
             console.error("[db:migrations:runMigrations] Failed to alter api_key_usage table:", alterError.message);
        }
    }

    for (const setting of DEFAULT_SETTINGS) {
        await dbQuery(setting.sql);
    }

    for (const { key, value } of [...DEFAULT_TUTORIALS, ...ADDITIONAL_DEFAULT_TEXTS]) {
        await dbQuery(
            `INSERT IGNORE INTO tutorial_texts (text_key, text_value) VALUES (?, ?)`,
            [key, value]
        );
    }
}