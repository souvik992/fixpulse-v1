'use strict';

const redis = require('../db/redis');

const PRESENCE_TTL_S      = 60;       // Redis key TTL (seconds)
const PRESENCE_TIMEOUT_MS = 45_000;   // Heartbeat window (ms)

// ── In-memory fallback ────────────────────────────────────────────────────────
// Used when Redis is not configured or unavailable.
const memStore = new Map(); // Map<orgId, Map<userId, { lastSeen, user }>>

function _memMark(orgId, userId, userData) {
  if (!memStore.has(orgId)) memStore.set(orgId, new Map());
  memStore.get(orgId).set(String(userId), { lastSeen: Date.now(), user: userData });
}

function _memRemove(orgId, userId) {
  memStore.get(orgId)?.delete(String(userId));
}

function _memGetOnline(orgId) {
  const org    = memStore.get(orgId);
  if (!org) return [];
  const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
  const online = [];
  for (const [uid, entry] of org.entries()) {
    if (entry.lastSeen >= cutoff) online.push(entry.user);
    else org.delete(uid);
  }
  return online;
}

// ── Redis-backed presence ─────────────────────────────────────────────────────
// Sorted Set  : presence:{orgId}              — score = timestamp(ms), member = userId
// String keys : presence_data:{orgId}:{userId} — JSON, TTL = PRESENCE_TTL_S

async function markPresence(orgId, userId, userData) {
  if (!redis.isReady()) { _memMark(orgId, userId, userData); return; }
  try {
    const r  = redis.getClient();
    const pl = r.pipeline();
    pl.zadd(`presence:${orgId}`, Date.now(), String(userId));
    pl.setex(`presence_data:${orgId}:${userId}`, PRESENCE_TTL_S, JSON.stringify(userData));
    await pl.exec();
  } catch (err) {
    console.error('[presence] mark error:', err.message);
    _memMark(orgId, userId, userData); // degrade gracefully
  }
}

async function removePresence(orgId, userId) {
  if (!redis.isReady()) { _memRemove(orgId, userId); return; }
  try {
    const r  = redis.getClient();
    const pl = r.pipeline();
    pl.zrem(`presence:${orgId}`, String(userId));
    pl.del(`presence_data:${orgId}:${userId}`);
    await pl.exec();
  } catch (err) {
    console.error('[presence] remove error:', err.message);
    _memRemove(orgId, userId);
  }
}

async function getOnlineUsers(orgId) {
  if (!redis.isReady()) return _memGetOnline(orgId);
  try {
    const r      = redis.getClient();
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;

    const pl = r.pipeline();
    pl.zremrangebyscore(`presence:${orgId}`, 0, cutoff);       // prune stale
    pl.zrangebyscore(`presence:${orgId}`, cutoff, '+inf');      // get fresh
    const results = await pl.exec();

    const userIds = results[1][1]; // [err, value] pairs
    if (!userIds || userIds.length === 0) return [];

    const dataKeys  = userIds.map(uid => `presence_data:${orgId}:${uid}`);
    const dataValues = await r.mget(...dataKeys);

    return dataValues.map(v => (v ? JSON.parse(v) : null)).filter(Boolean);
  } catch (err) {
    console.error('[presence] getOnline error:', err.message);
    return _memGetOnline(orgId);
  }
}

module.exports = { markPresence, removePresence, getOnlineUsers };
