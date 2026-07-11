# Troubleshooting

Common issues and solutions for KeBaiPay development.

## Database

### `Error: Invalid `prisma.$executeRaw()` invocation`
- **Cause**: SQLite database file missing or schema not synced.
- **Fix**: Run `npm run db:push` to create/sync the database.

### `Error: SQLite database is locked`
- **Cause**: Another process is using the database file.
- **Fix**: Stop other dev servers or use `PRAGMA journal_mode=WAL;` for concurrent access.

### `P1001: Can't reach database server`
- **Cause**: PostgreSQL not running (production config) or wrong `DATABASE_URL`.
- **Fix**: Ensure PostgreSQL is running and `DATABASE_URL` in `.env` is correct.

## Authentication

### `401 Unauthorized` on API calls
- **Cause**: JWT token expired or missing.
- **Fix**: Log in again. Check that `Authorization: Bearer <token>` header is sent.

### `jwt malformed` error
- **Cause**: Token corrupted in localStorage.
- **Fix**: Clear `kebaipay_token` from localStorage and log in again.

## Redis

### `ECONNREFUSED 127.0.0.1:6379`
- **Cause**: Redis not running locally.
- **Fix**: Start Redis (`redis-server`) or set `REDIS_URL` to a remote instance.

## Payments

### `idempotency_key` conflict error
- **Cause**: Duplicate payment attempt with the same key.
- **Fix**: Generate a unique `idempotencyKey` per transaction. Check client-side retry logic.

### Payment channel returns empty `payUrl`
- **Cause**: Channel misconfigured or credentials invalid.
- **Fix**: Verify `PaymentChannelConfig` entries in the database and channel credentials.

## Build & Start

### `Cannot find module './xxx'`
- **Fix**: Run `npm install` to reinstall dependencies.

### `EADDRINUSE: address already in use :::3000`
- **Fix**: Kill the existing process: `npx kill-port 3000` or change `PORT` in `.env`.

### `Schema validation error` on `npm run db:push`
- **Fix**: Ensure `prisma/schema.prisma` matches your datasource provider. Use `sqlite` for dev, `postgresql` for prod.

## CORS Errors

### `Access-Control-Allow-Origin` missing
- **Fix**: Add your frontend URL to `CORS_ORIGINS` in `.env` (comma-separated).
