const db = require('../config/db');

/**
 * GET /api/proposal-plans/services
 * List all proposal services with plans, features, and values
 */
exports.listServices = async (req, res) => {
  try {
    const [services] = await db.query(
      'SELECT * FROM proposal_services WHERE deleted = 0 ORDER BY created_at DESC'
    );

    for (const svc of services) {
      const [plans] = await db.query(
        'SELECT * FROM proposal_service_plans WHERE service_id = ? ORDER BY sort_order ASC',
        [svc.id]
      );
      svc.plans = plans;

      const [features] = await db.query(
        'SELECT * FROM proposal_service_features WHERE service_id = ? ORDER BY sort_order ASC',
        [svc.id]
      );
      svc.features = features;

      // Fetch all values for this service
      if (features.length > 0 && plans.length > 0) {
        const featureIds = features.map(f => f.id);
        const [values] = await db.query(
          'SELECT * FROM proposal_plan_values WHERE feature_id IN (?)',
          [featureIds]
        );
        svc.values = values;
      } else {
        svc.values = [];
      }
    }

    return res.json({ services });
  } catch (err) {
    console.error('Proposal plans list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposal-plans/services
 * Create a new service
 */
exports.createService = async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

  try {
    const [result] = await db.query(
      'INSERT INTO proposal_services (name, icon, created_by) VALUES (?, ?, ?)',
      [name.trim(), icon || '🌐', req.user.id]
    );
    const [rows] = await db.query('SELECT * FROM proposal_services WHERE id = ?', [result.insertId]);
    rows[0].plans = [];
    rows[0].features = [];
    rows[0].values = [];
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create proposal service error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposal-plans/services/:id
 * Update service name/icon
 */
exports.updateService = async (req, res) => {
  const { name, icon } = req.body;
  try {
    await db.query('UPDATE proposal_services SET name = ?, icon = ? WHERE id = ?', [name, icon || '🌐', req.params.id]);
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update proposal service error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/proposal-plans/services/:id
 */
exports.deleteService = async (req, res) => {
  try {
    await db.query('UPDATE proposal_services SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete proposal service error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposal-plans/services/:serviceId/plans
 * Add a plan column
 */
exports.addPlan = async (req, res) => {
  const { name, subtitle, price, is_recommended } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Plan name is required' });

  try {
    const [countRows] = await db.query('SELECT COUNT(*) AS cnt FROM proposal_service_plans WHERE service_id = ?', [req.params.serviceId]);
    const sortOrder = countRows[0].cnt;

    const [result] = await db.query(
      'INSERT INTO proposal_service_plans (service_id, name, subtitle, price, is_recommended, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.serviceId, name.trim(), subtitle || null, price || null, is_recommended ? 1 : 0, sortOrder]
    );
    const [rows] = await db.query('SELECT * FROM proposal_service_plans WHERE id = ?', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Add plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposal-plans/plans/:planId
 * Update a plan column
 */
exports.updatePlan = async (req, res) => {
  const { name, subtitle, price, is_recommended } = req.body;
  try {
    await db.query(
      'UPDATE proposal_service_plans SET name = ?, subtitle = ?, price = ?, is_recommended = ? WHERE id = ?',
      [name, subtitle || null, price || null, is_recommended ? 1 : 0, req.params.planId]
    );
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/proposal-plans/plans/:planId
 */
exports.deletePlan = async (req, res) => {
  try {
    await db.query('DELETE FROM proposal_service_plans WHERE id = ?', [req.params.planId]);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposal-plans/services/:serviceId/features
 * Add a feature row
 */
exports.addFeature = async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Feature name is required' });

  try {
    const [countRows] = await db.query('SELECT COUNT(*) AS cnt FROM proposal_service_features WHERE service_id = ?', [req.params.serviceId]);
    const sortOrder = countRows[0].cnt;

    const [result] = await db.query(
      'INSERT INTO proposal_service_features (service_id, name, sort_order) VALUES (?, ?, ?)',
      [req.params.serviceId, name.trim(), sortOrder]
    );
    const [rows] = await db.query('SELECT * FROM proposal_service_features WHERE id = ?', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Add feature error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/proposal-plans/features/:featureId
 */
exports.deleteFeature = async (req, res) => {
  try {
    await db.query('DELETE FROM proposal_service_features WHERE id = ?', [req.params.featureId]);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete feature error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposal-plans/services/:serviceId/values
 * Bulk save all values for a service (feature × plan matrix)
 * Body: { values: [{ feature_id, plan_id, value }] }
 */
exports.saveValues = async (req, res) => {
  const { values } = req.body;
  if (!Array.isArray(values)) return res.status(400).json({ message: 'Values array required' });

  try {
    // Delete existing values for this service's features
    const [features] = await db.query(
      'SELECT id FROM proposal_service_features WHERE service_id = ?',
      [req.params.serviceId]
    );

    if (features.length > 0) {
      const featureIds = features.map(f => f.id);
      await db.query('DELETE FROM proposal_plan_values WHERE feature_id IN (?)', [featureIds]);
    }

    // Insert new values
    if (values.length > 0) {
      const insertValues = values
        .filter(v => v.feature_id && v.plan_id)
        .map(v => [v.feature_id, v.plan_id, v.value || '—']);

      if (insertValues.length > 0) {
        await db.query(
          'INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES ?',
          [insertValues]
        );
      }
    }

    return res.json({ message: 'Values saved' });
  } catch (err) {
    console.error('Save values error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
