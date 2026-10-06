# Database setup

The app uses MySQL. For a clean installation, run these commands against a fresh local MySQL server:

```sh
mysql -u root -p < database/schema.sql
mysql -u root -p ebook_db < database/seed.sql
```

Then configure the application environment before starting it:

```sh
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=root
export DB_PASSWORD='your-local-mysql-password'
export DB_NAME=ebook_db
export SESSION_SECRET="$(openssl rand -hex 32)"
node app.js
```

Seed demo accounts use password `Demo1234!`:

- Admin: `admin`
- Customers: `customer1` through `customer4`

Seeded E-Book URLs use the reserved `example.test` domain. Replace them with course-authorized sample files/URLs before demonstrating downloads.

For a database created by the earlier app version, back it up and run `migrate-current.sql` once instead of rerunning the schema. The migration is intentionally one-time. Move any previously uploaded E-Book files from `public/uploads` into `private/ebooks` and update their stored paths; cover images can remain in `public/uploads`.

For an existing database, set the same DB environment variables and run `npm run seed:orders`. The script checks the current order count and only inserts enough synthetic orders to reach 30; it requires at least one customer and one active book. It creates pending, approved, and cancelled examples across multiple dates.

Set `EMAIL_USER` and `EMAIL_PASS` only when email delivery is configured. Without them, order approval and in-app downloads still work, but email is skipped. Do not commit real credentials.
