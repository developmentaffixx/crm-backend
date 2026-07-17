USE crm_task_module;

-- ============================================================
-- Inventory Module V2 - Fresh Install
-- Drops old table and creates fresh structure
-- ============================================================

-- Drop old tables (order matters due to FK constraints)
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS inventory_categories;
DROP TABLE IF EXISTS inventories;

-- ============================================================
-- 1. Inventories Table (fresh)
-- ============================================================
CREATE TABLE inventories (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_name           VARCHAR(255) NOT NULL,
  category            VARCHAR(100) NOT NULL DEFAULT 'General',
  unit                VARCHAR(50) NOT NULL DEFAULT 'Nos',
  sku_code            VARCHAR(100) DEFAULT NULL,
  quantity            INT UNSIGNED NOT NULL DEFAULT 0,
  unit_price          DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_value         DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  location            VARCHAR(255) DEFAULT NULL,
  purchase_date       DATE DEFAULT NULL,
  condition_status    ENUM('New','Good','Fair','Poor') DEFAULT 'New',
  assigned_to         VARCHAR(500) DEFAULT NULL,
  serial_number       VARCHAR(255) DEFAULT NULL,
  min_stock_alert     INT UNSIGNED DEFAULT NULL,
  notes               TEXT DEFAULT NULL,
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- 2. Inventory Categories (managed list)
-- ============================================================
CREATE TABLE inventory_categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  sort_order  INT UNSIGNED NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed the 7 default categories
INSERT INTO inventory_categories (name, sort_order) VALUES
  ('Stationery', 1),
  ('Office Supplies', 2),
  ('Fasteners & Mounting', 3),
  ('Cleaning Supplies', 4),
  ('Batteries', 5),
  ('Office Accessories', 6),
  ('Company Seals', 7);

-- ============================================================
-- 3. Inventory Transactions (Stock In / Stock Out history)
-- ============================================================
CREATE TABLE inventory_transactions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id    INT UNSIGNED NOT NULL,
  type            ENUM('stock_in', 'stock_out') NOT NULL,
  quantity        INT UNSIGNED NOT NULL,
  transaction_date DATE NOT NULL,
  vendor          VARCHAR(255) DEFAULT NULL,
  bill_number     VARCHAR(100) DEFAULT NULL,
  purpose         VARCHAR(255) DEFAULT NULL,
  issued_by       INT UNSIGNED DEFAULT NULL,
  remarks         TEXT DEFAULT NULL,
  created_by      INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_txn_inventory FOREIGN KEY (inventory_id) REFERENCES inventories(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_txn_issued_by FOREIGN KEY (issued_by) REFERENCES users(id),
  CONSTRAINT fk_inv_txn_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Indexes for fast lookups
CREATE INDEX idx_inv_txn_inventory ON inventory_transactions(inventory_id);
CREATE INDEX idx_inv_txn_type ON inventory_transactions(type);
CREATE INDEX idx_inv_txn_date ON inventory_transactions(transaction_date);
