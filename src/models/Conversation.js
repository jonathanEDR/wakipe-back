const mongoose = require('mongoose')

// ── Sub-esquema de mensaje ──────────────────────────────────────────────────
const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: [true, 'El mensaje no puede estar vacío'],
      maxlength: [1000, 'El mensaje no puede exceder 1000 caracteres'],
      trim: true,
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true, // createdAt del mensaje
  }
)

// ── Esquema de conversación ─────────────────────────────────────────────────
const conversationSchema = new mongoose.Schema(
  {
    // Publicación que originó la conversación
    publication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Publication',
      required: true,
    },

    // Los dos participantes (autor de la publicación + interesado)
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // Quién inició la conversación (el interesado)
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Mensajes embebidos (para MVP, simple y rápido)
    messages: [messageSchema],

    // Último mensaje para ordenar la lista de conversaciones
    lastMessage: {
      text: { type: String, default: null },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      date: { type: Date, default: null },
    },

    // Estado de la conversación
    status: {
      type: String,
      enum: ['activo', 'cerrado'],
      default: 'activo',
    },

    // Contadores de mensajes no leídos por participante (Map userId → count)
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  {
    timestamps: true,
  }
)

// ── Índices ─────────────────────────────────────────────────────────────────
conversationSchema.index({ participants: 1 })
conversationSchema.index({ publication: 1 })
conversationSchema.index({ 'lastMessage.date': -1 })
conversationSchema.index({ participants: 1, publication: 1 }, { unique: true })

module.exports = mongoose.model('Conversation', conversationSchema)
