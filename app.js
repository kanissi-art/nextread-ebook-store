const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // เพิ่มโมดูลสร้างรหัสสุ่มสำหรับ Download Link

const app = express();

// --- 1. ตั้งค่า Storage สำหรับ Upload รูปภาพและไฟล์ E-Book ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = file.fieldname === 'ebook_file'
            ? path.join(__dirname, 'private', 'ebooks')
            : path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- 2. ตั้งค่า Database Connection ---
const databaseSsl = process.env.DB_SSL_CA
    ? { ca: process.env.DB_SSL_CA }
    : (process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false });

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ebook_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
    ssl: databaseSsl
});

// --- 3. ตั้งค่า Nodemailer ---
const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    })
    : null;

// --- 4. Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

const sessionSecret = process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-me');
if (!sessionSecret) throw new Error('SESSION_SECRET is required in production');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));

// ส่งค่า user, isAdmin, cart ไปที่ทุกหน้า EJS
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.cart = req.session.cart || [];
    next();
});

// --- 5. ROUTES สำหรับฝั่งผู้ใช้งาน ---

// หน้าหลัก แสดงรายการหนังสือ + ระบบค้นหาและจัดหมวดหมู่
app.get('/', async (req, res) => {
    try {
        const searchQuery =
            typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const requestedCategory =
            typeof req.query.category === 'string' ? req.query.category : '';
        const categoryFilter = /^\d+$/.test(requestedCategory)
            ? requestedCategory
            : '';

        const [categories] = await db.query(
            'SELECT * FROM categories ORDER BY name ASC'
        );

        let query = `
            SELECT b.*, c.name AS category_name
            FROM books b
            LEFT JOIN categories c ON c.id = b.category_id
            WHERE b.is_active = 1
        `;
        const params = [];

        if (searchQuery) {
            query += ` AND (
                b.title LIKE ? OR b.author LIKE ? OR c.name LIKE ?
            )`;
            const term = `%${searchQuery}%`;
            params.push(term, term, term);
        }

        if (categoryFilter) {
            query += ' AND b.category_id = ?';
            params.push(categoryFilter);
        }

        query += ' ORDER BY b.id DESC';

        const [books] = await db.query(query, params);
        res.render('index', {
            books,
            categories,
            searchQuery,
            categoryFilter
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// หน้ารายละเอียดหนังสือ
app.get('/book/:id', async (req, res) => {
    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ? AND is_active = 1', [req.params.id]);
        if (books.length === 0) return res.status(404).send('ไม่พบหนังสือ');
        res.render('detail', { book: books[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// หน้าสมัครสมาชิก
app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

// ประมวลผลสมัครสมาชิก
app.post('/register', async (req, res) => {
    const name = req.body.name || req.body.username;
    const { user_id, email, password, confirm_password } = req.body;

    if (confirm_password && password !== confirm_password) {
        return res.render('register', { error: 'รหัสผ่านทั้งสองครั้งไม่ตรงกัน' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const [[role]] = await db.query('SELECT id FROM roles WHERE role_name = ?', ['user']);
        if (!role) throw new Error('ไม่พบ role user ในฐานข้อมูล');
        await db.query(
            'INSERT INTO users (name, user_id, email, password, role_id) VALUES (?, ?, ?, ?, ?)',
            [name, user_id, email, passwordHash, role.id]
        );
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'เกิดข้อผิดพลาด: User ID หรือ Email นี้ถูกใช้งานแล้ว' });
    }
});

// หน้าเข้าสู่ระบบ
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// ประมวลผลเข้าสู่ระบบ
app.post('/login', async (req, res) => {
    const { user_id, password } = req.body;

    try {
        const [rows] = await db.query(
            `SELECT u.*, r.role_name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.user_id = ?`,
            [user_id]
        );
        if (rows.length > 0) {
            const user = rows[0];
            const isHashed = /^\$2[aby]\$/.test(user.password);
            const passwordMatches = isHashed
                ? await bcrypt.compare(password, user.password)
                : password === user.password;
            if (!passwordMatches) return res.render('login', { error: 'User ID หรือรหัสผ่านไม่ถูกต้อง' });
            if (!isHashed) {
                await db.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 12), user.id]);
            }
            req.session.user = { id: user.id, name: user.name, email: user.email };
            req.session.isAdmin = (user.role === 'admin');
            res.redirect('/');
        } else {
            res.render('login', { error: 'User ID หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'เกิดข้อผิดพลาดทางระบบ' });
    }
});

// ออกจากระบบ
app.get('/profile', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('profile', { error: null, success: null });
});

app.post('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!name || !email) return res.render('profile', { error: 'กรุณากรอกชื่อและอีเมล', success: null });
    try {
        await db.query('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, req.session.user.id]);
        req.session.user.name = name;
        req.session.user.email = email;
        res.render('profile', { error: null, success: 'บันทึกข้อมูลแล้ว' });
    } catch (err) {
        console.error(err);
        res.status(400).render('profile', { error: 'อีเมลนี้ถูกใช้งานแล้วหรือข้อมูลไม่ถูกต้อง', success: null });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// ดูตะกร้าสินค้า
app.get('/cart', (req, res) => {
    res.render('cart');
});

// เพิ่มหนังสือลงตะกร้า
app.post('/cart/add/:id', async (req, res) => {
    const bookId = req.params.id;
    if (!req.session.cart) req.session.cart = [];

    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ? AND is_active = 1', [bookId]);
        if (books.length > 0) {
            const book = books[0];
            const existing = req.session.cart.find(item => item.id == bookId);
            if (existing) {
                existing.quantity += 1;
            } else {
                req.session.cart.push({
                    id: book.id,
                    title: book.title,
                    price: book.price,
                    cover_image: book.cover_image,
                    quantity: 1
                });
            }
        }
        res.redirect(req.get('Referrer') || '/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Cart Error');
    }
});

// ลบสินค้าออกจากตะกร้า
app.post('/cart/remove/:id', (req, res) => {
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(item => item.id != req.params.id);
    }
    res.redirect('/cart');
});

app.post('/cart/update/:id', (req, res) => {
    const quantity = Number.parseInt(req.body.quantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.redirect('/cart');
    }
    const item = (req.session.cart || []).find(cartItem => String(cartItem.id) === String(req.params.id));
    if (item) item.quantity = quantity;
    res.redirect('/cart');
});

// ชำระเงิน / ยืนยันคำสั่งซื้อ
app.post('/checkout', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/');

    const paymentMethod = ['mock_transfer', 'mock_qr', 'mock_wallet'].includes(req.body.payment_method)
        ? req.body.payment_method
        : 'mock_transfer';
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const ids = cart.map(item => Number(item.id));
        const [books] = await connection.query(
            `SELECT id, title, price, ebook_url FROM books
             WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`,
            ids
        );
        if (books.length !== ids.length) throw new Error('มีหนังสือที่ไม่พร้อมขายในตะกร้า');
        const bookById = new Map(books.map(book => [String(book.id), book]));
        const totalPrice = cart.reduce((sum, item) => {
            const book = bookById.get(String(item.id));
            if (!book || !Number.isInteger(item.quantity) || item.quantity < 1) {
                throw new Error('รายการในตะกร้าไม่ถูกต้อง');
            }
            return sum + Number(book.price) * item.quantity;
        }, 0);
        const [result] = await connection.query(
            'INSERT INTO orders (user_id, user_email, total_price, status) VALUES (?, ?, ?, \'pending\')',
            [req.session.user.id, req.session.user.email, totalPrice]
        );
        const orderId = result.insertId;

        await connection.query(
            'INSERT INTO payments (order_id, payment_method, amount) VALUES (?, ?, ?)',
            [orderId, paymentMethod, totalPrice]
        );

        for (const item of cart) {
            const book = bookById.get(String(item.id));
            await connection.query(
                'INSERT INTO order_items (order_id, book_id, book_title, quantity, price, ebook_url) VALUES (?, ?, ?, ?, ?, ?)',
                [orderId, book.id, book.title, item.quantity, book.price, book.ebook_url]
            );
        }

        await connection.commit();
        req.session.cart = [];
        res.redirect('/my-orders');
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(400).send('Checkout Error: ' + (err.sqlMessage || err.message));
    } finally {
        connection.release();
    }
});

// รายการสั่งซื้อของฉัน (ประวัติออเดอร์ทั้งหมด)
app.get('/my-orders', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const [orders] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.session.user.id]);
        for (let order of orders) {
            const [items] = await db.query(
                `SELECT oi.*, COALESCE(b.title, oi.book_title) AS book_title,
                    dl.token AS download_token
                 FROM order_items oi
                 LEFT JOIN books b ON oi.book_id = b.id
                 LEFT JOIN download_links dl ON dl.order_item_id = oi.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }
        res.render('my-orders', { orders });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading orders');
    }
});

// คลังหนังสือของฉัน (เฉพาะหนังสือที่ได้รับการอนุมัติแล้ว)
app.get('/my-books', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const [books] = await db.query(`
                 SELECT b.id, b.title, b.author, b.cover_image, MIN(dl.token) AS download_token,
                     MAX(o.created_at) as purchase_date
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN books b ON oi.book_id = b.id
                 JOIN download_links dl ON dl.order_item_id = oi.id
            WHERE o.user_id = ? AND o.status = 'approved'
            GROUP BY b.id, b.title, b.author, b.cover_image, b.ebook_url
            ORDER BY purchase_date DESC
        `, [req.session.user.id]);

        res.render('my-books', { books });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading my books');
    }
});

// อ่านหนังสือออนไลน์ (ตรวจสอบสิทธิ์ว่าเคยซื้อและได้รับการอนุมัติแล้วหรือยัง)
app.get('/read/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const [rows] = await db.query(`
            SELECT b.*, dl.token AS download_token
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN books b ON oi.book_id = b.id
            JOIN download_links dl ON dl.order_item_id = oi.id
            WHERE o.user_id = ? AND b.id = ? AND o.status = 'approved'
        `, [req.session.user.id, req.params.id]);

        if (rows.length === 0) {
            return res.status(403).send('คุณยังไม่ได้ซื้อหนังสือเล่มนี้ หรือรายการสั่งซื้อยังไม่อนุมัติ');
        }

        res.render('read-book', { book: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error opening ebook');
    }
});

app.get('/download/:token', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const [[download]] = await db.query(
            `SELECT oi.ebook_url
             FROM download_links dl
             JOIN order_items oi ON oi.id = dl.order_item_id
             JOIN orders o ON o.id = oi.order_id
             WHERE dl.token = ? AND o.user_id = ? AND o.status = 'approved'`,
            [req.params.token, req.session.user.id]
        );
        if (!download) return res.status(403).send('ไม่มีสิทธิ์ดาวน์โหลดรายการนี้');
        if (download.ebook_url.startsWith('/private-ebooks/')) {
            const filename = path.basename(download.ebook_url);
            const filePath = path.join(__dirname, 'private', 'ebooks', filename);
            if (!fs.existsSync(filePath)) return res.status(404).send('ไม่พบไฟล์ E-Book');
            return res.download(filePath);
        }
        if (/^https:\/\//i.test(download.ebook_url)) return res.redirect(download.ebook_url);
        return res.status(404).send('ไม่พบไฟล์ E-Book');
    } catch (err) {
        console.error(err);
        res.status(500).send('Download Error');
    }
});

// --- 6. ROUTES สำหรับ ADMIN (จัดการหนังสือ + อนุมัติออเดอร์ + ฟังก์ชันใหม่) ---

// หน้าควบคุม Admin (เพิ่ม Dashboard, Users, Categories)
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        // 1. ดึงสถิติ Dashboard
        const [[totalSales]] = await db.query("SELECT SUM(total_price) as sum FROM orders WHERE status = 'approved'");
        const [[userCount]] = await db.query("SELECT COUNT(id) as count FROM users");
        const [[bookCount]] = await db.query("SELECT COUNT(id) as count FROM books");
        const dashboard = {
            revenue: totalSales.sum || 0,
            users: userCount.count || 0,
            books: bookCount.count || 0
        };

        const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        let orderSql = `
            SELECT o.*, u.name AS user_name, u.email,
                   p.payment_method, p.amount AS payment_amount, p.payment_date
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN payments p ON p.order_id = o.id
            WHERE 1 = 1`;
        const orderParams = [];
        if (searchQuery) {
            orderSql += ` AND (CAST(o.id AS CHAR) LIKE ? OR u.name LIKE ?
                OR u.email LIKE ? OR o.status LIKE ?)`;
            const term = `%${searchQuery}%`;
            orderParams.push(term, term, term, term);
        }
        orderSql += ' ORDER BY o.id DESC';
        const [orders] = await db.query(orderSql, orderParams);
        for (let order of orders) {
            const [items] = await db.query(
                `SELECT oi.*, COALESCE(b.title, oi.book_title) AS book_title
                 FROM order_items oi LEFT JOIN books b ON oi.book_id = b.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items || [];
        }

        // 3. ดึงหนังสือ หมวดหมู่ และผู้ใช้
        const [books] = await db.query('SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id ORDER BY b.id DESC');
        const [categories] = await db.query('SELECT * FROM categories ORDER BY id DESC');
        const [users] = await db.query(
            `SELECT u.id, u.name, u.user_id, u.email, r.role_name AS role
             FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id DESC`
        );

        res.render('admin', { orders, books, categories, users, dashboard, searchQuery });
    } catch (err) {
        console.error(err);
        res.status(500).send('Admin Error');
    }
});

// Admin เพิ่มหนังสือใหม่ (รองรับหมวดหมู่)
app.post('/admin/books/add', upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'ebook_file', maxCount: 1 }
]), async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    const { title, author, price, description, category_id } = req.body;
    const coverImage = req.files['cover_image'] ? '/uploads/' + req.files['cover_image'][0].filename : (req.body.cover_url || '');
    const ebookUrl = req.files['ebook_file'] ? '/private-ebooks/' + req.files['ebook_file'][0].filename : (req.body.ebook_url || '');

    try {
        await db.query(
            'INSERT INTO books (title, author, price, description, cover_image, ebook_url, category_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
            [title, author, price, description, coverImage, ebookUrl, category_id || null]
        );
        res.redirect('/admin');
    } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// --- ฟังก์ชันใหม่: จัดการหมวดหมู่ ---
app.post('/admin/categories/add', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.redirect('/admin');

    try {
        await db.query('INSERT INTO categories (name) VALUES (?)', [name]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(400).send('เพิ่มหมวดหมู่ไม่สำเร็จ หรือชื่อหมวดหมู่ซ้ำ');
    }
});

// --- ฟังก์ชันใหม่: อัปเดตสิทธิ์ผู้ใช้ (Admin/User) ---
app.post('/admin/users/role/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
        return res.status(400).send('บทบาทไม่ถูกต้อง');
    }

    try {
        await db.query(
            'UPDATE users SET role_id = (SELECT id FROM roles WHERE role_name = ?) WHERE id = ?',
            [role, req.params.id]
        );
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('เปลี่ยนบทบาทไม่สำเร็จ');
    }
});

// --- ฟังก์ชันใหม่: ระบบ Export เป็น CSV ---
app.get('/admin/export/orders', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        const [orders] = await db.query(`
            SELECT id, user_email, total_price, status, created_at
            FROM orders
            ORDER BY id DESC
        `);

        const csvCell = value => {
            let text = String(value ?? '');
            if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        };

        const rows = [
            ['Order ID', 'Customer Email', 'Total Price', 'Status', 'Date'],
            ...orders.map(order => [
                order.id,
                order.user_email,
                order.total_price,
                order.status,
                order.created_at
                    ? new Date(order.created_at).toLocaleString('th-TH')
                    : ''
            ])
        ];

        const csv = rows
            .map(row => row.map(csvCell).join(','))
            .join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.attachment('sales_report.csv');
        res.send('\uFEFF' + csv);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error Exporting');
    }
});

// Admin หน้าแก้ไขหนังสือ
app.get(['/admin/books/edit/:id', '/admin/edit/:id'], async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        const [[book]] = await db.query(
            'SELECT * FROM books WHERE id = ?',
            [req.params.id]
        );
        if (!book) return res.status(404).send('ไม่พบหนังสือ');

        const [categories] = await db.query(
            'SELECT * FROM categories ORDER BY name ASC'
        );

        res.render('admin-edit', { book, categories });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// Admin บันทึกการแก้ไขหนังสือ
app.post(['/admin/books/edit/:id', '/admin/edit/:id'], upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'ebook_file', maxCount: 1 }
]), async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const { title, author, price, description, current_cover, current_ebook } = req.body;
    const categoryId = req.body.category_id || null;
    const coverImage = req.files?.cover_image?.[0]
        ? '/uploads/' + req.files.cover_image[0].filename
        : (current_cover || '');
    const ebookUrl = req.files?.ebook_file?.[0]
        ? '/private-ebooks/' + req.files.ebook_file[0].filename
        : (current_ebook || '');

    try {
        if (categoryId) {
            const [[category]] = await db.query(
                'SELECT id FROM categories WHERE id = ?',
                [categoryId]
            );
            if (!category) return res.status(400).send('ไม่พบหมวดหมู่ที่เลือก');
        }

        await db.query(
            `UPDATE books
             SET title = ?, author = ?, price = ?, description = ?,
                 cover_image = ?, ebook_url = ?, category_id = ?
             WHERE id = ?`,
            [
                title, author, price, description, coverImage, ebookUrl,
                categoryId, req.params.id
            ]
        );

        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating book');
    }
});

// Admin ลบหนังสือ
app.post('/admin/books/delete/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        await db.query('UPDATE books SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting book');
    }
});

app.post('/admin/books/status/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    const isActive = req.body.is_active === '1' ? 1 : 0;
    try {
        await db.query('UPDATE books SET is_active = ? WHERE id = ?', [isActive, req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('เปลี่ยนสถานะหนังสือไม่สำเร็จ');
    }
});

// Admin อนุมัติคำสั่งซื้อ
app.post(['/admin/approve-order/:id', '/admin/orders/approve/:id'], async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    const orderId = req.params.id;

    try {
        const [approval] = await db.query(
            "UPDATE orders SET status = 'approved' WHERE id = ? AND status = 'pending'",
            [orderId]
        );
        if (!approval.affectedRows) return res.redirect('/admin');

        // --- เพิ่มเติม: สร้าง Token ลิงก์ดาวน์โหลดบันทึกลงฐานข้อมูล ---
        const [orderItems] = await db.query('SELECT id FROM order_items WHERE order_id = ?', [orderId]);
        for (let item of orderItems) {
            const token = crypto.randomBytes(16).toString('hex'); // สุ่มรหัส 32 ตัวอักษร
            await db.query(
                'INSERT IGNORE INTO download_links (order_item_id, token) VALUES (?, ?)',
                [item.id, token]
            );
        }

        // 2. สั่ง Redirect กลับหน้า Admin ทันที! (ไม่รอให้อีเมลส่งเสร็จ)
        res.redirect('/admin');

        // 3. เริ่มกระบวนการส่งอีเมลแบบ Background
        (async () => {
            try {
                const [orderRows] = await db.query(
                    'SELECT o.id, o.total_price, o.created_at, u.email, u.name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?',
                    [orderId]
                );

                if (orderRows.length > 0) {
                    const order = orderRows[0];
                    const [items] = await db.query(
                        `SELECT oi.*, COALESCE(b.title, oi.book_title) AS book_title,
                            dl.token AS download_token
                         FROM order_items oi
                         LEFT JOIN books b ON oi.book_id = b.id
                         JOIN download_links dl ON dl.order_item_id = oi.id
                         WHERE oi.order_id = ?`,
                        [order.id]
                    );

                    let itemsHtml = items.map(function(item) {
                        const downloadUrl = req.protocol + '://' + req.get('host') + '/download/' + item.download_token;
                        return '<tr style="border-bottom: 1px solid #e2e8f0;">' +
                            '<td style="padding: 10px; font-weight: bold;">' + (item.book_title || 'E-Book') + '</td>' +
                            '<td style="padding: 10px; text-align: center;">฿' + item.price + '</td>' +
                            '<td style="padding: 10px; text-align: right;">' +
                            '<a href="' + downloadUrl + '" style="background: #2563eb; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-weight: bold;"> อ่าน / ดาวน์โหลด</a>' +
                            '</td>' +
                            '</tr>';
                    }).join('');

                    const dateStr = order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '-';

                    let emailContent = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">' +
                        '<h2 style="color: #2563eb; text-align: center;"> ใบเสร็จรับเงิน & สลิปการสั่งซื้อ</h2>' +
                        '<p>สวัสดีคุณ <strong>' + (order.name || 'ลูกค้า') + '</strong>,</p>' +
                        '<p>คำสั่งซื้อของคุณได้รับการอนุมัติเรียบร้อยแล้ว รายละเอียดสลิปและลิงก์อ่านหนังสืออยู่ด้านล่างนี้ครับ:</p>' +
                        '<div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">' +
                        '<p style="margin: 4px 0;"><strong>หมายเลขออเดอร์:</strong> #' + order.id + '</p>' +
                        '<p style="margin: 4px 0;"><strong>วันที่สั่งซื้อ:</strong> ' + dateStr + '</p>' +
                        '<p style="margin: 4px 0;"><strong>สถานะ:</strong> <span style="color: #166534; font-weight: bold;">ชำระเงินแล้ว (อนุมัติแล้ว)</span></p>' +
                        '</div>' +
                        '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">' +
                        '<thead>' +
                        '<tr style="background: #2563eb; color: white;">' +
                        '<th style="padding: 10px; text-align: left;">รายการหนังสือ</th>' +
                        '<th style="padding: 10px; text-align: center;">ราคา</th>' +
                        '<th style="padding: 10px; text-align: right;">ดาวน์โหลด</th>' +
                        '</tr>' +
                        '</thead>' +
                        '<tbody>' + itemsHtml + '</tbody>' +
                        '</table>' +
                        '<div style="text-align: right; font-size: 1.2rem; font-weight: bold; margin-bottom: 20px; color: #0f172a;">' +
                        'ยอดชำระสุทธิ: <span style="color: #2563eb;">฿' + order.total_price + '</span>' +
                        '</div>' +
                        '<hr style="border: 0; border-top: 1px solid #e2e8f0;">' +
                        '<p style="color: #64748b; font-size: 0.85rem; text-align: center; margin-top: 15px;">ขอบคุณที่อุดหนุนหนังสือจาก NEXTREAD ครับ</p>' +
                        '</div>';

                    let mailOptions = {
                        from: '"NEXTREAD E-Book Store" <' + (process.env.EMAIL_USER || 'no-reply@nextread.local') + '>',
                        to: order.email,
                        subject: '[ใบเสร็จ & ลิงก์อ่านหนังสือ] คำสั่งซื้อ #' + order.id + ' ได้รับการอนุมัติแล้ว',
                        html: emailContent
                    };

                    if (transporter) await transporter.sendMail(mailOptions);
                }
            } catch (emailErr) {
                console.error('Background Email Failed:', emailErr);
            }
        })(); // <-- สิ้นสุดฟังก์ชัน Background

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).send('Error approving order');
        }
    }
});

// --- 7. START SERVER ---
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Health check database error:', err.message);
        res.status(503).json({ status: 'unavailable' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running at http://localhost:' + PORT);
});

app.post('/admin/categories/:id/edit', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const id = req.params.id;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!/^\d+$/.test(id) || !name) return res.redirect('/admin');

    try {
        await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(400).send('แก้ไขหมวดหมู่ไม่สำเร็จ');
    }
});

app.post('/admin/categories/:id/delete', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    if (!/^\d+$/.test(req.params.id)) return res.redirect('/admin');

    try {
        await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('ลบหมวดหมู่ไม่สำเร็จ');
    }
});


