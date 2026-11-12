/**
 * Ads Activation Cron
 * ─────────────────────────────────────────────────────────────────────────────
 * Every 30 minutes, promotes approved ad campaigns whose start date (IST) has
 * arrived to status 'active'. Also runs once shortly after startup to catch up
 * on anything missed while the server was down.
 *
 * The Ads list endpoint also triggers this (throttled), so the page is correct
 * even between cron runs.
 */
const { activateStartedCampaigns } = require('../helpers/adsWorkflow');

const INTERVAL_MS = 30 * 60 * 1000;

async function run() {
  const count = await activateStartedCampaigns();
  if (count > 0) console.log(`✅  Ads activation: ${count} campaign(s) moved to active`);
}

function startAdsActivationCron() {
  setTimeout(run, 20000); // startup catch-up
  setInterval(run, INTERVAL_MS);
}

module.exports = { startAdsActivationCron };
