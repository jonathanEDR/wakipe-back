/**
 * Middleware de upload reutilizable.
 * 
 * Uso:
 *   const { uploadSingle, uploadMultiple } = require('../middleware/upload');
 *   router.post('/foto', uploadSingle('image'), controller.handler);
 *   router.post('/fotos', uploadMultiple('images', 5), controller.handler);
 */

const multer = require('multer');
const { LIMITS } = require('../services/imageService');

// Almacenamiento en memoria (buffer) — la subida final la hace imageService a Cloudinary
const storage = multer.memoryStorage();

// Filtro de archivos
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen (jpg, png, webp, gif)'), false);
  }
};

// Instancia base de multer
const multerInstance = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: LIMITS.maxFileSize,
    files: LIMITS.maxFiles,
  },
});

/**
 * Middleware para subir una sola imagen.
 * El archivo estará en req.file
 * @param {string} fieldName - Nombre del campo en el form.
 */
const uploadSingle = (fieldName = 'image') => multerInstance.single(fieldName);

/**
 * Middleware para subir múltiples imágenes.
 * Los archivos estarán en req.files
 * @param {string} fieldName - Nombre del campo en el form.
 * @param {number} maxCount - Máximo de archivos.
 */
const uploadMultiple = (fieldName = 'images', maxCount = LIMITS.maxFiles) =>
  multerInstance.array(fieldName, maxCount);

/**
 * Middleware para subir imágenes de múltiples campos.
 * @param {Array<{name: string, maxCount: number}>} fields
 */
const uploadFields = (fields) => multerInstance.fields(fields);

/**
 * Middleware de manejo de errores de Multer.
 * Colocar DESPUÉS de las rutas que usan upload.
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `El archivo excede el tamaño máximo de ${LIMITS.maxFileSize / 1024 / 1024}MB`,
      LIMIT_FILE_COUNT: `Máximo ${LIMITS.maxFiles} archivos permitidos`,
      LIMIT_UNEXPECTED_FILE: 'Campo de archivo inesperado',
    };
    return res.status(400).json({
      success: false,
      message: messages[err.code] || err.message,
    });
  }

  if (err.message?.includes('Solo se permiten')) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  next(err);
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  uploadFields,
  handleUploadError,
};
