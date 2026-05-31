const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file buffer to Cloudinary.
 *
 * @param {Buffer} buffer        - File buffer from multer memoryStorage
 * @param {string} folder        - Cloudinary folder (e.g. 'crm/logos')
 * @param {string} resourceType  - 'image' | 'raw' | 'auto'
 * @param {string} [publicId]    - Optional fixed public_id (for replaceable files like logo)
 * @returns {Promise<{url: string, public_id: string}>}
 */
async function uploadToCloudinary(buffer, folder, resourceType = 'auto', publicId = null) {
  return new Promise((resolve, reject) => {
    const options = {
      folder,
      resource_type: resourceType,
      // overwrite: true allows replacing a file with the same public_id
      overwrite: true,
    };
    if (publicId) options.public_id = publicId;

    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve({ url: result.secure_url, public_id: result.public_id });
    });

    stream.end(buffer);
  });
}

/**
 * Delete a file from Cloudinary by its public_id.
 * Silently ignores errors (e.g. file already deleted).
 *
 * @param {string} publicId
 * @param {string} resourceType - 'image' | 'raw' | 'video'
 */
async function deleteFromCloudinary(publicId, resourceType = 'image') {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.warn(`Cloudinary delete warning (${publicId}):`, err.message);
  }
}

/**
 * Extract public_id from a Cloudinary URL.
 * e.g. https://res.cloudinary.com/cloud/image/upload/v123/crm/logos/logo.png
 *   → crm/logos/logo
 *
 * Returns null if not a Cloudinary URL.
 */
function extractPublicId(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  try {
    // Remove everything up to and including /upload/vXXXXX/
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return null;
    // Remove file extension
    return match[1].replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
}

module.exports = { uploadToCloudinary, deleteFromCloudinary, extractPublicId };
