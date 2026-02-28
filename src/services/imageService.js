/**
 * Servicio centralizado de imágenes con Cloudinary.
 * 
 * Uso desde cualquier controlador:
 *   const imageService = require('../services/imageService');
 *   const result = await imageService.upload(file, { folder: 'publications' });
 *   await imageService.destroy(publicId);
 */

const { cloudinary } = require('../config/cloudinary');

// ─── Carpetas predefinidas por módulo ────────────────────────────────────────
const FOLDERS = {
  publications: 'wakipe/publications',
  avatars: 'wakipe/avatars',
  conversations: 'wakipe/conversations',
  general: 'wakipe/general',
  verification: 'wakipe/verification',
};

// ─── Transformaciones predefinidas ───────────────────────────────────────────
const PRESETS = {
  thumbnail: { width: 150, height: 150, crop: 'fill', quality: 'auto', format: 'webp' },
  medium: { width: 600, height: 600, crop: 'limit', quality: 'auto', format: 'webp' },
  large: { width: 1200, height: 1200, crop: 'limit', quality: 'auto', format: 'webp' },
  avatar: { width: 200, height: 200, crop: 'fill', gravity: 'face', quality: 'auto', format: 'webp' },
  publication: { width: 800, height: 600, crop: 'limit', quality: 'auto', format: 'webp' },
};

// ─── Límites ─────────────────────────────────────────────────────────────────
const LIMITS = {
  maxFileSize: 5 * 1024 * 1024, // 5 MB
  maxFiles: 5,
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
};

/**
 * Sube una imagen a Cloudinary desde un buffer (multer memoryStorage).
 * @param {Buffer|string} source - Buffer del archivo o URL/path local.
 * @param {Object} options
 * @param {string} options.folder - Clave de FOLDERS o ruta personalizada.
 * @param {string} [options.preset] - Clave de PRESETS para transformación al subir.
 * @param {string} [options.publicId] - ID público personalizado.
 * @param {Object} [options.transformation] - Transformación personalizada (overrides preset).
 * @returns {Promise<Object>} { publicId, url, secureUrl, width, height, format, bytes }
 */
const upload = async (source, options = {}) => {
  const folder = FOLDERS[options.folder] || options.folder || FOLDERS.general;
  const transformation = options.transformation || PRESETS[options.preset] || PRESETS.medium;

  const uploadOptions = {
    folder,
    resource_type: 'image',
    transformation,
    ...(options.publicId && { public_id: options.publicId }),
    overwrite: true,
    unique_filename: true,
  };

  return new Promise((resolve, reject) => {
    const callback = (error, result) => {
      if (error) return reject(error);
      resolve(_formatResult(result));
    };

    if (Buffer.isBuffer(source)) {
      const stream = cloudinary.uploader.upload_stream(uploadOptions, callback);
      stream.end(source);
    } else {
      // source es una URL o file path
      cloudinary.uploader.upload(source, uploadOptions, callback);
    }
  });
};

/**
 * Sube múltiples imágenes en paralelo.
 * @param {Array<Buffer|string>} sources
 * @param {Object} options - Mismas opciones que upload().
 * @returns {Promise<Array<Object>>}
 */
const uploadMultiple = async (sources, options = {}) => {
  if (sources.length > LIMITS.maxFiles) {
    throw new Error(`Máximo ${LIMITS.maxFiles} imágenes permitidas`);
  }
  return Promise.all(sources.map(source => upload(source, options)));
};

/**
 * Elimina una imagen por su publicId.
 * @param {string} publicId
 * @returns {Promise<Object>}
 */
const destroy = async (publicId) => {
  if (!publicId) throw new Error('publicId es requerido');
  const result = await cloudinary.uploader.destroy(publicId);
  return result;
};

/**
 * Elimina múltiples imágenes.
 * @param {string[]} publicIds
 * @returns {Promise<Object>}
 */
const destroyMultiple = async (publicIds) => {
  if (!publicIds || publicIds.length === 0) return { deleted: {} };
  const result = await cloudinary.api.delete_resources(publicIds);
  return result;
};

/**
 * Genera una URL optimizada con transformaciones.
 * @param {string} publicId
 * @param {string|Object} presetOrTransformation - Clave de PRESETS u objeto de transformación.
 * @returns {string} URL transformada
 */
const getUrl = (publicId, presetOrTransformation = 'medium') => {
  const transformation =
    typeof presetOrTransformation === 'string'
      ? PRESETS[presetOrTransformation] || PRESETS.medium
      : presetOrTransformation;

  return cloudinary.url(publicId, {
    secure: true,
    transformation,
  });
};

/**
 * Reemplaza una imagen: elimina la anterior y sube la nueva.
 * @param {string|null} oldPublicId - publicId de la imagen a reemplazar (null si no hay).
 * @param {Buffer|string} newSource
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const replace = async (oldPublicId, newSource, options = {}) => {
  // Eliminar anterior si existe
  if (oldPublicId) {
    try {
      await destroy(oldPublicId);
    } catch (err) {
      console.warn('No se pudo eliminar imagen anterior:', err.message);
    }
  }
  return upload(newSource, options);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Valida un archivo antes de subirlo.
 * @param {Object} file - Objeto de archivo de multer { mimetype, size, originalname }.
 * @returns {{ valid: boolean, error?: string }}
 */
const validate = (file) => {
  if (!file) return { valid: false, error: 'No se proporcionó archivo' };

  const ext = file.originalname?.split('.').pop()?.toLowerCase();
  if (!LIMITS.allowedFormats.includes(ext) && !file.mimetype?.startsWith('image/')) {
    return { valid: false, error: `Formato no permitido. Formatos válidos: ${LIMITS.allowedFormats.join(', ')}` };
  }

  if (file.size > LIMITS.maxFileSize) {
    return { valid: false, error: `Archivo demasiado grande. Máximo: ${LIMITS.maxFileSize / 1024 / 1024}MB` };
  }

  return { valid: true };
};

/**
 * Formatea el resultado de Cloudinary a un objeto limpio.
 */
const _formatResult = (result) => ({
  publicId: result.public_id,
  url: result.url,
  secureUrl: result.secure_url,
  width: result.width,
  height: result.height,
  format: result.format,
  bytes: result.bytes,
});

module.exports = {
  upload,
  uploadMultiple,
  destroy,
  destroyMultiple,
  getUrl,
  replace,
  validate,
  FOLDERS,
  PRESETS,
  LIMITS,
};
