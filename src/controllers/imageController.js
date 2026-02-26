/**
 * Controlador centralizado de imágenes.
 * Expone endpoints genéricos que cualquier módulo del frontend puede usar.
 */

const imageService = require('../services/imageService');
const { cloudinary } = require('../config/cloudinary');
const Publication = require('../models/Publication');
const User = require('../models/User');

/**
 * POST /api/images/upload
 * Sube una sola imagen.
 * Body: multipart/form-data con campo "image" + campo "folder" (opcional) + campo "preset" (opcional)
 */
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se proporcionó imagen' });
    }

    const validation = imageService.validate(req.file);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // SEGURIDAD: solo permitir carpetas predefinidas (whitelist)
    const ALLOWED_FOLDERS = Object.keys(imageService.FOLDERS);
    const folderKey = req.body.folder || 'general';
    if (!ALLOWED_FOLDERS.includes(folderKey)) {
      return res.status(400).json({ success: false, message: `Carpeta inválida. Opciones: ${ALLOWED_FOLDERS.join(', ')}` });
    }

    const folder = folderKey;
    const preset = req.body.preset || 'medium';

    const result = await imageService.upload(req.file.buffer, { folder, preset });

    res.status(200).json({
      success: true,
      message: 'Imagen subida exitosamente',
      data: result,
    });
  } catch (error) {
    console.error('Error subiendo imagen:', error);
    res.status(500).json({ success: false, message: 'Error al subir la imagen' });
  }
};

/**
 * POST /api/images/upload-multiple
 * Sube múltiples imágenes.
 * Body: multipart/form-data con campo "images" (array) + "folder" + "preset"
 */
const uploadMultipleImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No se proporcionaron imágenes' });
    }

    // Validar cada archivo
    for (const file of req.files) {
      const validation = imageService.validate(file);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }
    }

    // SEGURIDAD: solo permitir carpetas predefinidas (whitelist)
    const ALLOWED_FOLDERS = Object.keys(imageService.FOLDERS);
    const folderKey = req.body.folder || 'general';
    if (!ALLOWED_FOLDERS.includes(folderKey)) {
      return res.status(400).json({ success: false, message: `Carpeta inválida. Opciones: ${ALLOWED_FOLDERS.join(', ')}` });
    }

    const folder = folderKey;
    const preset = req.body.preset || 'medium';
    const buffers = req.files.map(f => f.buffer);

    const results = await imageService.uploadMultiple(buffers, { folder, preset });

    res.status(200).json({
      success: true,
      message: `${results.length} imagen(es) subida(s) exitosamente`,
      data: results,
    });
  } catch (error) {
    console.error('Error subiendo imágenes:', error);
    res.status(500).json({ success: false, message: 'Error al subir las imágenes' });
  }
};

/**
 * DELETE /api/images/:publicId
 * Elimina una imagen por su publicId.
 * Nota: el publicId puede contener "/" — se envía codificado en URL.
 */
const deleteImage = async (req, res) => {
  try {
    const publicId = req.body.publicId;
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'publicId es requerido' });
    }

    // SEGURIDAD: verificar que la imagen pertenece al usuario autenticado
    const userId = req.userId;
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    // Verificar propiedad: la imagen está en una publicación del usuario o es su avatar
    const ownsInPublication = await Publication.findOne({
      author: user._id,
      'images.publicId': publicId,
    });
    const isOwnAvatar = user.avatar && user.avatar.includes(publicId);

    if (!ownsInPublication && !isOwnAvatar) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para eliminar esta imagen',
      });
    }

    const result = await imageService.destroy(publicId);

    res.status(200).json({
      success: true,
      message: 'Imagen eliminada exitosamente',
      data: result,
    });
  } catch (error) {
    console.error('Error eliminando imagen:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar la imagen' });
  }
};

/**
 * POST /api/images/delete-multiple
 * Elimina múltiples imágenes.
 * Body: { publicIds: string[] }
 */
const deleteMultipleImages = async (req, res) => {
  try {
    const { publicIds } = req.body;
    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      return res.status(400).json({ success: false, message: 'publicIds es requerido (array)' });
    }

    // SEGURIDAD: verificar propiedad de TODAS las imágenes
    const user = await User.findOne({ clerkId: req.userId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    for (const publicId of publicIds) {
      const ownsInPublication = await Publication.findOne({
        author: user._id,
        'images.publicId': publicId,
      });
      const isOwnAvatar = user.avatar && user.avatar.includes(publicId);

      if (!ownsInPublication && !isOwnAvatar) {
        return res.status(403).json({
          success: false,
          message: `No tienes permiso para eliminar la imagen: ${publicId}`,
        });
      }
    }

    const result = await imageService.destroyMultiple(publicIds);

    res.status(200).json({
      success: true,
      message: 'Imágenes eliminadas exitosamente',
      data: result,
    });
  } catch (error) {
    console.error('Error eliminando imágenes:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar las imágenes' });
  }
};

module.exports = {
  uploadImage,
  uploadMultipleImages,
  deleteImage,
  deleteMultipleImages,
  adminListImages,
  adminGetStats,
  adminDeleteImage,
  adminDeleteMultiple,
};

/**
 * GET /api/images/admin/list
 * Lista imágenes de Cloudinary con paginación y filtro por carpeta.
 * Query: ?folder=wakipe/publications&limit=20&next_cursor=xxx
 */
// Prefijo raíz del proyecto — nunca listar fuera de este scope
const PROJECT_ROOT = 'wakipe';

async function adminListImages(req, res) {
  try {
    const { folder, limit = 20, next_cursor } = req.query;

    // SEGURIDAD: validar que la carpeta esté dentro del scope del proyecto
    const safeFolder = folder && folder.startsWith(PROJECT_ROOT) ? folder : PROJECT_ROOT;

    const options = {
      type: 'upload',
      max_results: Math.min(parseInt(limit) || 20, 100),
      resource_type: 'image',
      prefix: safeFolder,
    };
    if (next_cursor) options.next_cursor = next_cursor;

    const result = await cloudinary.api.resources(options);

    const images = result.resources.map(r => ({
      publicId: r.public_id,
      url: r.url,
      secureUrl: r.secure_url,
      format: r.format,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      folder: r.folder,
      createdAt: r.created_at,
    }));

    res.status(200).json({
      success: true,
      data: images,
      pagination: {
        next_cursor: result.next_cursor || null,
        total: result.rate_limit_remaining,
      },
    });
  } catch (error) {
    console.error('Error listando imágenes (admin):', error);
    res.status(500).json({ success: false, message: 'Error al listar imágenes' });
  }
}

/**
 * GET /api/images/admin/stats
 * Estadísticas de uso derivadas de los propios recursos del proyecto.
 * No usa cloudinary.api.usage() (requiere plan de pago).
 */
async function adminGetStats(req, res) {
  try {
    const folders = Object.keys(imageService.FOLDERS);
    const folderStats = {};
    let totalCount = 0;
    let totalBytes = 0;

    // Por cada carpeta: listar todos los recursos y acumular métricas
    for (const key of folders) {
      const prefix = imageService.FOLDERS[key];
      let count = 0;
      let bytes = 0;
      let cursor = undefined;

      try {
        do {
          const pageOpts = {
            type: 'upload',
            prefix,
            max_results: 500,
            resource_type: 'image',
          };
          if (cursor) pageOpts.next_cursor = cursor;

          const page = await cloudinary.api.resources(pageOpts);
          const resources = page.resources || [];

          count += resources.length;
          bytes += resources.reduce((sum, r) => sum + (r.bytes || 0), 0);
          cursor = page.next_cursor;
        } while (cursor);
      } catch {
        // Si la carpeta no existe o está vacía, continuar
      }

      folderStats[key] = { folder: prefix, count, bytes };
      totalCount += count;
      totalBytes += bytes;
    }

    res.status(200).json({
      success: true,
      data: {
        // Estadísticas calculadas localmente desde los recursos
        usage: {
          storage: { usage: totalBytes },
          resources: { usage: totalCount },
        },
        folders: folderStats,
      },
    });
  } catch (error) {
    console.error('Error obteniendo stats (admin):', error);
    res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
  }
}

/**
 * DELETE /api/images/admin/delete
 * Elimina una imagen (admin). Body: { publicId }
 */
async function adminDeleteImage(req, res) {
  try {
    const { publicId } = req.body;
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'publicId es requerido' });
    }
    const result = await imageService.destroy(publicId);
    res.status(200).json({ success: true, message: 'Imagen eliminada por admin', data: result });
  } catch (error) {
    console.error('Error eliminando imagen (admin):', error);
    res.status(500).json({ success: false, message: 'Error al eliminar' });
  }
}

/**
 * POST /api/images/admin/delete-multiple
 * Elimina múltiples imágenes (admin). Body: { publicIds: string[] }
 */
async function adminDeleteMultiple(req, res) {
  try {
    const { publicIds } = req.body;
    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      return res.status(400).json({ success: false, message: 'publicIds es requerido (array)' });
    }
    const result = await imageService.destroyMultiple(publicIds);
    res.status(200).json({ success: true, message: `${publicIds.length} imágenes eliminadas`, data: result });
  } catch (error) {
    console.error('Error eliminando imágenes (admin):', error);
    res.status(500).json({ success: false, message: 'Error al eliminar' });
  }
}
