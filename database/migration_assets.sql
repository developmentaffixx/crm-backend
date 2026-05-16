USE crm_task_module;

-- ============================================================
-- Assets Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS assets (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_tag           VARCHAR(20) NOT NULL UNIQUE,
  asset_name          VARCHAR(255) NOT NULL,
  category            VARCHAR(100) NOT NULL DEFAULT 'Physical',
  type                VARCHAR(100) DEFAULT NULL,
  brand               VARCHAR(100) DEFAULT NULL,
  model               VARCHAR(100) DEFAULT NULL,
  serial_number       VARCHAR(255) DEFAULT NULL,
  operational_status  ENUM('In Stock','Issued','Under Maintenance','Retired','Disposed') NOT NULL DEFAULT 'In Stock',
  condition_status    ENUM('Working','Non-functional','Damaged','Lost') NOT NULL DEFAULT 'Working',
  assigned_to         INT UNSIGNED DEFAULT NULL,
  purchase_type       ENUM('Online','Offline') NOT NULL DEFAULT 'Offline',
  platform_name       VARCHAR(255) DEFAULT NULL,
  received_by         INT UNSIGNED DEFAULT NULL,
  shop_vendor_name    VARCHAR(255) DEFAULT NULL,
  purchased_by        INT UNSIGNED DEFAULT NULL,
  purchase_date       DATE DEFAULT NULL,
  asset_value         DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_photo       VARCHAR(500) DEFAULT NULL,
  asset_photo         VARCHAR(500) DEFAULT NULL,
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assets_assigned    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_received    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_purchased   FOREIGN KEY (purchased_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_created     FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- Asset Assignment History
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_assignment_history (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id        INT UNSIGNED NOT NULL,
  assigned_to     INT UNSIGNED NOT NULL,
  assigned_by     INT UNSIGNED NOT NULL,
  assigned_date   DATE NOT NULL,
  returned_date   DATE DEFAULT NULL,
  notes           TEXT DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aah_asset      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_aah_assigned   FOREIGN KEY (assigned_to) REFERENCES users(id),
  CONSTRAINT fk_aah_by         FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB;
