USE crm_task_module;

-- ============================================================
-- Assets Module - Fresh Database Schema (Phase 1)
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

-- Categories from Phase 1 document
INSERT INTO asset_categories (name) VALUES
  ('IT Equipment'),
  ('Production Equipment'),
  ('Lighting Equipment'),
  ('Audio Equipment'),
  ('IT Accessories'),
  ('Office Equipment'),
  ('Communication'),
  ('Production Accessories');

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

  -- Extra fields (purchase tracking)
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
-- 5. Phase 1 - Initial Asset Data
-- ============================================================
-- Note: Replace '1' with actual admin user ID if different.
-- Category IDs: 1=IT Equipment, 2=Production Equipment, 3=Lighting Equipment,
--               4=Audio Equipment, 5=IT Accessories, 6=Office Equipment,
--               7=Communication, 8=Production Accessories

-- ──────────────────────────────────────────────────────────────
-- PRODUCTION EQUIPMENT (category_id = 2)
-- ──────────────────────────────────────────────────────────────

-- Sony ZV-E10 Mark II Camera Kit
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-001', 'Sony ZV-E10 Mark II Camera Kit', 2, 'Sony', 'ZV-E10 Mark II', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Sony ZV-E10 Mark II Camera', 1),
  (@id, 'Sony E-Mount Lens (with Lens Cap)', 1),
  (@id, 'Sony Camera Battery', 1),
  (@id, 'Sony Camera Battery Charger', 1),
  (@id, 'Camera Wind Muff', 1),
  (@id, '64 GB SD Card', 1),
  (@id, 'Camera Bag', 1);

-- ──────────────────────────────────────────────────────────────
-- LIGHTING EQUIPMENT (category_id = 3)
-- ──────────────────────────────────────────────────────────────

-- Softbox Kit
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-002', 'Softbox Kit', 3, 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Umbrella', 1),
  (@id, 'White Diffusion Cloth', 2),
  (@id, 'Steel Ring', 1),
  (@id, 'Grid Cloth', 1);

-- Velbon Panel Light
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-003', 'Velbon Panel Light', 3, 'Velbon', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Batteries', 2),
  (@id, 'Charger', 1);

-- Godox SL200
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-004', 'Godox SL200', 3, 'Godox', 'SL200', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Reflector', 1),
  (@id, 'Power Cable', 1),
  (@id, 'LED Protective Cap', 1);

-- LC500R RGB Light
INSERT INTO assets (asset_id, asset_name, category_id, model, status, created_by)
VALUES ('AST-005', 'LC500R RGB Light', 3, 'LC500R', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Remote', 1),
  (@id, 'Charger', 1);

-- ──────────────────────────────────────────────────────────────
-- AUDIO EQUIPMENT (category_id = 4)
-- ──────────────────────────────────────────────────────────────

-- Hollyland Lark M2
INSERT INTO assets (asset_id, asset_name, category_id, brand, model, status, created_by)
VALUES ('AST-006', 'Hollyland Lark M2', 4, 'Hollyland', 'Lark M2', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Wireless Microphones', 2),
  (@id, 'Camera Receiver', 1),
  (@id, 'USB-C Receiver', 1),
  (@id, 'Lightning Receiver', 1),
  (@id, 'Magnetic Clips', 2),
  (@id, 'Wind Muffs', 2),
  (@id, 'Charging Case', 1),
  (@id, 'USB Cable', 1),
  (@id, 'Carrying Pouch', 1);

-- Lavalier Microphone Kit
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-007', 'Lavalier Microphone Kit', 4, 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Lavalier Microphones', 2),
  (@id, 'Lightning Cable', 1),
  (@id, 'USB-C Connector', 1),
  (@id, 'Carrying Pouch', 1);

-- ──────────────────────────────────────────────────────────────
-- EQUIPMENT STANDS (using Production Accessories = 8)
-- ──────────────────────────────────────────────────────────────

-- Digitek Camera Tripod
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-008', 'Digitek Camera Tripod', 8, 'Digitek', 'Available', 1);

SET @id = LAST_INSERT_ID();
INSERT INTO asset_components (asset_id, item_name, quantity) VALUES
  (@id, 'Carry Bag', 1);

-- Velbon Light Stand
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-009', 'Velbon Light Stand', 8, 'Velbon', 'Available', 1);

-- ──────────────────────────────────────────────────────────────
-- IT EQUIPMENT (category_id = 1)
-- ──────────────────────────────────────────────────────────────

-- Editing PC
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-010', 'Editing PC', 1, 'Available', 1);

-- ASUS Laptop (with Charger & Laptop Bag)
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, notes, created_by)
VALUES ('AST-011', 'ASUS Laptop', 1, 'ASUS', 'Available', 'With Charger & Laptop Bag', 1);

-- Dell Monitor #1
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-012', 'Dell Monitor', 1, 'Dell', 'Available', 1);

-- Dell Monitor #2
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-013', 'Dell Monitor', 1, 'Dell', 'Available', 1);

-- Logitech Keyboard #1
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-014', 'Logitech Keyboard', 1, 'Logitech', 'Available', 1);

-- Logitech Keyboard #2
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-015', 'Logitech Keyboard', 1, 'Logitech', 'Available', 1);

-- Editing Keyboard #1
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-016', 'Editing Keyboard', 1, 'Available', 1);

-- Editing Keyboard #2
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-017', 'Editing Keyboard', 1, 'Available', 1);

-- Apple iPad (with Charger, Back Case & Tempered Glass)
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, notes, created_by)
VALUES ('AST-018', 'Apple iPad', 1, 'Apple', 'Available', 'With Charger, Back Case & Tempered Glass', 1);

-- Realme Office Phone
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-019', 'Realme Office Phone', 1, 'Realme', 'Available', 1);

-- ──────────────────────────────────────────────────────────────
-- IT ACCESSORIES (category_id = 5)
-- ──────────────────────────────────────────────────────────────

-- ASUS Mouse
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-020', 'ASUS Mouse', 5, 'ASUS', 'Available', 1);

-- Lapcare Mouse
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-021', 'Lapcare Mouse', 5, 'Lapcare', 'Available', 1);

-- Mouse Pad
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-022', 'Mouse Pad', 5, 'Available', 1);

-- Extension Box
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-023', 'Extension Box', 5, 'Available', 1);

-- HDMI Cable
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-024', 'HDMI Cable', 5, 'Available', 1);

-- USB-C Cable
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-025', 'USB-C Cable', 5, 'Available', 1);

-- Card Reader
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-026', 'Card Reader', 5, 'Available', 1);

-- Card Reader USB-C Adapter
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-027', 'Card Reader USB-C Adapter', 5, 'Available', 1);

-- HP Pen Drive
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-028', 'HP Pen Drive', 5, 'HP', 'Available', 1);

-- SanDisk Pen Drive
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, created_by)
VALUES ('AST-029', 'SanDisk Pen Drive', 5, 'SanDisk', 'Available', 1);

-- Samsung 1TB SSD (with Hard Pouch)
INSERT INTO assets (asset_id, asset_name, category_id, brand, status, notes, created_by)
VALUES ('AST-030', 'Samsung 1TB SSD', 5, 'Samsung', 'Available', 'With Hard Pouch', 1);

-- 3.5 mm Headphones #1
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-031', '3.5 mm Headphones', 5, 'Available', 1);

-- 3.5 mm Headphones #2
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-032', '3.5 mm Headphones', 5, 'Available', 1);

-- USB-C Headphones
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-033', 'USB-C Headphones', 5, 'Available', 1);

-- ──────────────────────────────────────────────────────────────
-- COMMUNICATION (category_id = 7)
-- ──────────────────────────────────────────────────────────────

-- Office SIM Card #1
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-034', 'Office SIM Card', 7, 'Available', 1);

-- Office SIM Card #2
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-035', 'Office SIM Card', 7, 'Available', 1);

-- Office SIM Card #3
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-036', 'Office SIM Card', 7, 'Available', 1);

-- ──────────────────────────────────────────────────────────────
-- OFFICE EQUIPMENT (category_id = 6)
-- ──────────────────────────────────────────────────────────────

-- Whiteboard
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-037', 'Whiteboard', 6, 'Available', 1);

-- Plastic Mini Stool
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-038', 'Plastic Mini Stool', 6, 'Available', 1);

-- ──────────────────────────────────────────────────────────────
-- PRODUCTION ACCESSORIES (category_id = 8)
-- ──────────────────────────────────────────────────────────────

-- Clapboard
INSERT INTO assets (asset_id, asset_name, category_id, status, created_by)
VALUES ('AST-039', 'Clapboard', 8, 'Available', 1);
