'use strict';

let client  = null;
let ready   = false;

async function connect() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('ℹ️  REDIS_URL not set — presence/cache using in-process fallback');
    return;
  }

  let IORedis;
  try { IORedis = require('ioredis'); } catch {
    console.warn('⚠️  ioredis not installed. Run: npm install ioredis');
    return;
  }

  try {
    const redis = new IORedis(url, {
      maxRetriesPerRequest:  1,
      enableOfflineQueue:    false,
      connectTimeout:        5_000,
      lazyConnect:           true,
    });

    await redis.connect();
    await redis.ping();

    client = redis;
    ready  = true;
    console.log('✅ Redis connected');

    client.on('error',   (err) => console.error('[redis]', err.message));
    client.on('close',   ()    => { ready = false; });
    client.on('ready',   ()    => { ready = true;  });

  } catch (err) {
    console.warn('⚠️  Redis unavailable — in-process fallback active:', err.message);
    client = null;
    ready  = false;
  }
}

function isReady()   { return ready && client !== null; }
function getClient() { return client; }

module.exports = { connect, isReady, getClient };
