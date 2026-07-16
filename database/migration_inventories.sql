USE crm_task_module;

-- ============================================================
-- Inventories Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS inventories (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_name           VARCHAR(255) NOT NULL,
  category            VARCHAR(100) NOT NULL DEFAULT 'General',
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
