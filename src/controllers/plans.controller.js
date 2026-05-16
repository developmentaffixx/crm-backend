const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/plans/services — list all services with their plans
 */
exports.listServices = async (req, res) => {
  try {
    const [services] = await db.query(
      `SELECT * FROM services WHERE deleted = 0 ORDER BY created_at DESC`
    );

    // For each service, fetch plans with features
    for (const service of services) {
      const [plans] = await db.query(
        `SELECT * FROM plans WHERE service_id = ? AND deleted = 0 ORDER BY sort_order ASC, price ASC`,
        [service.id]
      );

      for (const plan of plans) {
        const [features] = await db.query(
          `SELECT * FROM plan_features WHERE plan_id = ? ORDER BY sort_order ASC`,
          [plan.id]
        );
        plan.features = features;
      }

      service.plans = plans;

      // Fetch service-level features (for comparison table)
      const [svcFeatures] = await db.query(
        `SELECT * FROM service_features WHERE service_id = ? ORDER BY sort_order ASC`,
        [service.id]
      );
      service.service_features = svcFeatures;

      // Fetch feature values for each plan
      if (svcFeatures.length > 0 && plans.length > 0) {
        const planIds = plans.map(p => p.id);
        const [values] = await db.query(
          `SELECT * FROM plan_feature_values WHERE plan_id IN (?)`,
          [planIds]
        );
        service.feature_values = values;
      } else {
        service.feature_values = [];
      }
    }

    return res.json({ services });
  } catch (err) {
    console.error('Services list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/plans/services — create a service
 */
exports.createService = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, icon } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO services (name, description, icon, created_by) VALUES (?, ?, ?, ?)`,
      [name, description || null, icon || '🌐', req.user.id]
    );

    const [rows] = await db.query('SELECT * FROM services WHERE id = ?', [result.insertId]);
    rows[0].plans = [];
    rows[0].service_features = [];
    rows[0].feature_values = [];
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Service create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/plans/services/:id — update a service
 */
exports.updateService = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM services WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Service not found' });

    const { name, description, icon, is_active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE services SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [updated] = await db.query('SELECT * FROM services WHERE id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Service update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/plans/services/:id — soft delete a service
 */
exports.deleteService = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM services WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Service not found' });

    await db.query('UPDATE services SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Service deleted' });
  } catch (err) {
    console.error('Service delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PLANS CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/plans/services/:serviceId/plans — create a plan
 */
exports.createPlan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, price, duration, is_popular, features } = req.body;
  const serviceId = req.params.serviceId;

  try {
    // Verify service exists
    const [svc] = await db.query('SELECT id FROM services WHERE id = ? AND deleted = 0', [serviceId]);
    if (svc.length === 0) return res.status(404).json({ message: 'Service not found' });

    // Get next sort order
    const [maxOrder] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM plans WHERE service_id = ? AND deleted = 0',
      [serviceId]
    );

    const [result] = await db.query(
      `INSERT INTO plans (service_id, name, description, price, duration, is_popular, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [serviceId, name, description || null, price || 0, duration || 'monthly', is_popular ? 1 : 0, maxOrder[0].next_order]
    );

    const planId = result.insertId;

    // Insert features
    if (features && features.length > 0) {
      const featureValues = features.map((f, i) => [planId, f.feature, f.value || null, f.is_included !== false ? 1 : 0, i]);
      await db.query(
        'INSERT INTO plan_features (plan_id, feature, value, is_included, sort_order) VALUES ?',
        [featureValues]
      );
    }

    // Return the created plan with features
    const [plan] = await db.query('SELECT * FROM plans WHERE id = ?', [planId]);
    const [planFeatures] = await db.query('SELECT * FROM plan_features WHERE plan_id = ? ORDER BY sort_order', [planId]);
    plan[0].features = planFeatures;

    return res.status(201).json(plan[0]);
  } catch (err) {
    console.error('Plan create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/plans/plans/:id — update a plan
 */
exports.updatePlan = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Plan not found' });

    const { name, description, price, duration, is_popular, features } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (duration !== undefined) updates.duration = duration;
    if (is_popular !== undefined) updates.is_popular = is_popular ? 1 : 0;

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE plans SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    }

    // Replace features if provided
    if (features !== undefined) {
      await db.query('DELETE FROM plan_features WHERE plan_id = ?', [req.params.id]);
      if (features.length > 0) {
        const featureValues = features.map((f, i) => [req.params.id, f.feature, f.value || null, f.is_included !== false ? 1 : 0, i]);
        await db.query(
          'INSERT INTO plan_features (plan_id, feature, value, is_included, sort_order) VALUES ?',
          [featureValues]
        );
      }
    }

    const [plan] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    const [planFeatures] = await db.query('SELECT * FROM plan_features WHERE plan_id = ? ORDER BY sort_order', [req.params.id]);
    plan[0].features = planFeatures;

    return res.json(plan[0]);
  } catch (err) {
    console.error('Plan update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/plans/plans/:id — soft delete a plan
 */
exports.deletePlan = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Plan not found' });

    await db.query('UPDATE plans SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('Plan delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE FEATURES (for comparison table)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/plans/services/:serviceId/features — add a service feature
 */
exports.addServiceFeature = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Feature name is required' });

  try {
    const [maxOrder] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM service_features WHERE service_id = ?',
      [req.params.serviceId]
    );

    const [result] = await db.query(
      'INSERT INTO service_features (service_id, name, sort_order) VALUES (?, ?, ?)',
      [req.params.serviceId, name, maxOrder[0].next_order]
    );

    const [row] = await db.query('SELECT * FROM service_features WHERE id = ?', [result.insertId]);
    return res.status(201).json(row[0]);
  } catch (err) {
    console.error('Service feature add error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/plans/service-features/:id — update a service feature name
 */
exports.updateServiceFeature = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Feature name is required' });

  try {
    await db.query('UPDATE service_features SET name = ? WHERE id = ?', [name, req.params.id]);
    const [row] = await db.query('SELECT * FROM service_features WHERE id = ?', [req.params.id]);
    if (row.length === 0) return res.status(404).json({ message: 'Feature not found' });
    return res.json(row[0]);
  } catch (err) {
    console.error('Service feature update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/plans/service-features/:id — delete a service feature
 */
exports.deleteServiceFeature = async (req, res) => {
  try {
    await db.query('DELETE FROM plan_feature_values WHERE service_feature_id = ?', [req.params.id]);
    await db.query('DELETE FROM service_features WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Feature deleted' });
  } catch (err) {
    console.error('Service feature delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/plans/services/:serviceId/feature-values — bulk update feature values
 * Body: { values: [{ plan_id, service_feature_id, value }] }
 */
exports.updateFeatureValues = async (req, res) => {
  const { values } = req.body;
  if (!values || !Array.isArray(values)) {
    return res.status(400).json({ message: 'values array is required' });
  }

  try {
    // Delete existing values for this service's plans
    const [plans] = await db.query(
      'SELECT id FROM plans WHERE service_id = ? AND deleted = 0',
      [req.params.serviceId]
    );
    if (plans.length > 0) {
      const planIds = plans.map(p => p.id);
      await db.query('DELETE FROM plan_feature_values WHERE plan_id IN (?)', [planIds]);
    }

    // Insert new values
    if (values.length > 0) {
      const insertValues = values
        .filter(v => v.value && v.value !== '—')
        .map(v => [v.plan_id, v.service_feature_id, v.value]);
      if (insertValues.length > 0) {
        await db.query(
          'INSERT INTO plan_feature_values (plan_id, service_feature_id, value) VALUES ?',
          [insertValues]
        );
      }
    }

    return res.json({ message: 'Feature values updated' });
  } catch (err) {
    console.error('Feature values update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
