const express = require('express')
const router = express.Router()
const { requireAuth, getUser } = require('../../middleware/clerkAuth')
const ctrl = require('../controllers/publicationController')

// ── Rutas públicas ────────────────────────────────────────────────────────────
// Listar publicaciones (con filtros)
router.get('/', ctrl.getPublications)

// Ver detalle de una publicación
router.get('/:id', ctrl.getPublication)

// ── Rutas autenticadas ────────────────────────────────────────────────────────
// Mis publicaciones
router.get('/my/list', requireAuth, getUser, ctrl.getMyPublications)

// Crear publicación
router.post('/', requireAuth, getUser, ctrl.createPublication)

// Editar publicación (solo autor)
router.put('/:id', requireAuth, getUser, ctrl.updatePublication)

// Cambiar estado (autor o admin)
router.patch('/:id/status', requireAuth, getUser, ctrl.updateStatus)

// Eliminar publicación (autor o admin)
router.delete('/:id', requireAuth, getUser, ctrl.deletePublication)

module.exports = router
