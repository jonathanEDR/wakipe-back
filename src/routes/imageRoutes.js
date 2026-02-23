const express = require('express');
const router = express.Router();
const { requireAuth, getUser } = require('../../middleware/clerkAuth');
const { requireAdmin } = require('../../middleware/roleAuth');
const { uploadSingle, uploadMultiple, handleUploadError } = require('../middleware/upload');
const imageController = require('../controllers/imageController');

// Todas las rutas requieren autenticación
router.use(requireAuth);
router.use(getUser);

// ── Rutas generales (cualquier usuario autenticado) ──────────────────────────
router.post('/upload', uploadSingle('image'), imageController.uploadImage);
router.post('/upload-multiple', uploadMultiple('images', 5), imageController.uploadMultipleImages);
router.delete('/delete', imageController.deleteImage);
router.post('/delete-multiple', imageController.deleteMultipleImages);

// ── Rutas admin (solo admin/super_admin) ─────────────────────────────────────
router.get('/admin/list', requireAdmin, imageController.adminListImages);
router.get('/admin/stats', requireAdmin, imageController.adminGetStats);
router.delete('/admin/delete', requireAdmin, imageController.adminDeleteImage);
router.post('/admin/delete-multiple', requireAdmin, imageController.adminDeleteMultiple);

// Manejo de errores de upload
router.use(handleUploadError);

module.exports = router;
