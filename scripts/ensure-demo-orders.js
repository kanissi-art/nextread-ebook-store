const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ssl = process.env.DB_SSL_CA
    ? { ca: process.env.DB_SSL_CA }
    : (process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false });

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ebook_db',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 2,
    ssl
});

function mysqlDate(daysAgo) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
}

async function main() {
    const connection = await pool.getConnection();
    let created = 0;

    try {
        await connection.beginTransaction();
        const [[countRow]] = await connection.query('SELECT COUNT(*) AS count FROM orders');
        const needed = Math.max(0, 30 - Number(countRow.count));
        if (!needed) {
            await connection.commit();
            console.log('Database already has at least 30 orders; no rows added.');
            return;
        }

        const [users] = await connection.query(
            `SELECT u.id, u.email FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE r.role_name = 'user' ORDER BY u.id`
        );
        const [books] = await connection.query(
            'SELECT id, title, price, ebook_url FROM books WHERE is_active = 1 ORDER BY id'
        );
        if (!users.length || !books.length) {
            throw new Error('ต้องมีบัญชีลูกค้าและหนังสือที่เปิดขายก่อนเติมข้อมูล');
        }

        for (let index = 0; index < needed; index += 1) {
            const sequence = Number(countRow.count) + index + 1;
            const user = users[index % users.length];
            const firstBook = books[index % books.length];
            const secondBook = books.length > 1 ? books[(index + 1) % books.length] : null;
            const quantity = (index % 3) + 1;
            const hasSecondBook = Boolean(secondBook && index % 2 === 0);
            const lines = [{ book: firstBook, quantity }];
            if (hasSecondBook) lines.push({ book: secondBook, quantity: (index % 2) + 1 });
            const total = lines.reduce((sum, line) => sum + Number(line.book.price) * line.quantity, 0);
            const status = sequence % 5 === 0
                ? 'cancelled'
                : (sequence % 4 === 0 ? 'pending' : 'approved');
            const createdAt = mysqlDate((sequence % 26) * 7);

            const [orderResult] = await connection.query(
                'INSERT INTO orders (user_id, user_email, total_price, status, created_at) VALUES (?, ?, ?, ?, ?)',
                [user.id, user.email, total, status, createdAt]
            );
            const orderId = orderResult.insertId;
            await connection.query(
                'INSERT INTO payments (order_id, payment_method, amount, payment_date) VALUES (?, ?, ?, ?)',
                [orderId, ['mock_transfer', 'mock_qr', 'mock_wallet'][sequence % 3], total, createdAt]
            );

            for (const line of lines) {
                const [itemResult] = await connection.query(
                    `INSERT INTO order_items
                     (order_id, book_id, book_title, quantity, price, ebook_url)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [orderId, line.book.id, line.book.title, line.quantity, line.book.price, line.book.ebook_url]
                );
                if (status === 'approved') {
                    await connection.query(
                        'INSERT INTO download_links (order_item_id, token) VALUES (?, ?)',
                        [itemResult.insertId, crypto.randomBytes(32).toString('hex')]
                    );
                }
            }
            created += 1;
        }

        await connection.commit();
        console.log(`Added ${created} demo orders. Total is now at least 30.`);
    } catch (err) {
        await connection.rollback();
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        connection.release();
        await pool.end();
    }
}

main().catch(async err => {
    console.error(err.message);
    process.exitCode = 1;
    await pool.end();
});
