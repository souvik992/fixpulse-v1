'use strict';
/**
 * PM2 Ecosystem — Enterprise cluster config
 *
 * Prerequisites before enabling cluster mode:
 *   1. Set REDIS_URL — presence store and cache MUST use Redis when
 *      running multiple instances (otherwise each process has its own
 *      in-memory state and presence/cache are inconsistent).
 *   2. npm install -g pm2
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   # zero-downtime reload
 *   pm2 save && pm2 startup                           # survive reboots
 */

module.exports = {
  apps: [
    {
      name:        'bugtracker',
      script:      'server.js',

      // ── Cluster mode: one worker per logical CPU core ──────────────
      instances:   'max',
      exec_mode:   'cluster',

      // ── Auto-restart on crash ──────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,

      // ── Memory guard: restart if a worker leaks past 512 MB ────────
      max_memory_restart: '512M',

      // ── Graceful shutdown: wait up to 15s for in-flight requests ───
      kill_timeout:    15000,
      listen_timeout:  10000,
      shutdown_with_message: false,

      // ── Log rotation ───────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:      true,
      error_file:      'logs/pm2-error.log',
      out_file:        'logs/pm2-out.log',

      // ── Environment ────────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT:     3000,
      },
      env_production: {
        NODE_ENV:   'production',
        PORT:       3000,
        // Add these in your actual .env — never commit secrets here:
        // JWT_SECRET: '...',
        // DATABASE_URL: '...',
        // REDIS_URL: '...',
        // CORS_ORIGIN: 'https://bugs.palletnow.co',
        // APP_URL: 'https://bugs.palletnow.co',
      },
    },
  ],
};
