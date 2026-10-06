# NEXTREAD Database Design

## ERD

```mermaid
erDiagram
    roles ||--o{ users : assigns
    categories ||--o{ books : classifies
    users ||--o{ orders : places
    orders ||--|{ order_items : contains
    books ||--o{ order_items : sold_as
    orders ||--o| payments : has
    order_items ||--o| download_links : grants

    roles {
        int id PK
        varchar role_name UK
    }
    users {
        int id PK
        int role_id FK
        varchar name
        varchar user_id UK
        varchar email UK
        varchar password
        timestamp created_at
    }
    categories {
        int id PK
        varchar name UK
    }
    books {
        int id PK
        int category_id FK
        varchar title
        varchar author
        decimal price
        text description
        varchar cover_image
        varchar ebook_url
        boolean is_active
        timestamp created_at
    }
    orders {
        int id PK
        int user_id FK
        varchar user_email
        decimal total_price
        enum status
        timestamp created_at
    }
    order_items {
        int id PK
        int order_id FK
        int book_id FK
        varchar book_title
        int quantity
        decimal price
        varchar ebook_url
    }
    payments {
        int id PK
        int order_id FK_UK
        enum payment_method
        decimal amount
        timestamp payment_date
    }
    download_links {
        int id PK
        int order_item_id FK_UK
        char token UK
        timestamp created_at
    }
```

## Table Notes

- `roles` separates authorization roles from user accounts; each user has exactly one role.
- `order_items.book_title`, `price`, and `ebook_url` are purchase-time snapshots. They intentionally preserve the sale record if catalog details later change.
- `orders.total_price` is a checkout snapshot. The application recalculates it from current book prices and quantities before inserting an order.
- `books.is_active` controls catalog visibility and sale availability; historical order items remain available when a book is deactivated.
- `download_links` are created on approval and are only served by `/download/:token` after checking the signed-in owner and approved order status.
- The session cart is temporary application state, not a persisted database cart.

## Normalization

Role names, categories, users, books, orders, payments, and download grants are separated by entity. Purchase-time book fields and the order total are deliberate snapshots for historical receipts and reporting; they are not catalog source-of-truth fields.
