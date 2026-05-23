const db = require('../config/db');

// ─── Helper: Generate Pitch Deck ID (PCH-LEADID-###) ─────────────────────────
// e.g. PCH-LD250522001-001 — uses lead_id (without dashes), sequence per lead
async function generatePitchDeckId(leadId) {
  // Get lead_id (format: LD-YYMMDD-###) from the lead
  const [leadRows] = await db.query('SELECT lead_id FROM leads WHERE id = ?', [leadId]);
  const rawLeadId = leadRows[0]?.lead_id || 'UNKNOWN';
  // Strip dashes: LD-250522-001 → LD250522001
  const cleanLeadId = rawLeadId.replace(/-/g, '');

  // Count existing pitch decks for this lead
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM pitch_decks WHERE lead_id = ? AND pitch_deck_id IS NOT NULL`,
    [leadId]
  );
  const seq = String((rows[0]?.cnt || 0) + 1).padStart(3, '0');
  return `PCH-${cleanLeadId}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST all pitch decks
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pd.*,
              l.name AS lead_name,
              l.business_name AS lead_business_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              pdi.name AS industry_name,
              pdi.icon AS industry_icon
       FROM pitch_decks pd
       LEFT JOIN leads l ON l.id = pd.lead_id
       LEFT JOIN users u ON u.id = pd.created_by
       LEFT JOIN pitch_deck_industries pdi ON pdi.id = pd.industry_id
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
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              pdi.name AS industry_name,
              pdi.slug AS industry_slug,
              pdi.icon AS industry_icon,
              pdi.primary_color AS theme_primary,
              pdi.secondary_color AS theme_secondary,
              pdi.accent_color AS theme_accent,
              pdi.light_bg AS theme_light_bg,
              pdi.light_accent AS theme_light_accent,
              pdi.layout_variant,
              pdi.slide_config,
              pdi.img_hero, pdi.img_team, pdi.img_services,
              pdi.img_goals, pdi.img_plans, pdi.img_thanks
       FROM pitch_decks pd
       LEFT JOIN leads l ON l.id = pd.lead_id
       LEFT JOIN users u ON u.id = pd.created_by
       LEFT JOIN pitch_deck_industries pdi ON pdi.id = pd.industry_id
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

    // Service features from JSON column (What We Deliver slide)
    if (deck.service_features_data && typeof deck.service_features_data === 'string') {
      deck.service_features = JSON.parse(deck.service_features_data);
    } else {
      deck.service_features = deck.service_features_data || [];
    }

    // Parse JSON fields
    if (deck.opportunity_stats && typeof deck.opportunity_stats === 'string') {
      deck.opportunity_stats = JSON.parse(deck.opportunity_stats);
    }
    if (deck.ad_investment && typeof deck.ad_investment === 'string') {
      deck.ad_investment = JSON.parse(deck.ad_investment);
    }
    if (deck.investment_summary && typeof deck.investment_summary === 'string') {
      deck.investment_summary = JSON.parse(deck.investment_summary);
    }
    if (deck.why_us && typeof deck.why_us === 'string') {
      deck.why_us = JSON.parse(deck.why_us);
    }
    if (deck.cta_steps && typeof deck.cta_steps === 'string') {
      deck.cta_steps = JSON.parse(deck.cta_steps);
    }
    if (deck.slide_config && typeof deck.slide_config === 'string') {
      deck.slide_config = JSON.parse(deck.slide_config);
    }

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
    lead_id, industry_id, title,
    company_name, company_tagline, company_description, company_logo_url,
    opportunity_intro, opportunity_stats, ad_investment, investment_summary, why_us,
    cta_title, cta_subtitle, cta_steps,
    problems, selected_services, service_features, goals, selected_plans,
    thanks_message, contact_name, contact_email, contact_phone, contact_website,
    status
  } = req.body;

  if (!lead_id) return res.status(400).json({ message: 'Lead is required' });
  if (!title) return res.status(400).json({ message: 'Title is required' });

  try {
    // Generate pitch deck ID
    const pitch_deck_id = await generatePitchDeckId(lead_id);

    // Insert main pitch deck
    const [result] = await db.query(
      `INSERT INTO pitch_decks (pitch_deck_id, lead_id, industry_id, title, company_name, company_tagline, company_description,
        company_logo_url, opportunity_intro, opportunity_stats, ad_investment, investment_summary, why_us,
        cta_title, cta_subtitle, cta_steps,
        thanks_message, contact_name, contact_email, contact_phone, contact_website,
        status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pitch_deck_id,
        lead_id, industry_id || null, title, company_name || null, company_tagline || null,
        company_description || null, company_logo_url || null,
        opportunity_intro || null,
        opportunity_stats ? JSON.stringify(opportunity_stats) : null,
        ad_investment ? JSON.stringify(ad_investment) : null,
        investment_summary ? JSON.stringify(investment_summary) : null,
        why_us ? JSON.stringify(why_us) : null,
        cta_title || null, cta_subtitle || null,
        cta_steps ? JSON.stringify(cta_steps) : null,
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

    // Insert service features (What We Deliver)
    if (service_features && service_features.length > 0) {
      // Store all service features as JSON (supports both linked and template-default items)
      await db.query(
        'UPDATE pitch_decks SET service_features_data = ? WHERE id = ?',
        [JSON.stringify(service_features), deckId]
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
      lead_id, industry_id, title,
      company_name, company_tagline, company_description, company_logo_url,
      opportunity_intro, opportunity_stats, ad_investment, investment_summary, why_us,
      cta_title, cta_subtitle, cta_steps,
      problems, selected_services, service_features, goals, selected_plans,
      thanks_message, contact_name, contact_email, contact_phone, contact_website,
      status
    } = req.body;

    // Update main fields
    await db.query(
      `UPDATE pitch_decks SET
        lead_id = ?, industry_id = ?, title = ?, company_name = ?, company_tagline = ?,
        company_description = ?, company_logo_url = ?,
        opportunity_intro = ?, opportunity_stats = ?, ad_investment = ?,
        investment_summary = ?, why_us = ?, cta_title = ?, cta_subtitle = ?, cta_steps = ?,
        thanks_message = ?, contact_name = ?, contact_email = ?,
        contact_phone = ?, contact_website = ?, status = ?
       WHERE id = ?`,
      [
        lead_id || rows[0].lead_id, industry_id !== undefined ? (industry_id || null) : rows[0].industry_id,
        title || rows[0].title,
        company_name ?? rows[0].company_name, company_tagline ?? rows[0].company_tagline,
        company_description ?? rows[0].company_description, company_logo_url ?? rows[0].company_logo_url,
        opportunity_intro !== undefined ? (opportunity_intro || null) : rows[0].opportunity_intro,
        opportunity_stats !== undefined ? (opportunity_stats ? JSON.stringify(opportunity_stats) : null) : rows[0].opportunity_stats,
        ad_investment !== undefined ? (ad_investment ? JSON.stringify(ad_investment) : null) : rows[0].ad_investment,
        investment_summary !== undefined ? (investment_summary ? JSON.stringify(investment_summary) : null) : rows[0].investment_summary,
        why_us !== undefined ? (why_us ? JSON.stringify(why_us) : null) : rows[0].why_us,
        cta_title !== undefined ? (cta_title || null) : rows[0].cta_title,
        cta_subtitle !== undefined ? (cta_subtitle || null) : rows[0].cta_subtitle,
        cta_steps !== undefined ? (cta_steps ? JSON.stringify(cta_steps) : null) : rows[0].cta_steps,
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

    // Replace service features
    if (service_features !== undefined) {
      await db.query(
        'UPDATE pitch_decks SET service_features_data = ? WHERE id = ?',
        [service_features.length > 0 ? JSON.stringify(service_features) : null, req.params.id]
      );
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
