const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// --- 1. ตั้งค่า Storage สำหรับ Upload รูปภาพและไฟล์ E-Book ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'public/uploads/';
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
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ebook_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: { rejectUnauthorized: false }
});

// --- 3. ตั้งค่า Nodemailer ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'flukesingkham@gmail.com',
        pass: process.env.EMAIL_PASS || 'giwc kikv ajxo rjcz'
    }
});

// --- 4. Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'nextread_secret_key',
    resave: false,
    saveUninitialized: true
}));

// ส่งค่า user, isAdmin, cart ไปที่ทุกหน้า EJS
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.cart = req.session.cart || [];
    next();
});

// --- 5. ROUTES สำหรับฝั่งผู้ใช้งาน ---

// หน้าหลัก แสดงรายการหนังสือ
app.get('/', async (req, res) => {
    try {
        const [books] = await db.query('SELECT * FROM books ORDER BY id DESC');
        res.render('index', { books });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// หน้ารายละเอียดหนังสือ
app.get('/book/:id', async (req, res) => {
    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
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
        await db.query(
            'INSERT INTO users (name, user_id, email, password, role) VALUES (?, ?, ?, ?, "user")',
            [name, user_id, email, password]
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
        const [rows] = await db.query('SELECT * FROM users WHERE user_id = ? AND password = ?', [user_id, password]);
        if (rows.length > 0) {
            const user = rows[0];
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
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [bookId]);
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

// ชำระเงิน / ยืนยันคำสั่งซื้อ
app.post('/checkout', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/');

    const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    try {
        const [result] = await db.query(
            'INSERT INTO orders (user_id, user_email, total_price) VALUES (?, ?, ?)',
            [req.session.user.id, req.session.user.email, totalPrice]
        );
        const orderId = result.insertId;

        for (let item of cart) {
            const [books] = await db.query('SELECT title, ebook_url FROM books WHERE id = ?', [item.id]);
            const book = books[0] || {};
            const bookTitle = item.title || book.title || 'E-Book';
            const ebookUrl = book.ebook_url || item.ebook_url || '';

            await db.query(
                'INSERT INTO order_items (order_id, book_id, book_title, price, ebook_url) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.id, bookTitle, item.price, ebookUrl]
            );
        }

        req.session.cart = [];
        res.redirect('/my-orders');
    } catch (err) {
        console.error(err);
        res.status(500).send('Checkout Error: ' + (err.sqlMessage || err.message));
    }
});

// รายการสั่งซื้อของฉัน (ประวัติออเดอร์ทั้งหมด)
app.get('/my-orders', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const [orders] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.session.user.id]);
        for (let order of orders) {
            const [items] = await db.query(
                'SELECT oi.*, b.title as book_title, b.ebook_url FROM order_items oi JOIN books b ON oi.book_id = b.id WHERE oi.order_id = ?',
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
            SELECT b.id, b.title, b.author, b.cover_image, b.ebook_url, MAX(o.created_at) as purchase_date
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN books b ON oi.book_id = b.id
            WHERE o.user_id = ? AND o.status = "approved"
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
            SELECT b.* 
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN books b ON oi.book_id = b.id
            WHERE o.user_id = ? AND b.id = ? AND o.status = "approved"
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

// --- 6. ROUTES สำหรับ ADMIN (จัดการหนังสือ + อนุมัติออเดอร์) ---

// หน้าควบคุม Admin
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        const [orders] = await db.query(
            'SELECT o.*, u.name as user_name, u.email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.id DESC'
        );

        for (let order of orders) {
            const [items] = await db.query(
                'SELECT oi.*, b.title as book_title, b.ebook_url FROM order_items oi JOIN books b ON oi.book_id = b.id WHERE oi.order_id = ?',
                [order.id]
            );
            order.items = items || [];
        }

        const [books] = await db.query('SELECT * FROM books ORDER BY id DESC');
        res.render('admin', { orders, books });
    } catch (err) {
        console.error(err);
        res.status(500).send('Admin Error');
    }
});

// Admin เพิ่มหนังสือใหม่
app.post('/admin/books/add', upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'ebook_file', maxCount: 1 }
]), async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const { title, author, price, description } = req.body;
    const coverImage = req.files['cover_image'] ? '/uploads/' + req.files['cover_image'][0].filename : (req.body.cover_url || '');
    const ebookUrl = req.files['ebook_file'] ? '/uploads/' + req.files['ebook_file'][0].filename : (req.body.ebook_url || '');

    try {
        await db.query(
            'INSERT INTO books (title, author, price, description, cover_image, ebook_url) VALUES (?, ?, ?, ?, ?, ?)',
            [title, author, price, description, coverImage, ebookUrl]
        );
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error adding book');
    }
});

// Admin หน้าแก้ไขหนังสือ
app.get('/admin/books/edit/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) return res.status(404).send('ไม่พบหนังสือ');
        res.render('admin-edit', { book: books[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// Admin บันทึกการแก้ไขหนังสือ
app.post('/admin/books/edit/:id', upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'ebook_file', maxCount: 1 }
]), async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    const { title, author, price, description, current_cover, current_ebook } = req.body;
    const coverImage = req.files['cover_image'] ? '/uploads/' + req.files['cover_image'][0].filename : current_cover;
    const ebookUrl = req.files['ebook_file'] ? '/uploads/' + req.files['ebook_file'][0].filename : current_ebook;

    try {
        await db.query(
            'UPDATE books SET title = ?, author = ?, price = ?, description = ?, cover_image = ?, ebook_url = ? WHERE id = ?',
            [title, author, price, description, coverImage, ebookUrl, req.params.id]
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
        await db.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting book');
    }
});

// Admin อนุมัติคำสั่งซื้อ
app.post(['/admin/approve-order/:id', '/admin/orders/approve/:id'], async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    const orderId = req.params.id;

    try {
        // 1. อนุมัติสถานะออเดอร์ในฐานข้อมูลก่อน
        await db.query('UPDATE orders SET status = "approved" WHERE id = ?', [orderId]);

        // 2. พยายามส่งอีเมล (แยก try...catch ไว้ เพื่อไม่ให้ปุ่มอนุมัติพังหากส่งอีเมลมีปัญหา)
        try {
            const [orderRows] = await db.query(
                'SELECT o.id, o.total_price, o.created_at, u.email, u.name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?',
                [orderId]
            );

            if (orderRows.length > 0) {
                const order = orderRows[0];
                const [items] = await db.query(
                    'SELECT b.title, b.price, b.ebook_url FROM order_items oi JOIN books b ON oi.book_id = b.id WHERE oi.order_id = ?',
                    [orderId]
                );

                let itemsHtml = items.map(function(item) {
                    return '<tr style="border-bottom: 1px solid #e2e8f0;">' +
                        '<td style="padding: 10px; font-weight: bold;">' + (item.title || 'E-Book') + '</td>' +
                        '<td style="padding: 10px; text-align: center;">฿' + item.price + '</td>' +
                        '<td style="padding: 10px; text-align: right;">' +
                        '<a href="' + (item.ebook_url || '#') + '" target="_blank" style="background: #2563eb; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-weight: bold;"> อ่าน / ดาวน์โหลด</a>' +
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
                    from: '"NEXTREAD E-Book Store" <' + (process.env.EMAIL_USER || 'flukesingkham@gmail.com') + '>',
                    to: order.email,
                    subject: '[ใบเสร็จ & ลิงก์อ่านหนังสือ] คำสั่งซื้อ #' + order.id + ' ได้รับการอนุมัติแล้ว',
                    html: emailContent
                };

                await transporter.sendMail(mailOptions);
            }
        } catch (emailErr) {
            console.error('Email send failed but order approved successfully:', emailErr);
        }

        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error approving order');
    }
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running at http://localhost:' + PORT);
});