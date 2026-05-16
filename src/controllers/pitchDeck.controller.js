const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// LIST all pitch decks
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pd.*,
              l.name AS lead_name,
              l.business_name AS lead_business_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM pitch_decks pd
       LEFT JOIN leads l ON l.id = pd.lead_id
       LEFT JOIN users u ON u.id = pd.created_by
       WHERE pd.deleted = 0
       ORDER BY pd.created_at DESC`
    );
    return res.json({ pitchDecks: rows });
  } catch (err) {
    console.error('PitchDeck list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single pitch deck with all related data
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pd.*,
              l.name AS lead_name,
              l.business_name AS lead_business_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM pitch_decks pd
       LEFT JOIN leads l ON l.id = pd.lead_id
       LEFT JOIN users u ON u.id = pd.created_by
       WHERE pd.id = ? AND pd.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Pitch deck not found' });

    const deck = rows[0];

    // Fetch problems (Step 2)
    const [problems] = await db.query(
      'SELECT * FROM pitch_deck_problems WHERE pitch_deck_id = ? ORDER BY type, sort_order',
      [deck.id]
    );
    deck.problems = problems;

    // Fetch selected services (Step 3)
    const [services] = await db.query(
      `SELECT pds.service_id, s.name, s.icon
       FROM pitch_deck_services pds
       JOIN services s ON s.id = pds.service_id
       WHERE pds.pitch_deck_id = ?`,
      [deck.id]
    );
    deck.selected_services = services;

    // Fetch goals (Step 4)
    const [goals] = await db.query(
      'SELECT * FROM pitch_deck_goals WHERE pitch_deck_id = ? ORDER BY month, sort_order',
      [deck.id]
    );
    deck.goals = goals;

    // Fetch selected plans with features (Step 5 & 6)
    const [plans] = await db.query(
      `SELECT pdp.plan_id, p.name, p.description, p.price, p.duration, p.is_popular,
              s.name AS service_name
       FROM pitch_deck_plans pdp
       JOIN plans p ON p.id = pdp.plan_id
       JOIN services s ON s.id = p.service_id
       WHERE pdp.pitch_deck_id = ?`,
      [deck.id]
    );

    // Fetch features for each plan
    for (const plan of plans) {
      const [features] = await db.query(
        'SELECT * FROM plan_features WHERE plan_id = ? ORDER BY sort_order',
        [plan.plan_id]
      );
      plan.features = features;
    }
    deck.selected_plans = plans;

    return res.json(deck);
  } catch (err) {
    console.error('PitchDeck getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE pitch deck
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const {
    lead_id, title,
    company_name, company_tagline, company_description, company_logo_url,
    problems, selected_services, goals, selected_plans,
    thanks_message, contact_name, contact_email, contact_phone, contact_website,
    status
  } = req.body;

  if (!lead_id) return res.status(400).json({ message: 'Lead is required' });
  if (!title) return res.status(400).json({ message: 'Title is required' });

  try {
    // Insert main pitch deck
    const [result] = await db.query(
      `INSERT INTO pitch_decks (lead_id, title, company_name, company_tagline, company_description,
        company_logo_url, thanks_message, contact_name, contact_email, contact_phone, contact_website,
        status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id, title, company_name || null, company_tagline || null,
        company_description || null, company_logo_url || null,
        thanks_message || null, contact_name || null, contact_email || null,
        contact_phone || null, contact_website || null,
        status || 'final', req.user.id
      ]
    );

    const deckId = result.insertId;

    // Insert problems (Step 2)
    if (problems && problems.length > 0) {
      const values = problems.map((p, i) => [deckId, p.type, p.content, i]);
      await db.query(
        'INSERT INTO pitch_deck_problems (pitch_deck_id, type, content, sort_order) VALUES ?',
        [values]
      );
    }

    // Insert selected services (Step 3)
    if (selected_services && selected_services.length > 0) {
      const values = selected_services.map(sId => [deckId, sId]);
      await db.query(
        'INSERT INTO pitch_deck_services (pitch_deck_id, service_id) VALUES ?',
        [values]
      );
    }

    // Insert goals (Step 4)
    if (goals && goals.length > 0) {
      const values = goals.map((g, i) => [deckId, g.month, g.goal, i]);
      await db.query(
        'INSERT INTO pitch_deck_goals (pitch_deck_id, month, goal, sort_order) VALUES ?',
        [values]
      );
    }

    // Insert selected plans (Step 5 & 6)
    if (selected_plans && selected_plans.length > 0) {
      const values = selected_plans.map(pId => [deckId, pId]);
      await db.query(
        'INSERT INTO pitch_deck_plans (pitch_deck_id, plan_id) VALUES ?',
        [values]
      );
    }

    // Return the created deck
    const [deck] = await db.query('SELECT * FROM pitch_decks WHERE id = ?', [deckId]);
    return res.status(201).json(deck[0]);
  } catch (err) {
    console.error('PitchDeck create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE pitch deck
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pitch_decks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pitch deck not found' });

    const {
      lead_id, title,
      company_name, company_tagline, company_description, company_logo_url,
      problems, selected_services, goals, selected_plans,
      thanks_message, contact_name, contact_email, contact_phone, contact_website,
      status
    } = req.body;

    // Update main fields
    await db.query(
      `UPDATE pitch_decks SET
        lead_id = ?, title = ?, company_name = ?, company_tagline = ?,
        company_description = ?, company_logo_url = ?,
        thanks_message = ?, contact_name = ?, contact_email = ?,
        contact_phone = ?, contact_website = ?, status = ?
       WHERE id = ?`,
      [
        lead_id || rows[0].lead_id, title || rows[0].title,
        company_name ?? rows[0].company_name, company_tagline ?? rows[0].company_tagline,
        company_description ?? rows[0].company_description, company_logo_url ?? rows[0].company_logo_url,
        thanks_message ?? rows[0].thanks_message, contact_name ?? rows[0].contact_name,
        contact_email ?? rows[0].contact_email, contact_phone ?? rows[0].contact_phone,
        contact_website ?? rows[0].contact_website, status || rows[0].status,
        req.params.id
      ]
    );

    // Replace problems
    if (problems !== undefined) {
      await db.query('DELETE FROM pitch_deck_problems WHERE pitch_deck_id = ?', [req.params.id]);
      if (problems.length > 0) {
        const values = problems.map((p, i) => [req.params.id, p.type, p.content, i]);
        await db.query(
          'INSERT INTO pitch_deck_problems (pitch_deck_id, type, content, sort_order) VALUES ?',
          [values]
        );
      }
    }

    // Replace services
    if (selected_services !== undefined) {
      await db.query('DELETE FROM pitch_deck_services WHERE pitch_deck_id = ?', [req.params.id]);
      if (selected_services.length > 0) {
        const values = selected_services.map(sId => [req.params.id, sId]);
        await db.query(
          'INSERT INTO pitch_deck_services (pitch_deck_id, service_id) VALUES ?',
          [values]
        );
      }
    }

    // Replace goals
    if (goals !== undefined) {
      await db.query('DELETE FROM pitch_deck_goals WHERE pitch_deck_id = ?', [req.params.id]);
      if (goals.length > 0) {
        const values = goals.map((g, i) => [req.params.id, g.month, g.goal, i]);
        await db.query(
          'INSERT INTO pitch_deck_goals (pitch_deck_id, month, goal, sort_order) VALUES ?',
          [values]
        );
      }
    }

    // Replace plans
    if (selected_plans !== undefined) {
      await db.query('DELETE FROM pitch_deck_plans WHERE pitch_deck_id = ?', [req.params.id]);
      if (selected_plans.length > 0) {
        const values = selected_plans.map(pId => [req.params.id, pId]);
        await db.query(
          'INSERT INTO pitch_deck_plans (pitch_deck_id, plan_id) VALUES ?',
          [values]
        );
      }
    }

    const [updated] = await db.query('SELECT * FROM pitch_decks WHERE id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('PitchDeck update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE pitch deck (soft)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pitch_decks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pitch deck not found' });

    await db.query('UPDATE pitch_decks SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Pitch deck deleted' });
  } catch (err) {
    console.error('PitchDeck delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
