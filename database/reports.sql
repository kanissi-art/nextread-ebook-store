USE ebook_db;

-- 1. Daily sales: change @date_from and @date_to to the requested range.
SET @date_from = DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH);
SET @date_to = CURRENT_DATE;
SELECT DATE(o.created_at) AS sale_date,
       COUNT(DISTINCT o.id) AS total_orders,
       SUM(o.total_price) AS revenue,
       AVG(o.total_price) AS average_order_value
FROM orders o
WHERE o.status = 'approved'
  AND o.created_at >= @date_from
  AND o.created_at < DATE_ADD(@date_to, INTERVAL 1 DAY)
GROUP BY DATE(o.created_at)
ORDER BY sale_date;

-- 2. Best-selling E-Books by copies and revenue.
SELECT oi.book_id,
       oi.book_title,
       SUM(oi.quantity) AS copies_sold,
       SUM(oi.quantity * oi.price) AS revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'approved'
GROUP BY oi.book_id, oi.book_title
ORDER BY copies_sold DESC, revenue DESC
LIMIT 5;

-- 3. Category sales by copies and revenue.
SELECT c.id AS category_id,
       c.name AS category_name,
       SUM(oi.quantity) AS copies_sold,
       SUM(oi.quantity * oi.price) AS revenue
FROM order_items oi
JOIN books b ON b.id = oi.book_id
JOIN categories c ON c.id = b.category_id
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'approved'
GROUP BY c.id, c.name
ORDER BY revenue DESC;

-- 4a. Customer frequency and cumulative approved spend.
SELECT u.id,
       u.name AS customer_name,
       u.email,
       COUNT(DISTINCT o.id) AS approved_orders,
       SUM(o.total_price) AS total_spent
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status = 'approved'
GROUP BY u.id, u.name, u.email
HAVING COUNT(DISTINCT o.id) >= 1
ORDER BY total_spent DESC, approved_orders DESC;

-- 4b. Order counts by each status.
SELECT status, COUNT(*) AS order_count
FROM orders
GROUP BY status
ORDER BY status;
