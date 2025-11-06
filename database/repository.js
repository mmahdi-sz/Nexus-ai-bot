import { getPool } from './connector.js';

const DEFAULT_RETRIES = 3;

function prepareParams(params) {
    if (!Array.isArray(params)) return [];
    return params.map(p => {
        if (p === undefined) return null;
        if (typeof p === 'object' && p !== null && !(p instanceof Date)) {
            try {
                return JSON.stringify(p);
            } catch (e) {
                console.error('[db:repository:prepareParams] Failed to stringify object parameter:', e.message);
                return null;
            }
        }
        return p;
    });
}

export async function dbQuery(sql, params = [], retries = DEFAULT_RETRIES) {
    const pool = getPool();
    let connection = null;
    let lastError = null;
    const cleanParams = prepareParams(params);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[db:repository:dbQuery] Query Executing (Attempt: ${attempt}/${retries}, SQL: ${sql.substring(0, 50)}..., Params Count: ${cleanParams.length})`);
            
            connection = await pool.getConnection();
            
            const [results] = await connection.execute(sql, cleanParams);
            
            connection.release();
            return results;

        } catch (error) {
            lastError = error;
            console.error(`[db:repository:dbQuery] Database query failed (Attempt ${attempt}/${retries}). Error details:`, { 
                code: error.code, 
                sqlState: error.sqlState, 
                message: error.message 
            });

            if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR') {
                 console.error('[db:repository:dbQuery] Unrecoverable connection error. Stopping retries.');
                 throw lastError; 
            }
            
            if (attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); 
                console.warn(`[db:repository:dbQuery] Retrying in ${delay}ms with exponential backoff.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 throw new Error(`Database operation failed after ${retries} attempts: ${lastError.code || 'UNKNOWN_ERROR'}`);
            }

        } finally {
            if (connection) {
                try {
                    connection.release();
                } catch (releaseError) {
                    console.error('[db:repository:dbQuery] Failed to release connection in finally block:', releaseError.message);
                }
            }
        }
    }
}

export async function dbTransaction(callback) {
    const pool = getPool();
    let connection = null;
    console.log('[db:repository:dbTransaction] START - Initiating transaction.');
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        console.log('[db:repository:dbTransaction] Transaction started.');
        
        await callback(connection);
        
        await connection.commit();
        console.log('[db:repository:dbTransaction] END - Transaction committed successfully.');
    } catch (error) {
        if (connection) {
            await connection.rollback();
            console.error("[db:repository:dbTransaction] Transaction rolled back due to error. Error code:", error.code);
        }
        console.log('[db:repository:dbTransaction] END - Transaction failed and rolled back.');
        throw new Error("Transaction failed and was rolled back");
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch(e) {
                console.error('[db:repository:dbTransaction] Failed to release connection in finally block:', e.message);
            }
        }
    }
}