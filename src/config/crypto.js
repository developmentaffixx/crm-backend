const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Symmetric encryption for stored secrets (service credential passwords).
// Uses AES-256-GCM. The key is derived from CREDENTIALS_ENC_KEY if present,
// otherwise falls back to JWT_SECRET so the app still works out of the box.
// Stored format: base64(iv) : base64(authTag) : base64(ciphertext)
// ─────────────────────────────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV size

function getKey() {
  const secret = process.env.CREDENTIALS_ENC_KEY || process.env.JWT_SECRET || 'crm-default-dev-key';
  // Derive a fixed 32-byte key from the secret
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypt a plaintext string. Returns null for empty input.
 * @param {string} plaintext
 * @returns {string|null} "iv:tag:ciphertext" (all base64)
 */
function encrypt(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a value produced by encrypt(). Returns '' for empty/invalid input
 * (never throws, so a single bad row can't break a whole list fetch).
 * @param {string} stored
 * @returns {string}
 */
function decrypt(stored) {
  if (!stored) return '';
  try {
    const [ivB64, tagB64, dataB64] = String(stored).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return '';
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.warn('Credential decrypt failed:', err.message);
    return '';
  }
}

module.exports = { encrypt, decrypt };
