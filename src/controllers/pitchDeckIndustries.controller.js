const db = require('../config/db');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// LIST all active industries
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM pitch_deck_industries WHERE is_active = 1 ORDER BY sort_order, name`
    );
    return res.json({ industries: rows });
  } catch (err) {
    console.error('PitchDeckIndustries list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single industry
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM pitch_deck_industries WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Industry not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('PitchDeckIndustries getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE industry
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const {
    name, slug, description, icon,
    primary_color, secondary_color, accent_color, light_bg, light_accent,
    layout_variant, img_hero, img_team, img_services, img_goals, img_plans, img_thanks,
    is_default, sort_order
  } = req.body;

  if (!name) return res.status(400).json({ message: 'Name is required' });

  const generatedSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    const [result] = await db.query(
      `INSERT INTO pitch_deck_industries (name, slug, description, icon, primary_color, secondary_color, accent_color, light_bg, light_accent, layout_variant, img_hero, img_team, img_services, img_goals, img_plans, img_thanks, is_default, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, generatedSlug, description || null, icon || '📊',
        primary_color || '#1a1f4e', secondary_color || '#2b3580',
        accent_color || '#93c5fd', light_bg || '#f7f9fc', light_accent || '#4f46e5',
        layout_variant || 'default',
        img_hero || null, img_team || null, img_services || null,
        img_goals || null, img_plans || null, img_thanks || null,
        is_default ? 1 : 0, sort_order || 0
      ]
    );

    const [created] = await db.query('SELECT * FROM pitch_deck_industries WHERE id = ?', [result.insertId]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('PitchDeckIndustries create error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Industry slug already exists' });
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE industry
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pitch_deck_industries WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Industry not found' });

    const {
      name, description, icon,
      primary_color, secondary_color, accent_color, light_bg, light_accent,
      layout_variant, img_hero, img_team, img_services, img_goals, img_plans, img_thanks,
      is_active, sort_order
    } = req.body;

    await db.query(
      `UPDATE pitch_deck_industries SET
        name = ?, description = ?, icon = ?,
        primary_color = ?, secondary_color = ?, accent_color = ?,
        light_bg = ?, light_accent = ?, layout_variant = ?,
        img_hero = ?, img_team = ?, img_services = ?,
        img_goals = ?, img_plans = ?, img_thanks = ?,
        is_active = ?, sort_order = ?
       WHERE id = ?`,
      [
        name || rows[0].name, description ?? rows[0].description, icon || rows[0].icon,
        primary_color || rows[0].primary_color, secondary_color || rows[0].secondary_color,
        accent_color || rows[0].accent_color, light_bg || rows[0].light_bg,
        light_accent || rows[0].light_accent,
        layout_variant || rows[0].layout_variant,
        img_hero !== undefined ? img_hero : rows[0].img_hero,
        img_team !== undefined ? img_team : rows[0].img_team,
        img_services !== undefined ? img_services : rows[0].img_services,
        img_goals !== undefined ? img_goals : rows[0].img_goals,
        img_plans !== undefined ? img_plans : rows[0].img_plans,
        img_thanks !== undefined ? img_thanks : rows[0].img_thanks,
        is_active !== undefined ? (is_active ? 1 : 0) : rows[0].is_active,
        sort_order ?? rows[0].sort_order,
        req.params.id
      ]
    );

    const [updated] = await db.query('SELECT * FROM pitch_deck_industries WHERE id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('PitchDeckIndustries update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD IMAGE for a specific slide slot
// ─────────────────────────────────────────────────────────────────────────────
exports.uploadImage = async (req, res) => {
  try {
    const { id, slot } = req.params;
    const validSlots = ['img_hero', 'img_team', 'img_services', 'img_goals', 'img_plans', 'img_thanks'];
    if (!validSlots.includes(slot)) return res.status(400).json({ message: 'Invalid image slot' });

    const [rows] = await db.query('SELECT * FROM pitch_deck_industries WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Industry not found' });

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const filename = `industry-${id}-${slot}-${Date.now()}${path.extname(req.file.originalname)}`;
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const url = `/uploads/${filename}`;
    await db.query(`UPDATE pitch_deck_industries SET ${slot} = ? WHERE id = ?`, [url, id]);

    return res.json({ message: 'Image uploaded', url, slot });
  } catch (err) {
    console.error('PitchDeckIndustries uploadImage error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE industry
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pitch_deck_industries WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Industry not found' });
    if (rows[0].is_default) return res.status(400).json({ message: 'Cannot delete the default industry' });

    await db.query('UPDATE pitch_deck_industries SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Industry deactivated' });
  } catch (err) {
    console.error('PitchDeckIndustries delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
