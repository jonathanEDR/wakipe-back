/**
 * Servicio centralizado de notificaciones.
 *
 * Uso desde cualquier controlador:
 *   const notificationService = require('../services/notificationService');
 *   await notificationService.create(userId, 'nuevo_match', {
 *     title: 'Nuevo match: Papa Nativa',
 *     body: 'Coincide con tu oferta de 500kg — a 12km de ti',
 *     link: '/dashboard/user/matching',
 *     data: { publicationId, matchScore: 85 },
 *     priority: 'high'
 *   });
 */

const Notification = require('../models/Notification')
const { NOTIFICATION_TYPES } = require('../models/Notification')
const User = require('../models/User')

// ─── Clientes SSE conectados ─────────────────────────────────────────────────
// Map<userId (string), Set<Response>>  (un usuario puede tener varias pestañas)
const sseClients = new Map()

// ─── Plantillas predefinidas por tipo ────────────────────────────────────────
const TEMPLATES = {
  nuevo_match: ({ product, distance, matchScore }) => ({
    title: 'Nuevo match encontrado 🎯',
    body: distance
      ? `${product} a ${Math.round(distance)}km de ti (${matchScore}% compatible)`
      : `${product} — ${matchScore}% compatible con tu publicación`,
    icon: '🎯',
    priority: 'high',
    link: '/dashboard/user/matching'
  }),

  nuevo_mensaje: ({ senderName, preview }) => ({
    title: `Nuevo mensaje de ${senderName} 💬`,
    body: preview?.length > 80 ? preview.substring(0, 80) + '…' : (preview || 'Tienes un nuevo mensaje'),
    icon: '💬',
    priority: 'normal',
    link: '/dashboard/user/mensajes'
  }),

  conversacion_iniciada: ({ senderName, product }) => ({
    title: `${senderName} quiere conversar 🤝`,
    body: `Ha iniciado una conversación sobre "${product}"`,
    icon: '🤝',
    priority: 'high',
    link: '/dashboard/user/mensajes'
  }),

  publicacion_reservada: ({ product }) => ({
    title: 'Publicación reservada 🔒',
    body: `Tu solicitud para "${product}" ha sido marcada como reservada`,
    icon: '🔒',
    priority: 'high',
    link: '/dashboard/user/mensajes'
  }),

  acuerdo_confirmado: ({ product }) => ({
    title: '¡Acuerdo confirmado! 🎉',
    body: `¡Felicidades! El acuerdo para "${product}" ha sido confirmado`,
    icon: '🎉',
    priority: 'high',
    link: '/dashboard/user/mensajes'
  }),

  otros_interesados_cerrados: ({ product }) => ({
    title: 'Publicación acordada con otro usuario 📋',
    body: `La publicación "${product}" que consultaste llegó a un acuerdo con otro usuario`,
    icon: '📋',
    priority: 'normal',
    link: '/dashboard/user/mensajes'
  }),

  conversacion_cerrada: ({ product, reason }) => ({
    title: 'Conversación cerrada 🔚',
    body: `La conversación sobre "${product}" fue cerrada${reason && reason !== 'otro' ? `: ${reason.replace('_', ' ')}` : ''}`,
    icon: '🔚',
    priority: 'normal',
    link: '/dashboard/user/mensajes'
  }),

  publicacion_acordada: ({ product, quantity, unit }) => ({
    title: 'Publicación acordada ✅',
    body: `Tu publicación de ${product} (${quantity} ${unit}) fue marcada como acordada`,
    icon: '✅',
    priority: 'normal',
    link: '/dashboard/user/publicaciones'
  }),

  publicacion_cerrada: ({ product }) => ({
    title: 'Publicación cerrada 📦',
    body: `Tu publicación de "${product}" ha sido cerrada`,
    icon: '📦',
    priority: 'low',
    link: '/dashboard/user/publicaciones'
  }),

  usuario_verificado: () => ({
    title: '¡Cuenta verificada! ✅',
    body: 'Un administrador ha verificado tu cuenta. Ya puedes acceder a todas las funcionalidades.',
    icon: '✅',
    priority: 'high',
    link: '/dashboard'
  }),

  usuario_baneado: ({ reason }) => ({
    title: 'Cuenta suspendida ⚠️',
    body: reason
      ? `Tu cuenta ha sido suspendida. Motivo: ${reason}`
      : 'Tu cuenta ha sido suspendida. Contacta al administrador para más información.',
    icon: '⚠️',
    priority: 'high',
    link: null
  }),

  nueva_publicacion_cercana: ({ product, distance, type }) => ({
    title: `Nueva ${type === 'oferta' ? 'oferta' : 'demanda'} cerca 📍`,
    body: `${product} a ${Math.round(distance)}km de ti`,
    icon: '📍',
    priority: 'normal',
    link: '/dashboard/user/publicaciones'
  }),

  sistema: ({ title, body }) => ({
    title: title || 'Aviso del sistema 📢',
    body: body || 'Tienes un nuevo aviso del sistema.',
    icon: '📢',
    priority: 'normal',
    link: null
  })
}

// ─── SSE: Gestión de conexiones ──────────────────────────────────────────────

/**
 * Registrar un cliente SSE
 * @param {string} userId - ID del usuario
 * @param {Response} res - Objeto response de Express (se mantiene abierto)
 */
const addSSEClient = (userId, res) => {
  const id = userId.toString()
  if (!sseClients.has(id)) {
    sseClients.set(id, new Set())
  }
  sseClients.get(id).add(res)

  // Limpiar cuando el cliente se desconecte
  res.on('close', () => {
    const clients = sseClients.get(id)
    if (clients) {
      clients.delete(res)
      if (clients.size === 0) {
        sseClients.delete(id)
      }
    }
  })
}

/**
 * Emitir una notificación por SSE a un usuario específico
 * @param {string} userId - ID del destinatario
 * @param {Object} notification - Documento de notificación
 */
const emit = (userId, notification) => {
  const id = userId.toString()
  const clients = sseClients.get(id)
  if (!clients || clients.size === 0) return

  const payload = JSON.stringify({
    type: 'notification',
    data: notification
  })

  for (const res of clients) {
    try {
      res.write(`data: ${payload}\n\n`)
    } catch (err) {
      // Si falla la escritura, el cliente se desconectó
      clients.delete(res)
    }
  }
}

/**
 * Emitir solo la actualización del contador de no leídas
 * @param {string} userId - ID del destinatario
 * @param {number} unreadCount - Nuevo conteo
 */
const emitUnreadCount = (userId, unreadCount) => {
  const id = userId.toString()
  const clients = sseClients.get(id)
  if (!clients || clients.size === 0) return

  const payload = JSON.stringify({
    type: 'unread_count',
    data: { unreadCount }
  })

  for (const res of clients) {
    try {
      res.write(`data: ${payload}\n\n`)
    } catch (err) {
      clients.delete(res)
    }
  }
}

// ─── Funciones principales ───────────────────────────────────────────────────

/**
 * Crear una notificación para un usuario específico.
 * Guarda en MongoDB y emite por SSE si está conectado.
 *
 * @param {string|ObjectId} recipientId - ID del usuario destinatario
 * @param {string} type - Tipo de notificación (de NOTIFICATION_TYPES)
 * @param {Object} payload - Datos de la notificación
 * @param {string} [payload.title] - Título (si no se provee, usa el template)
 * @param {string} [payload.body] - Cuerpo (si no se provee, usa el template)
 * @param {string} [payload.link] - Ruta frontend
 * @param {string} [payload.icon] - Emoji/ícono
 * @param {string} [payload.priority] - low | normal | high
 * @param {Object} [payload.data] - Datos extra (publicationId, etc.)
 * @param {Date} [payload.expiresAt] - Fecha de expiración
 * @returns {Promise<Object>} Notificación creada
 */
const create = async (recipientId, type, payload = {}) => {
  try {
    // Validar tipo
    if (!NOTIFICATION_TYPES.includes(type)) {
      throw new Error(`Tipo de notificación no válido: ${type}`)
    }

    // Obtener valores del template si existen
    const template = TEMPLATES[type]
    const templateData = template ? template(payload.data || payload) : {}

    // Merge: payload explícito tiene prioridad sobre template
    const notificationData = {
      recipient: recipientId,
      type,
      title: payload.title || templateData.title || 'Notificación',
      body: payload.body || templateData.body || '',
      icon: payload.icon || templateData.icon || '🔔',
      priority: payload.priority || templateData.priority || 'normal',
      link: payload.link !== undefined ? payload.link : (templateData.link || null),
      data: payload.data || {},
      expiresAt: payload.expiresAt || null
    }

    // Guardar en base de datos
    const notification = await Notification.create(notificationData)

    // Emitir por SSE si el usuario está conectado
    emit(recipientId, notification.toJSON())

    return notification
  } catch (error) {
    console.error('[NotificationService] Error al crear notificación:', error.message)
    // No lanzamos el error para que no rompa el flujo del controlador que llama
    return null
  }
}

/**
 * Crear notificaciones para múltiples usuarios.
 * Útil para broadcasts de admin.
 *
 * @param {Array<string|ObjectId>} recipientIds - IDs de los destinatarios
 * @param {string} type - Tipo de notificación
 * @param {Object} payload - Datos de la notificación
 * @returns {Promise<Array>} Notificaciones creadas
 */
const createBulk = async (recipientIds, type, payload = {}) => {
  try {
    if (!NOTIFICATION_TYPES.includes(type)) {
      throw new Error(`Tipo de notificación no válido: ${type}`)
    }

    const template = TEMPLATES[type]
    const templateData = template ? template(payload.data || payload) : {}

    // Preparar documentos para inserción masiva
    const docs = recipientIds.map(recipientId => ({
      recipient: recipientId,
      type,
      title: payload.title || templateData.title || 'Notificación',
      body: payload.body || templateData.body || '',
      icon: payload.icon || templateData.icon || '🔔',
      priority: payload.priority || templateData.priority || 'normal',
      link: payload.link !== undefined ? payload.link : (templateData.link || null),
      data: payload.data || {},
      expiresAt: payload.expiresAt || null
    }))

    // Inserción masiva (mucho más eficiente que crear uno por uno)
    const notifications = await Notification.insertMany(docs)

    // Emitir SSE a cada usuario conectado
    for (const notification of notifications) {
      emit(notification.recipient, notification.toJSON())
    }

    return notifications
  } catch (error) {
    console.error('[NotificationService] Error en createBulk:', error.message)
    return []
  }
}

/**
 * Crear notificaciones para todos los usuarios con un rol específico.
 *
 * @param {string|string[]} roles - Rol o roles a notificar (ej: 'productor', ['productor', 'centro_acopio'])
 * @param {string} type - Tipo de notificación
 * @param {Object} payload - Datos de la notificación
 * @returns {Promise<Array>} Notificaciones creadas
 */
const createForRole = async (roles, type, payload = {}) => {
  try {
    const roleArray = Array.isArray(roles) ? roles : [roles]

    // Buscar usuarios activos con esos roles
    const users = await User.find({
      role: { $in: roleArray },
      isActive: true,
      isBanned: false
    }).select('_id').lean()

    if (users.length === 0) return []

    const recipientIds = users.map(u => u._id)
    return createBulk(recipientIds, type, payload)
  } catch (error) {
    console.error('[NotificationService] Error en createForRole:', error.message)
    return []
  }
}

/**
 * Crear notificación usando un template predefinido.
 * Atajos que simplifican la llamada desde los controladores.
 *
 * @param {string|ObjectId} recipientId - Destinatario
 * @param {string} type - Tipo de notificación
 * @param {Object} templateParams - Parámetros para el template (product, distance, etc.)
 * @param {Object} [extraData] - Datos adicionales para el campo `data`
 * @returns {Promise<Object>}
 */
const createFromTemplate = async (recipientId, type, templateParams = {}, extraData = {}) => {
  const template = TEMPLATES[type]
  if (!template) {
    return create(recipientId, type, { data: extraData })
  }

  const templateResult = template(templateParams)
  return create(recipientId, type, {
    ...templateResult,
    data: { ...templateParams, ...extraData }
  })
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Verificar cuántos clientes SSE están conectados
 * @returns {Object} { totalConnections, uniqueUsers }
 */
const getSSEStats = () => {
  let totalConnections = 0
  for (const clients of sseClients.values()) {
    totalConnections += clients.size
  }
  return {
    totalConnections,
    uniqueUsers: sseClients.size
  }
}

/**
 * Verificar si un usuario específico tiene conexión SSE activa
 * @param {string} userId
 * @returns {boolean}
 */
const isUserConnected = (userId) => {
  const clients = sseClients.get(userId.toString())
  return clients ? clients.size > 0 : false
}

// ─── Exportar ────────────────────────────────────────────────────────────────
module.exports = {
  // Funciones principales
  create,
  createBulk,
  createForRole,
  createFromTemplate,

  // SSE
  addSSEClient,
  emit,
  emitUnreadCount,
  getSSEStats,
  isUserConnected,

  // Constantes
  TEMPLATES,
  sseClients
}
