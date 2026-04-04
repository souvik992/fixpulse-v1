const { Pool } = require('pg');

let pool   = null;
let connected = false;

async function connect() {
  // Neon / hosted: single DATABASE_URL takes priority
  const base = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME     || 'bugtracker',
        user:     process.env.DB_USER     || 'bugtracker',
        password: process.env.DB_PASSWORD || 'bugtracker_secret',
      };

  const config = {
    ...base,
    max: 20,                       // max concurrent connections
    idleTimeoutMillis: 30_000,     // release idle connections after 30s
    connectionTimeoutMillis: 5_000,// fail fast if pool exhausted
  };

  pool = new Pool(config);
  pool.on('error', (err) => {
    console.error('[db] Idle client error:', err.message);
  });

  try {
    await pool.query('SELECT 1');
    connected = true;
    console.log('✅ PostgreSQL connected');
  } catch (err) {
    await pool.end().catch(() => {});
    pool = null;
    connected = false;
    console.warn('⚠️  PostgreSQL unavailable – using JSON fallback:', err.message);
  }
}

function isConnected() { return connected; }

function query(...args) {
  if (!pool) throw new Error('Database not connected');
  return pool.query(...args);
}

module.exports = { connect, isConnected, query };
