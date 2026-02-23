const express = require('express')
const router = express.Router()
const { requireAuth, getUser } = require('../../middleware/clerkAuth')
const { requireUser, requireAdmin } = require('../../middleware/roleAuth')
const notificationController = require('../controllers/notificationController')

// ── SSE: endpoint especial (necesita auth por query param) ───────────────────
// EventSource no soporta headers custom, así que aceptamos token por query param
router.get('/subscribe', (req, res, next) => {
  // Si viene token por query, inyectarlo como header Authorization
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`
  }
  next()
}, requireAuth, getUser, requireUser, notificationController.subscribe)

// Todas las demás rutas requieren autenticación estándar por header
router.use(requireAuth)
router.use(getUser)
router.use(requireUser)

// Listar notificaciones paginadas
router.get('/', notificationController.getNotifications)

// Contador de no leídas (polling liviano)
router.get('/unread-count', notificationController.getUnreadCount)

// Marcar una notificación como leída
router.post('/read', notificationController.markAsRead)

// Marcar todas como leídas
router.post('/read-all', notificationController.markAllAsRead)

// Eliminar una notificación
router.delete('/:id', notificationController.deleteNotification)

// Limpiar todas las notificaciones propias
router.delete('/', notificationController.clearAll)

// ── Rutas de admin ───────────────────────────────────────────────────────────

// Broadcast masivo (solo admin)
router.post('/broadcast', requireAdmin, notificationController.adminBroadcast)

// Enviar notificación a un usuario específico (solo admin)
router.post('/send-to-user', requireAdmin, notificationController.adminSendToUser)

// Todas las notificaciones del sistema (solo admin)
router.get('/admin/all', requireAdmin, notificationController.adminGetAllNotifications)

// Estadísticas de notificaciones (solo admin)
router.get('/admin/stats', requireAdmin, notificationController.adminGetStats)

module.exports = router
