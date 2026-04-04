'use strict';

const redis = require('./redis');

async function get(key) {
  if (!redis.isReady()) return null;
  try {
    const val = await redis.getClient().get(key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.error('[cache] get error:', err.message);
    return null;
  }
}

async function set(key, value, ttlSeconds = 30) {
  if (!redis.isReady()) return;
  try {
    await redis.getClient().setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.error('[cache] set error:', err.message);
  }
}

async function del(...keys) {
  if (!redis.isReady() || keys.length === 0) return;
  try {
    await redis.getClient().del(...keys);
  } catch (err) {
    console.error('[cache] del error:', err.message);
  }
}

module.exports = { get, set, del };
