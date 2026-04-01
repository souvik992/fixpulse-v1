const { Pool } = require('pg');

let pool = null;
let connected = false;

async function connect() {
  try {
    pool = new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'bugtracker',
      user:     process.env.DB_USER     || 'bugtracker',
      password: process.env.DB_PASSWORD || 'bugtracker_secret',
      connectionTimeoutMillis: 3000,
    });
    await pool.query('SELECT 1');
    connected = true;
    console.log('✅ PostgreSQL connected');
  } catch (e) {
    connected = false;
    pool = null;
    console.log('⚠️  PostgreSQL unavailable – using JSON file storage instead.');
    console.log('   (Start Docker and run: docker-compose up -d  to use PostgreSQL)');
  }
}

module.exports = { connect, isConnected: () => connected, query: (...args) => pool.query(...args) };
