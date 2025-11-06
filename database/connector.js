import mysql from 'mysql2/promise';

let pool;

export async function initializeConnector() {
    console.log('[db:connector:initializeConnector] START - Attempting to connect to MariaDB.');
    try {
        if (pool) return pool;

        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: 'utf8mb4'
        });
        
        const connection = await pool.getConnection();
        console.log("[db:connector:initializeConnector] MariaDB connector initialized successfully.");
        connection.release();
        console.log('[db:connector:initializeConnector] END - Connection successful.');
        return pool;
    } catch (error) {
        console.error("[db:connector:initializeConnector] Failed to connect to MariaDB. Check .env settings and server status:", error.message);
        console.log('[db:connector:initializeConnector] END - Connection failed.');
        throw error;
    }
}

export function getPool() {
    if (!pool) {
        throw new Error("Database pool is not initialized. Call initializeConnector first.");
    }
    return pool;
}