const Conversation = require('../models/Conversation')
const Publication = require('../models/Publication')
const notificationService = require('../services/notificationService')

/**
 * POST /api/conversations
 * Iniciar una conversación con el autor de una publicación.
 * Body: { publicationId, message }
 */
const startConversation = async (req, res) => {
  try {
    const user = req.user
    const { publicationId, message } = req.body

    if (!publicationId || !message?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere publicationId y un mensaje inicial',
      })
    }

    // Validar publicación
    const publication = await Publication.findById(publicationId).populate('author')
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // No puedes iniciar conversación con tu propia publicación
    if (publication.author._id.toString() === user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'No puedes iniciar una conversación con tu propia publicación',
      })
    }

    // Solo se puede conversar sobre publicaciones disponibles o en_conversacion
    if (!['disponible', 'en_conversacion'].includes(publication.status)) {
      return res.status(400).json({
        success: false,
        message: 'Esta publicación ya no está disponible',
      })
    }

    // Verificar si ya existe una conversación entre estos participantes para esta publicación
    const existing = await Conversation.findOne({
      publication: publicationId,
      participants: { $all: [user._id, publication.author._id] },
    })

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Ya tienes una conversación activa sobre esta publicación',
        conversationId: existing._id,
      })
    }

    // Crear conversación
    const conversation = await Conversation.create({
      publication: publicationId,
      participants: [user._id, publication.author._id],
      initiatedBy: user._id,
      messages: [
        {
          sender: user._id,
          text: message.trim(),
          readBy: [user._id],
        },
      ],
      lastMessage: {
        text: message.trim(),
        sender: user._id,
        date: new Date(),
      },
      unreadCount: new Map([
        [publication.author._id.toString(), 1],
        [user._id.toString(), 0],
      ]),
    })

    // Actualizar estado de la publicación si estaba disponible
    if (publication.status === 'disponible') {
      publication.status = 'en_conversacion'
      await publication.save()
    }

    // Poblar datos para la respuesta
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'name avatar role location institution')
      .populate('publication', 'product type quantity unit status')

    // ── Notificar al dueño de la publicación ──────────────────────────────
    try {
      await notificationService.createFromTemplate(
        publication.author._id,
        'conversacion_iniciada',
        {
          senderName: user.name || 'Un usuario',
          product: publication.product
        },
        { conversationId: conversation._id, publicationId: publication._id }
      )
    } catch (err) {
      console.error('[Conversations] Error al notificar conversación iniciada:', err.message)
    }

    res.status(201).json({ success: true, data: populated })
  } catch (error) {
    console.error('Error startConversation:', error)
    res.status(500).json({ success: false, message: 'Error al iniciar conversación' })
  }
}

/**
 * GET /api/conversations
 * Listar mis conversaciones (ordenadas por último mensaje).
 * Query: ?status=activo|cerrado&page=1&limit=20
 */
const getMyConversations = async (req, res) => {
  try {
    const user = req.user
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))

    const filter = { participants: user._id }
    if (req.query.status) filter.status = req.query.status

    const total = await Conversation.countDocuments(filter)
    const conversations = await Conversation.find(filter)
      .populate('participants', 'name avatar role location institution')
      .populate('publication', 'product type quantity unit status')
      .populate('lastMessage.sender', 'name')
      .sort({ 'lastMessage.date': -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()

    // Añadir unreadCount para el usuario actual
    const withUnread = conversations.map(c => ({
      ...c,
      myUnread: c.unreadCount?.get?.(user._id.toString()) || c.unreadCount?.[user._id.toString()] || 0,
    }))

    res.json({
      success: true,
      data: withUnread,
      pagination: { page, pages: Math.ceil(total / limit), total },
    })
  } catch (error) {
    console.error('Error getMyConversations:', error)
    res.status(500).json({ success: false, message: 'Error al obtener conversaciones' })
  }
}

/**
 * GET /api/conversations/:id/messages
 * Obtener mensajes de una conversación.
 * Query: ?page=1&limit=50
 */
const getMessages = async (req, res) => {
  try {
    const user = req.user
    const conversation = await Conversation.findById(req.params.id)
      .populate('participants', 'name avatar role')
      .populate('publication', 'product type quantity unit status')
      .populate('messages.sender', 'name avatar')

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    // Solo participantes pueden ver los mensajes
    const isParticipant = conversation.participants.some(
      p => p._id.toString() === user._id.toString()
    )
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    // Marcar mensajes como leídos
    let updated = false
    conversation.messages.forEach(msg => {
      if (!msg.readBy.some(r => r.toString() === user._id.toString())) {
        msg.readBy.push(user._id)
        updated = true
      }
    })
    if (updated) {
      conversation.unreadCount.set(user._id.toString(), 0)
      await conversation.save()
    }

    res.json({
      success: true,
      data: {
        _id: conversation._id,
        publication: conversation.publication,
        participants: conversation.participants,
        status: conversation.status,
        messages: conversation.messages,
      },
    })
  } catch (error) {
    console.error('Error getMessages:', error)
    res.status(500).json({ success: false, message: 'Error al obtener mensajes' })
  }
}

/**
 * POST /api/conversations/:id/messages
 * Enviar un mensaje a una conversación existente.
 * Body: { text }
 */
const sendMessage = async (req, res) => {
  try {
    const user = req.user
    const { text } = req.body

    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío' })
    }

    const conversation = await Conversation.findById(req.params.id)
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    // Solo participantes
    const isParticipant = conversation.participants.some(
      p => p.toString() === user._id.toString()
    )
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    if (conversation.status === 'cerrado') {
      return res.status(400).json({ success: false, message: 'Esta conversación está cerrada' })
    }

    // Agregar mensaje
    const newMessage = {
      sender: user._id,
      text: text.trim(),
      readBy: [user._id],
    }
    conversation.messages.push(newMessage)

    // Actualizar lastMessage
    conversation.lastMessage = {
      text: text.trim(),
      sender: user._id,
      date: new Date(),
    }

    // Incrementar unreadCount para el otro participante
    conversation.participants.forEach(pId => {
      const pid = pId.toString()
      if (pid !== user._id.toString()) {
        const current = conversation.unreadCount.get(pid) || 0
        conversation.unreadCount.set(pid, current + 1)
      }
    })

    await conversation.save()

    // ── Notificar al otro participante del nuevo mensaje ─────────────────
    try {
      const recipientId = conversation.participants.find(
        pId => pId.toString() !== user._id.toString()
      )
      if (recipientId) {
        await notificationService.createFromTemplate(
          recipientId,
          'nuevo_mensaje',
          {
            senderName: user.name || 'Un usuario',
            preview: text.trim()
          },
          { conversationId: conversation._id }
        )
      }
    } catch (err) {
      console.error('[Conversations] Error al notificar nuevo mensaje:', err.message)
    }

    // Poblar el mensaje recién creado para la respuesta
    const saved = conversation.messages[conversation.messages.length - 1]

    res.status(201).json({
      success: true,
      data: {
        _id: saved._id,
        sender: { _id: user._id, name: user.name, avatar: user.avatar },
        text: saved.text,
        createdAt: saved.createdAt,
      },
    })
  } catch (error) {
    console.error('Error sendMessage:', error)
    res.status(500).json({ success: false, message: 'Error al enviar mensaje' })
  }
}

/**
 * PATCH /api/conversations/:id/close
 * Cerrar una conversación.
 */
const closeConversation = async (req, res) => {
  try {
    const user = req.user
    const conversation = await Conversation.findById(req.params.id)

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === user._id.toString()
    )
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    conversation.status = 'cerrado'
    await conversation.save()

    res.json({ success: true, message: 'Conversación cerrada' })
  } catch (error) {
    console.error('Error closeConversation:', error)
    res.status(500).json({ success: false, message: 'Error al cerrar conversación' })
  }
}

/**
 * GET /api/conversations/unread-count
 * Devuelve el total de mensajes no leídos del usuario.
 */
const getUnreadTotal = async (req, res) => {
  try {
    const user = req.user
    const conversations = await Conversation.find({
      participants: user._id,
      status: 'activo',
    }).lean()

    let total = 0
    conversations.forEach(c => {
      const val = c.unreadCount?.get?.(user._id.toString()) || c.unreadCount?.[user._id.toString()] || 0
      total += val
    })

    res.json({ success: true, unread: total })
  } catch (error) {
    console.error('Error getUnreadTotal:', error)
    res.status(500).json({ success: false, message: 'Error al obtener count' })
  }
}

module.exports = {
  startConversation,
  getMyConversations,
  getMessages,
  sendMessage,
  closeConversation,
  getUnreadTotal,
}
