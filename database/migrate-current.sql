USE ebook_db;

-- One-time migration from the schema used by the original app.js.
-- Back up the database first. This file is intentionally not idempotent.
CREATE TABLE roles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;
INSERT INTO roles (id, role_name) VALUES (1, 'admin'), (2, 'user');

ALTER TABLE users ADD COLUMN role_id INT UNSIGNED NULL AFTER id;
UPDATE users
SET role_id = CASE WHEN role = 'admin' THEN 1 ELSE 2 END;
ALTER TABLE users MODIFY role_id INT UNSIGNED NOT NULL;
ALTER TABLE users
    ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id);

ALTER TABLE books
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1,
    ADD CONSTRAINT chk_books_price CHECK (price > 0),
    ADD CONSTRAINT chk_books_active CHECK (is_active IN (0, 1));

ALTER TABLE order_items
    ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1,
    ADD CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    ADD CONSTRAINT chk_order_items_price CHECK (price > 0);

ALTER TABLE orders
    MODIFY status ENUM('pending', 'approved', 'cancelled') NOT NULL DEFAULT 'pending',
    ADD CONSTRAINT chk_orders_total CHECK (total_price >= 0);

ALTER TABLE payments
    MODIFY payment_method ENUM('mock_transfer', 'mock_qr', 'mock_wallet') NOT NULL DEFAULT 'mock_transfer',
    ADD CONSTRAINT chk_payments_amount CHECK (amount >= 0);

INSERT IGNORE INTO download_links (order_item_id, token)
SELECT oi.id, SHA2(CONCAT(UUID(), '-', oi.id, '-', CURRENT_TIMESTAMP(6)), 256)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'approved';

-- Uploaded E-Book files must be moved from public/uploads to private/ebooks
-- separately; update books.ebook_url and order_items.ebook_url to
-- /private-ebooks/<filename> after the files have been moved.
