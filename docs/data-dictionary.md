# พจนานุกรมข้อมูล NEXTREAD

ชนิดข้อมูลและข้อบังคับตรงกับ `database/schema.sql` (MySQL/InnoDB)

| ตาราง | ฟิลด์ | ชนิดข้อมูล | คีย์/ข้อกำหนด | ความหมาย |
|---|---|---|---|---|
| roles | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสบทบาท |
| roles | role_name | VARCHAR(50) | NOT NULL, UNIQUE | ชื่อบทบาท `admin` หรือ `user` |
| users | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสสมาชิก |
| users | role_id | INT UNSIGNED | FK -> roles.id, NOT NULL | บทบาทสมาชิก |
| users | name | VARCHAR(100) | NOT NULL | ชื่อสมาชิก |
| users | user_id | VARCHAR(50) | NOT NULL, UNIQUE | ชื่อเข้าสู่ระบบ |
| users | email | VARCHAR(100) | NOT NULL, UNIQUE | อีเมล |
| users | password | VARCHAR(255) | NOT NULL | bcrypt password hash |
| users | created_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | วันเวลาสมัคร |
| categories | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสหมวดหมู่ |
| categories | name | VARCHAR(100) | NOT NULL, UNIQUE | ชื่อหมวดหมู่ |
| books | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัส E-Book |
| books | category_id | INT UNSIGNED | FK -> categories.id, NULL | หมวดหมู่; ตั้งเป็น NULL เมื่อหมวดถูกลบ |
| books | title | VARCHAR(255) | NOT NULL | ชื่อหนังสือ |
| books | author | VARCHAR(100) | NOT NULL | ผู้แต่ง |
| books | price | DECIMAL(10,2) | NOT NULL, CHECK > 0 | ราคาปัจจุบัน |
| books | description | TEXT | NULL | คำอธิบาย |
| books | cover_image | VARCHAR(255) | NULL | URL/พาธภาพปก |
| books | ebook_url | VARCHAR(255) | NOT NULL | URL ภายนอกหรือพาธไฟล์ส่วนตัว |
| books | is_active | TINYINT(1) | NOT NULL, DEFAULT 1, CHECK 0/1 | เปิด/ปิดขาย |
| books | created_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | วันที่เพิ่มหนังสือ |
| orders | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสคำสั่งซื้อ |
| orders | user_id | INT UNSIGNED | FK -> users.id, NOT NULL | ผู้ซื้อ |
| orders | user_email | VARCHAR(100) | NOT NULL | อีเมล ณ เวลาสั่งซื้อ |
| orders | total_price | DECIMAL(10,2) | NOT NULL, DEFAULT 0, CHECK >= 0 | ยอดรวม ณ เวลาสั่งซื้อ |
| orders | status | ENUM | NOT NULL, DEFAULT `pending` | `pending`, `approved`, `cancelled` |
| orders | created_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | วันเวลาสั่งซื้อ |
| order_items | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสรายการสินค้า |
| order_items | order_id | INT UNSIGNED | FK -> orders.id, NOT NULL | คำสั่งซื้อเจ้าของรายการ |
| order_items | book_id | INT UNSIGNED | FK -> books.id, NULL | หนังสือใน catalog |
| order_items | book_title | VARCHAR(255) | NOT NULL | ชื่อ ณ เวลาซื้อ |
| order_items | quantity | INT UNSIGNED | NOT NULL, DEFAULT 1, CHECK > 0 | จำนวนเล่ม |
| order_items | price | DECIMAL(10,2) | NOT NULL, CHECK > 0 | ราคาต่อเล่ม ณ เวลาซื้อ |
| order_items | ebook_url | VARCHAR(255) | NOT NULL | URL/พาธ ณ เวลาซื้อ |
| payments | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสรายการชำระ |
| payments | order_id | INT UNSIGNED | FK -> orders.id, UNIQUE, NOT NULL | คำสั่งซื้อ (หนึ่งรายการชำระต่อคำสั่งซื้อ) |
| payments | payment_method | ENUM | NOT NULL, DEFAULT `mock_transfer` | วิธีชำระจำลอง |
| payments | amount | DECIMAL(10,2) | NOT NULL, CHECK >= 0 | ยอดชำระจำลอง |
| payments | payment_date | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | วันเวลาบันทึกรายการ |
| download_links | id | INT UNSIGNED | PK, AUTO_INCREMENT | รหัสลิงก์ดาวน์โหลด |
| download_links | order_item_id | INT UNSIGNED | FK -> order_items.id, UNIQUE, NOT NULL | รายการที่ให้สิทธิ์ดาวน์โหลด |
| download_links | token | CHAR(64) | NOT NULL, UNIQUE | token ดาวน์โหลด |
| download_links | created_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | วันเวลาสร้าง token |
