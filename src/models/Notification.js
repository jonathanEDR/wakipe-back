const mongoose = require('mongoose')

// ── Tipos de notificación disponibles ────────────────────────────────────────
const NOTIFICATION_TYPES = [
  'nuevo_match',              // matching — se encontró una publicación compatible
  'nuevo_mensaje',            // conversations — nuevo mensaje recibido
  'conversacion_iniciada',    // conversations — alguien inició conversación contigo
  'publicacion_acordada',     // publications — tu publicación cambió a "acordado"
  'publicacion_cerrada',      // publications — tu publicación fue cerrada
  'usuario_verificado',       // users (admin) — tu cuenta fue verificada
  'usuario_baneado',          // users (super_admin) — tu cuenta fue suspendida
  'nueva_publicacion_cercana',// publications — nueva publicación cerca de ti
  'sistema'                   // mensajes generales del sistema / admin broadcast
]

const PRIORITY_LEVELS = ['low', 'normal', 'high']

// ── Schema ───────────────────────────────────────────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    // Destinatario de la notificación
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'El destinatario es obligatorio']
    },

    // Tipo de notificación (determina ícono, color, comportamiento)
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: 'Tipo de notificación no válido: {VALUE}'
      },
      required: [true, 'El tipo de notificación es obligatorio']
    },

    // Contenido visible
    title: {
      type: String,
      required: [true, 'El título es obligatorio'],
      trim: true,
      maxlength: [150, 'El título no puede exceder 150 caracteres']
    },
    body: {
      type: String,
      required: [true, 'El cuerpo es obligatorio'],
      trim: true,
      maxlength: [500, 'El cuerpo no puede exceder 500 caracteres']
    },

    // Datos adicionales según el tipo (publicationId, conversationId, matchScore, etc.)
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // Estado de lectura
    read: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date,
      default: null
    },

    // Ruta del frontend a navegar al hacer click
    link: {
      type: String,
      default: null,
      trim: true
    },

    // Ícono visual (emoji o clase CSS)
    icon: {
      type: String,
      default: '🔔'
    },

    // Prioridad para ordenamiento y visual
    priority: {
      type: String,
      enum: {
        values: PRIORITY_LEVELS,
        message: 'Prioridad no válida: {VALUE}'
      },
      default: 'normal'
    },

    // Expiración opcional — MongoDB TTL eliminará automáticamente
    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true // createdAt, updatedAt automáticos
  }
)

// ── Índices de rendimiento ───────────────────────────────────────────────────

// Consulta principal: notificaciones de un usuario, no leídas primero, más recientes primero
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 })

// Historial completo de un usuario ordenado por fecha
notificationSchema.index({ recipient: 1, createdAt: -1 })

// TTL automático de MongoDB: elimina documentos donde expiresAt ya pasó
// Solo aplica a documentos donde expiresAt NO es null
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Filtro por tipo (para la página de notificaciones con filtros)
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 })

// ── Virtuals ─────────────────────────────────────────────────────────────────

// Verificar si la notificación está expirada (útil si el TTL aún no la eliminó)
notificationSchema.virtual('isExpired').get(function () {
  if (!this.expiresAt) return false
  return new Date() > this.expiresAt
})

// Tiempo relativo desde la creación (para display en frontend)
notificationSchema.virtual('timeAgo').get(function () {
  const now = new Date()
  const diff = now - this.createdAt
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Justo ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  if (hours < 24) return `Hace ${hours}h`
  if (days < 7) return `Hace ${days}d`
  return this.createdAt.toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'short'
  })
})

// Asegurar que los virtuals se incluyan al convertir a JSON/Object
notificationSchema.set('toJSON', { virtuals: true })
notificationSchema.set('toObject', { virtuals: true })

// ── Métodos estáticos ────────────────────────────────────────────────────────

/**
 * Marcar todas las notificaciones de un usuario como leídas
 * @param {ObjectId} userId - ID del usuario
 * @returns {Promise<UpdateResult>}
 */
notificationSchema.statics.markAllRead = async function (userId) {
  return this.updateMany(
    { recipient: userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  )
}

/**
 * Obtener el conteo de notificaciones no leídas de un usuario
 * @param {ObjectId} userId - ID del usuario
 * @returns {Promise<number>}
 */
notificationSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({ recipient: userId, read: false })
}

/**
 * Eliminar todas las notificaciones de un usuario
 * @param {ObjectId} userId - ID del usuario
 * @returns {Promise<DeleteResult>}
 */
notificationSchema.statics.clearAll = async function (userId) {
  return this.deleteMany({ recipient: userId })
}

/**
 * Obtener notificaciones paginadas de un usuario
 * @param {ObjectId} userId - ID del usuario
 * @param {Object} options - Opciones de consulta
 * @param {number} options.page - Página (default: 1)
 * @param {number} options.limit - Elementos por página (default: 20)
 * @param {boolean} options.unreadOnly - Solo no leídas (default: false)
 * @param {string} options.type - Filtrar por tipo (default: null)
 * @returns {Promise<{notifications, unreadCount, totalCount, hasMore, page}>}
 */
notificationSchema.statics.getPaginated = async function (userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    type = null
  } = options

  // Construir filtro
  const filter = { recipient: userId }
  if (unreadOnly) filter.read = false
  if (type && NOTIFICATION_TYPES.includes(type)) filter.type = type

  // Ejecutar consultas en paralelo
  const skip = (page - 1) * limit

  const [notifications, totalCount, unreadCount] = await Promise.all([
    this.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    this.countDocuments(filter),
    this.countDocuments({ recipient: userId, read: false })
  ])

  return {
    notifications,
    unreadCount,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    hasMore: skip + notifications.length < totalCount
  }
}

// ── Exportar ─────────────────────────────────────────────────────────────────
module.exports = mongoose.model('Notification', notificationSchema)
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES
module.exports.PRIORITY_LEVELS = PRIORITY_LEVELS
