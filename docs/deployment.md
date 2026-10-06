# Run and deploy

## Run locally

1. Apply `database/migrate-current.sql` to the existing `ebook_db`, or initialize a new database with `database/schema.sql` and `database/seed.sql`.
2. Export the database settings used by `app.js` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) and a strong `SESSION_SECRET` in the terminal.
3. Run `npm start` and open `http://localhost:3000`. `GET /health` should return `{"status":"ok"}` when MySQL is reachable.

## Render

- Build command: `npm install` (or `npm ci` when the lockfile is committed).
- Start command: `npm start`.
- In Aiven, copy the MySQL host, port, user, password, database name, and CA certificate from the service connection information.
- Set `NODE_ENV=production`, `SESSION_SECRET`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_SSL_CA` in the Render service environment. Put the CA certificate contents in `DB_SSL_CA`; the app uses it to verify the TLS connection. Do not commit credentials or certificates.
- Set health check path to `/health`.
- Use a MySQL service reachable from Render. A MySQL instance bound to a developer laptop's `localhost` is not reachable by the hosted service.
- The local `private/ebooks` directory is not durable on typical ephemeral web-service filesystems. Configure persistent storage for uploads or use course-authorized external HTTPS URLs. Do not place E-Books in `public/uploads`.
- Email is optional; set `EMAIL_USER` and `EMAIL_PASS` only when SMTP is configured.
