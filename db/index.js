const { Pool } = require('pg');

let pool = null;

async function connect() {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'bugtracker',
    user: process.env.DB_USER || 'bugtracker',
    password: process.env.DB_PASSWORD || 'bugtracker_secret',
    connectionTimeoutMillis: 3000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected');
  } catch (error) {
    await pool.end().catch(() => {});
    pool = null;
    throw new Error(`PostgreSQL connection failed: ${error.message}`);
  }
}

function query(...args) {
  if (!pool) {
    throw new Error('Database is not connected');
  }

  return pool.query(...args);
}

module.exports = { connect, query };
