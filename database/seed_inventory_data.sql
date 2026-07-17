USE crm_task_module;

-- ============================================================
-- Inventory Module - Seed Data
-- Run this AFTER migration_inventory_v2.sql
-- Replace created_by = 1 with your admin user ID if different
-- ============================================================

-- Clear existing inventory data (optional - uncomment if needed)
-- DELETE FROM inventory_transactions;
-- DELETE FROM inventories;

-- ─── Stationery ───────────────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Notepad', 'Stationery', 'Nos', 19, 30, 0, 1),
('Mini Notepad', 'Stationery', 'Nos', 3, 5, 0, 1),
('Pens', 'Stationery', 'Nos', 8, 15, 0, 1),
('Pencil', 'Stationery', 'Nos', 10, 10, 0, 1),
('Eraser', 'Stationery', 'Nos', 1, 2, 0, 1),
('Sharpener', 'Stationery', 'Nos', 1, 2, 0, 1),
('Steel Scale', 'Stationery', 'Nos', 1, 2, 0, 1),
('Sticky Notes', 'Stationery', 'Pads', 1, 2, 0, 1),
('Whiteboard Duster', 'Stationery', 'Nos', 1, 1, 0, 1),
('Whiteboard Marker (Blue)', 'Stationery', 'Nos', 2, 2, 0, 1),
('Whiteboard Marker (Black)', 'Stationery', 'Nos', 1, 2, 0, 1),
('Permanent Marker (Black)', 'Stationery', 'Nos', 1, 2, 0, 1);

-- ─── Office Supplies ──────────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Cello Tape', 'Office Supplies', 'Rolls', 1, 2, 0, 1),
('1-inch Packing Tape', 'Office Supplies', 'Rolls', 1, 2, 0, 1),
('Cello Big Packing Tape', 'Office Supplies', 'Rolls', 1, 2, 0, 1),
('Stapler', 'Office Supplies', 'Nos', 1, 1, 0, 1),
('Stapler Pin Box', 'Office Supplies', 'Boxes', 2, 2, 0, 1),
('Fevicol', 'Office Supplies', 'Bottles', 1, 2, 0, 1),
('Scissors', 'Office Supplies', 'Nos', 1, 1, 0, 1),
('Price Sticker Sheets', 'Office Supplies', 'Sheets', 40, 20, 0, 1);

-- ─── Fasteners & Mounting ─────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Small Steel Clips', 'Fasteners & Mounting', 'Nos', 25, 37, 0, 1),
('Large Steel Clips', 'Fasteners & Mounting', 'Nos', 48, 24, 0, 1),
('Big Plastic Clips', 'Fasteners & Mounting', 'Nos', 10, 10, 0, 1),
('Wall Hooks', 'Fasteners & Mounting', 'Nos', 7, 5, 0, 1);

-- ─── Cleaning Supplies ────────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Colin Cleaner', 'Cleaning Supplies', 'Bottles', 1, 1, 0, 1),
('Air Room Spray', 'Cleaning Supplies', 'Bottles', 1, 1, 0, 1),
('Tissue Roll', 'Cleaning Supplies', 'Rolls', 1, 2, 0, 1),
('Tissue Box', 'Cleaning Supplies', 'Boxes', 1, 2, 0, 1),
('Screen Cleaning Kit', 'Cleaning Supplies', 'Kit', 1, 1, 0, 1);

-- ─── Batteries ────────────────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('AA Battery', 'Batteries', 'Cells', 4, 10, 0, 1),
('AAA Battery', 'Batteries', 'Cells', 4, 10, 0, 1);

-- ─── Office Accessories ───────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Laptop Mini Stand', 'Office Accessories', 'Nos', 3, 2, 0, 1),
('Mini Toolkit', 'Office Accessories', 'Kit', 1, 1, 0, 1);

-- ─── Company Seals ────────────────────────────────────────────────────────────
INSERT INTO inventories (item_name, category, unit, quantity, min_stock_alert, unit_price, created_by) VALUES
('Scaleforge Director Seal', 'Company Seals', 'Nos', 1, 1, 0, 1),
('Affixx Media Seal', 'Company Seals', 'Nos', 1, 1, 0, 1);

-- ─── Create initial "stock_in" transactions for all seeded items ──────────────
INSERT INTO inventory_transactions (inventory_id, type, quantity, transaction_date, remarks, created_by)
SELECT id, 'stock_in', quantity, CURDATE(), 'Initial stock (seed data)', 1
FROM inventories
WHERE deleted = 0 AND quantity > 0
  AND id NOT IN (SELECT DISTINCT inventory_id FROM inventory_transactions);
