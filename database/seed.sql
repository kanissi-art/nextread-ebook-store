USE ebook_db;

-- Run against a fresh schema.sql database. Demo password for every account: Demo1234!
INSERT INTO roles (id, role_name) VALUES (1, 'admin'), (2, 'user')
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

INSERT INTO users (id, role_id, name, user_id, email, password) VALUES
(1, 1, 'Store Admin', 'admin', 'admin@example.test', '$2b$12$FYj9/VfYMaJUtamkTybhYOH5qo7l3OtLcGtfXgxqvD6XNZhV53utO'),
(2, 2, 'Customer One', 'customer1', 'customer1@example.test', '$2b$12$FYj9/VfYMaJUtamkTybhYOH5qo7l3OtLcGtfXgxqvD6XNZhV53utO'),
(3, 2, 'Customer Two', 'customer2', 'customer2@example.test', '$2b$12$FYj9/VfYMaJUtamkTybhYOH5qo7l3OtLcGtfXgxqvD6XNZhV53utO'),
(4, 2, 'Customer Three', 'customer3', 'customer3@example.test', '$2b$12$FYj9/VfYMaJUtamkTybhYOH5qo7l3OtLcGtfXgxqvD6XNZhV53utO'),
(5, 2, 'Customer Four', 'customer4', 'customer4@example.test', '$2b$12$FYj9/VfYMaJUtamkTybhYOH5qo7l3OtLcGtfXgxqvD6XNZhV53utO')
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO categories (id, name) VALUES
(1, 'Programming'), (2, 'Business'), (3, 'Psychology'), (4, 'Fiction')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO books (id, category_id, title, author, price, description, cover_image, ebook_url, is_active) VALUES
(1, 1, 'SQL Fundamentals', 'A. Sample', 220.00, 'Introductory SQL learning guide.', '', 'https://example.test/ebooks/sql-fundamentals.pdf', 1),
(2, 1, 'Web Development Basics', 'B. Sample', 280.00, 'A practical guide to web development.', '', 'https://example.test/ebooks/web-development.pdf', 1),
(3, 2, 'Small Business Planning', 'C. Sample', 310.00, 'Planning and managing a small business.', '', 'https://example.test/ebooks/business-planning.pdf', 1),
(4, 2, 'Personal Finance Guide', 'D. Sample', 190.00, 'A basic guide to personal finance.', '', 'https://example.test/ebooks/personal-finance.pdf', 1),
(5, 3, 'Understanding Habits', 'E. Sample', 250.00, 'An introduction to behavior and habits.', '', 'https://example.test/ebooks/habits.pdf', 1),
(6, 3, 'Mindful Learning', 'F. Sample', 175.00, 'Study techniques and mindful practice.', '', 'https://example.test/ebooks/mindful-learning.pdf', 1),
(7, 4, 'The Paper Garden', 'G. Sample', 225.00, 'A fictional sample title.', '', 'https://example.test/ebooks/paper-garden.pdf', 1),
(8, 4, 'Midnight Library Notes', 'H. Sample', 205.00, 'A fictional sample title.', '', 'https://example.test/ebooks/midnight-notes.pdf', 0)
ON DUPLICATE KEY UPDATE title = VALUES(title);

CREATE TEMPORARY TABLE seed_numbers (seed_no INT PRIMARY KEY);
INSERT INTO seed_numbers (seed_no) VALUES
(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),
(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),
(21),(22),(23),(24),(25),(26),(27),(28),(29),(30);

CREATE TEMPORARY TABLE seed_order_lines (
    order_no INT NOT NULL,
    line_no INT NOT NULL,
    book_id INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (order_no, line_no)
);
INSERT INTO seed_order_lines (order_no, line_no, book_id, quantity, price)
SELECT n.seed_no, offsets.line_no,
       MOD(n.seed_no + offsets.line_no - 1, 7) + 1,
       MOD(n.seed_no + offsets.line_no, 3) + 1,
       b.price
FROM seed_numbers n
JOIN (
    SELECT 1 AS line_no UNION ALL SELECT 2 UNION ALL SELECT 3
) offsets ON offsets.line_no = 1
    OR (offsets.line_no = 2 AND MOD(n.seed_no, 2) = 0)
    OR (offsets.line_no = 3 AND MOD(n.seed_no, 3) = 0)
JOIN books b ON b.id = MOD(n.seed_no + offsets.line_no - 1, 7) + 1;

INSERT INTO orders (id, user_id, user_email, total_price, status, created_at)
SELECT n.seed_no,
       MOD(n.seed_no - 1, 4) + 2,
       CONCAT('customer', MOD(n.seed_no - 1, 4) + 1, '@example.test'),
       SUM(lines.quantity * lines.price),
       CASE WHEN MOD(n.seed_no, 5) = 0 THEN 'cancelled'
            WHEN MOD(n.seed_no, 4) = 0 THEN 'pending'
            ELSE 'approved' END,
       DATE_SUB(CURRENT_TIMESTAMP, INTERVAL (n.seed_no * 7) DAY)
FROM seed_numbers n
JOIN seed_order_lines lines ON lines.order_no = n.seed_no
GROUP BY n.seed_no
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO order_items (order_id, book_id, book_title, quantity, price, ebook_url)
SELECT o.id, b.id, b.title, lines.quantity, lines.price, b.ebook_url
FROM seed_order_lines lines
JOIN orders o ON o.id = lines.order_no
JOIN books b ON b.id = lines.book_id
WHERE NOT EXISTS (
    SELECT 1 FROM order_items existing
    WHERE existing.order_id = o.id AND existing.book_id = b.id
);

INSERT INTO payments (order_id, payment_method, amount, payment_date)
SELECT o.id,
       CASE MOD(o.id, 3) WHEN 0 THEN 'mock_qr' WHEN 1 THEN 'mock_transfer' ELSE 'mock_wallet' END,
       o.total_price,
       o.created_at
FROM orders o
WHERE o.id BETWEEN 1 AND 30
ON DUPLICATE KEY UPDATE order_id = VALUES(order_id);

INSERT INTO download_links (order_item_id, token)
SELECT oi.id, SHA2(CONCAT('nextread-demo-', oi.id), 256)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.id BETWEEN 1 AND 30 AND o.status = 'approved'
ON DUPLICATE KEY UPDATE order_item_id = VALUES(order_item_id);

DROP TEMPORARY TABLE seed_order_lines;
DROP TEMPORARY TABLE seed_numbers;
