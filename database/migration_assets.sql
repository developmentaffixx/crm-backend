USE crm_task_module;

-- ============================================================
-- Assets Module - Fresh Database Schema
-- Drop existing tables and recreate from scratch
-- ============================================================

DROP TABLE IF EXISTS asset_components;
DROP TABLE IF EXISTS asset_assignment_history;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS asset_categories;

-- ============================================================
-- 1. Asset Categories (Managed & Editable)
-- ============================================================

CREATE TABLE asset_categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Default categories from requirements
INSERT INTO asset_categories (name) VALUES
  ('IT Equipment'),
  ('Production Equipment'),
  ('Audio Equipment'),
  ('Lighting Equipment'),
  ('Accessories'),
  ('Office Equipment'),
  ('Communication Devices');

-- ============================================================
-- 2. Assets (Main Table)
-- ============================================================

CREATE TABLE assets (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id            VARCHAR(20) NOT NULL UNIQUE,
  asset_name          VARCHAR(255) NOT NULL,
  category_id         INT UNSIGNED NOT NULL,
  brand               VARCHAR(100) DEFAULT NULL,
  model               VARCHAR(100) DEFAULT NULL,
  serial_number       VARCHAR(255) DEFAULT NULL,
  purchase_date       DATE DEFAULT NULL,
  purchase_cost       DECIMAL(12,2) DEFAULT NULL,
  warranty_expiry     DATE DEFAULT NULL,
  assigned_to         INT UNSIGNED DEFAULT NULL,
  location            VARCHAR(255) DEFAULT NULL,
  status              ENUM('Available','Assigned','In Use','Under Maintenance','Returned','Retired','Disposed') NOT NULL DEFAULT 'Available',
  condition_status    ENUM('Working','Non-functional','Damaged','Lost') NOT NULL DEFAULT 'Working',
  notes               TEXT DEFAULT NULL,

  -- Extra fields (carried over from existing implementation)
  purchase_type       ENUM('Online','Offline') DEFAULT NULL,
  platform_name       VARCHAR(255) DEFAULT NULL,
  received_by         INT UNSIGNED DEFAULT NULL,
  shop_vendor_name    VARCHAR(255) DEFAULT NULL,
  purchased_by        INT UNSIGNED DEFAULT NULL,
  asset_value         DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_photo       VARCHAR(500) DEFAULT NULL,
  asset_photo         VARCHAR(500) DEFAULT NULL,

  -- Meta
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_assets_category    FOREIGN KEY (category_id) REFERENCES asset_categories(id),
  CONSTRAINT fk_assets_assigned    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_received    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_purchased   FOREIGN KEY (purchased_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_created     FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- 3. Asset Components / Included Items
-- ============================================================

CREATE TABLE asset_components (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id    INT UNSIGNED NOT NULL,
  item_name   VARCHAR(255) NOT NULL,
  quantity    INT UNSIGNED NOT NULL DEFAULT 1,
  notes       VARCHAR(500) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_component_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 4. Asset Assignment History
-- ============================================================

CREATE TABLE asset_assignment_history (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id        INT UNSIGNED NOT NULL,
  assigned_to     INT UNSIGNED NOT NULL,
  assigned_by     INT UNSIGNED NOT NULL,
  assigned_date   DATE NOT NULL,
  returned_date   DATE DEFAULT NULL,
  remarks         TEXT DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aah_asset      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_aah_assigned   FOREIGN KEY (assigned_to) REFERENCES users(id),
  CONSTRAINT fk_aah_by         FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- 5. Initial Seed Data (from requirements)
-- ============================================================

-- Note: These INSERT statements require a valid created_by user ID.
-- Replace '1' with the actual admin user ID in your system.

-- Production Equipment: Sony ZV-E10 Mark II (Camera Kit)
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-001', 'Sony ZV-E10 Mark II (Camera Kit)', 2, 'Sony', 'ZV-E10 Mark II', 'Available', 1);

SET @camera_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@camera_id, 'Sony ZV-E10 Mark II Camera', 1),
  (@camera_id, 'Sony E-Mount Lens (with Lens Cap)', 1),
  (@camera_id, 'Sony Camera Battery', 1),
  (@camera_id, 'Sony Camera Battery Charger', 1),
  (@camera_id, 'Camera Wind Muff', 1),
  (@camera_id, '64 GB SD Card', 1),
  (@camera_id, 'Camera Bag', 1);

-- Lighting Equipment: Softbox Kit
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-002', 'Softbox Kit', 4, 'Available', 1);

SET @softbox_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@softbox_id, 'Umbrella', 1),
  (@softbox_id, 'White Diffusion Cloth', 2),
  (@softbox_id, 'Steel Ring', 1),
  (@softbox_id, 'Grid Cloth', 1);

-- Lighting Equipment: Velbon Panel Light
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-003', 'Velbon Panel Light', 4, 'Velbon', 'Available', 1);

SET @velbon_light_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@velbon_light_id, 'Battery', 2),
  (@velbon_light_id, 'Charger', 1);

-- Lighting Equipment: Godox SL200
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-004', 'Godox SL200', 4, 'Godox', 'SL200', 'Available', 1);

SET @godox_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@godox_id, 'Reflector', 1),
  (@godox_id, 'Power Cable', 1),
  (@godox_id, 'LED Protective Cap', 1);

-- Lighting Equipment: LC500R RGB Light
INSERT INTO assets (asset_id, asset_name, category_id, model, status, created_by)
VALUES ('AST-005', 'LC500R RGB Light', 4, 'LC500R', 'Available', 1);

SET @lc500r_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@lc500r_id, 'Remote', 1),
  (@lc500r_id, 'Charger', 1);

-- Audio Equipment: Hollyland Lark M2
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-006', 'Hollyland Lark M2', 3, 'Hollyland', 'Lark M2', 'Available', 1);

SET @lark_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@lark_id, 'Wireless Microphones', 2),
  (@lark_id, 'Camera Receiver', 1),
  (@lark_id, 'USB-C Receiver', 1),
  (@lark_id, 'Lightning Receiver', 1),
  (@lark_id, 'Magnetic Clips', 2),
  (@lark_id, 'Wind Muffs', 2),
  (@lark_id, 'Charging Case', 1),
  (@lark_id, 'USB Cable', 1),
  (@lark_id, 'Carrying Pouch', 1);

-- Audio Equipment: Lavalier Microphone Kit
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-007', 'Lavalier Microphone Kit', 3, 'Available', 1);

SET @lav_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@lav_id, 'Lavalier Microphones', 2),
  (@lav_id, 'Lightning Cable', 1),
  (@lav_id, 'USB-C Connector', 1),
  (@lav_id, 'Carrying Pouch', 1);

-- Accessories: Digitek Camera Tripod
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-008', 'Digitek Camera Tripod', 5, 'Digitek', 'Available', 1);

SET @tripod_id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@tripod_id, 'Carry Bag', 1);

-- Accessories: Velbon Light Stand
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-009', 'Velbon Light Stand', 5, 'Velbon', 'Available', 1);

-- Accessories: HDMI Cable
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-010', 'HDMI Cable', 5, 'Available', 1);

-- Accessories: USB-C Cable
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-011', 'USB-C Cable', 5, 'Available', 1);

-- Accessories: 3.5 mm Headphones (x2)
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-012', '3.5 mm Headphones', 5, 'Available', 1);

INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-013', '3.5 mm Headphones', 5, 'Available', 1);

-- Accessories: USB-C Headphones
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-014', 'USB-C Headphones', 5, 'Available', 1);
