const Notification = require('../models/Notification')
const notificationService = require('../services/notificationService')
const User = require('../models/User')

// ── GET /api/notifications ──────────────────────────────────────────────────
// Listar notificaciones del usuario autenticado (paginadas)
// Query: ?page=1&limit=20&unreadOnly=false&type=nuevo_match
const getNotifications = async (req, res) => {
  try {
    const user = req.user
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))
    const unreadOnly = req.query.unreadOnly === 'true'
    const type = req.query.type || null

    const result = await Notification.getPaginated(user._id, {
      page,
      limit,
      unreadOnly,
      type
    })

    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    console.error('[Notifications] Error al obtener notificaciones:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener notificaciones'
    })
  }
}

// ── GET /api/notifications/unread-count ─────────────────────────────────────
// Solo el contador de no leídas (para polling liviano)
const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.getUnreadCount(req.user._id)

    res.json({
      success: true,
      unreadCount
    })
  } catch (error) {
    console.error('[Notifications] Error al obtener contador:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener contador de notificaciones'
    })
  }
}

// ── POST /api/notifications/read ────────────────────────────────────────────
// Marcar una notificación como leída
// Body: { notificationId }
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.body

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere notificationId'
      })
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: req.user._id },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    )

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notificación no encontrada'
      })
    }

    // Emitir nuevo conteo por SSE
    const unreadCount = await Notification.getUnreadCount(req.user._id)
    notificationService.emitUnreadCount(req.user._id, unreadCount)

    res.json({
      success: true,
      notification,
      unreadCount
    })
  } catch (error) {
    console.error('[Notifications] Error al marcar como leída:', error)
    res.status(500).json({
      success: false,
      message: 'Error al marcar notificación como leída'
    })
  }
}

// ── POST /api/notifications/read-all ────────────────────────────────────────
// Marcar todas las notificaciones como leídas
const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.markAllRead(req.user._id)

    // Emitir nuevo conteo (0) por SSE
    notificationService.emitUnreadCount(req.user._id, 0)

    res.json({
      success: true,
      message: `${result.modifiedCount} notificaciones marcadas como leídas`,
      modifiedCount: result.modifiedCount
    })
  } catch (error) {
    console.error('[Notifications] Error al marcar todas como leídas:', error)
    res.status(500).json({
      success: false,
      message: 'Error al marcar notificaciones como leídas'
    })
  }
}

// ── DELETE /api/notifications/:id ───────────────────────────────────────────
// Eliminar una notificación propia
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id
    })

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notificación no encontrada'
      })
    }

    // Actualizar conteo SSE
    const unreadCount = await Notification.getUnreadCount(req.user._id)
    notificationService.emitUnreadCount(req.user._id, unreadCount)

    res.json({
      success: true,
      message: 'Notificación eliminada'
    })
  } catch (error) {
    console.error('[Notifications] Error al eliminar notificación:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar notificación'
    })
  }
}

// ── DELETE /api/notifications ────────────────────────────────────────────────
// Limpiar todas las notificaciones propias
const clearAll = async (req, res) => {
  try {
    const result = await Notification.clearAll(req.user._id)

    // Emitir conteo 0
    notificationService.emitUnreadCount(req.user._id, 0)

    res.json({
      success: true,
      message: `${result.deletedCount} notificaciones eliminadas`,
      deletedCount: result.deletedCount
    })
  } catch (error) {
    console.error('[Notifications] Error al limpiar notificaciones:', error)
    res.status(500).json({
      success: false,
      message: 'Error al limpiar notificaciones'
    })
  }
}

// ── GET /api/notifications/subscribe ────────────────────────────────────────
// Endpoint SSE: conexión persistente para notificaciones en tiempo real
const subscribe = async (req, res) => {
  try {
    const user = req.user

    // Configurar headers SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Para nginx
    })

    // Enviar un comentario de conexión (heartbeat inicial)
    res.write(': connected\n\n')

    // Registrar este cliente SSE
    notificationService.addSSEClient(user._id, res)

    // Enviar las notificaciones no leídas al conectar
    const unreadCount = await Notification.getUnreadCount(user._id)
    const recentUnread = await Notification.find({
      recipient: user._id,
      read: false
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean({ virtuals: true })

    // Enviar estado inicial
    res.write(`data: ${JSON.stringify({
      type: 'init',
      data: {
        unreadCount,
        recentNotifications: recentUnread
      }
    })}\n\n`)

    // Heartbeat cada 20 segundos para mantener la conexión viva
    // (Render y otros proxies cierran conexiones idle — 20s es seguro)
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 20000)

    // Limpiar al desconectar
    req.on('close', () => {
      clearInterval(heartbeat)
    })
  } catch (error) {
    console.error('[Notifications] Error en SSE subscribe:', error)
    // Si los headers SSE ya fueron enviados no se puede enviar JSON
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error al conectar notificaciones en tiempo real'
      })
    } else {
      res.end()
    }
  }
}

// ── POST /api/notifications/broadcast ───────────────────────────────────────
// Envío masivo de notificaciones (solo admin)
// Body: { roles: ['productor', 'centro_acopio'], title, body, link?, priority? }
const adminBroadcast = async (req, res) => {
  try {
    const { roles, title, body, link, priority } = req.body

    // Validaciones
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de roles destinatarios'
      })
    }

    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere título y cuerpo del mensaje'
      })
    }

    const validRoles = ['productor', 'centro_acopio', 'admin', 'super_admin']
    const invalidRoles = roles.filter(r => !validRoles.includes(r))
    if (invalidRoles.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Roles no válidos: ${invalidRoles.join(', ')}`
      })
    }

    // Crear notificaciones para todos los usuarios con esos roles
    const notifications = await notificationService.createForRole(roles, 'sistema', {
      title: title.trim(),
      body: body.trim(),
      link: link || null,
      priority: priority || 'normal',
      icon: '📢',
      data: {
        broadcastBy: req.user._id,
        broadcastAt: new Date()
      }
    })

    res.json({
      success: true,
      message: `Notificación enviada a ${notifications.length} usuarios`,
      recipientCount: notifications.length,
      targetRoles: roles
    })
  } catch (error) {
    console.error('[Notifications] Error en broadcast:', error)
    res.status(500).json({
      success: false,
      message: 'Error al enviar notificación masiva'
    })
  }
}

// ── POST /api/notifications/send-to-user ────────────────────────────────────
// Enviar notificación a un usuario específico (solo admin)
// Body: { userId, title, body, link?, priority? }
const adminSendToUser = async (req, res) => {
  try {
    const { userId, title, body, link, priority } = req.body

    // Validaciones
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el ID del usuario destinatario'
      })
    }

    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere título y cuerpo del mensaje'
      })
    }

    // Verificar que el usuario existe
    const targetUser = await User.findById(userId).select('name role')
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Usuario destinatario no encontrado'
      })
    }

    // Crear notificación
    const notification = await notificationService.create(userId, 'sistema', {
      title: title.trim(),
      body: body.trim(),
      link: link || null,
      priority: priority || 'normal',
      icon: '📢',
      data: {
        sentBy: req.user._id,
        sentAt: new Date(),
        isDirectMessage: true
      }
    })

    if (!notification) {
      return res.status(500).json({
        success: false,
        message: 'Error al crear la notificación'
      })
    }

    res.json({
      success: true,
      message: `Notificación enviada a ${targetUser.name}`,
      notification: {
        _id: notification._id,
        recipient: targetUser.name,
        title: notification.title,
        createdAt: notification.createdAt
      }
    })
  } catch (error) {
    console.error('[Notifications] Error en sendToUser:', error)
    res.status(500).json({
      success: false,
      message: 'Error al enviar notificación al usuario'
    })
  }
}

// ── GET /api/notifications/admin/all ────────────────────────────────────────
// Listar TODAS las notificaciones del sistema (solo admin, paginadas)
// Query: ?page=1&limit=30&type=&unreadOnly=false&search=
const adminGetAllNotifications = async (req, res) => {
  try {
    const page      = Math.max(1, parseInt(req.query.page)  || 1)
    const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30))
    const skip      = (page - 1) * limit
    const type      = req.query.type      || null
    const unreadOnly = req.query.unreadOnly === 'true'
    const search    = req.query.search?.trim() || null

    // Construir filtro
    const filter = {}
    if (type)       filter.type = type
    if (unreadOnly) filter.read = false

    // Filtro por texto en título/cuerpo
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { body:  { $regex: search, $options: 'i' } }
      ]
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('recipient', 'name email role')
        .lean(),
      Notification.countDocuments(filter)
    ])

    res.json({
      success: true,
      notifications,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + notifications.length < total
    })
  } catch (error) {
    console.error('[Notifications] Error al obtener todas las notificaciones:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener notificaciones del sistema'
    })
  }
}

// ── GET /api/notifications/admin/stats ──────────────────────────────────────
// Estadísticas de notificaciones (solo admin)
const adminGetStats = async (req, res) => {
  try {
    const [totalCount, unreadTotal, byType, recentCount] = await Promise.all([
      // Total de notificaciones en el sistema
      Notification.countDocuments(),
      // Total de no leídas
      Notification.countDocuments({ read: false }),
      // Agrupado por tipo
      Notification.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      // Notificaciones de las últimas 24h
      Notification.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
    ])

    // Stats SSE
    const sseStats = notificationService.getSSEStats()

    res.json({
      success: true,
      stats: {
        totalCount,
        unreadTotal,
        recentCount,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count
          return acc
        }, {}),
        sse: sseStats
      }
    })
  } catch (error) {
    console.error('[Notifications] Error al obtener stats:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas'
    })
  }
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAll,
  subscribe,
  adminBroadcast,
  adminSendToUser,
  adminGetAllNotifications,
  adminGetStats
}
