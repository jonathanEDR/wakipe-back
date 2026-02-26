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

    // SEGURIDAD: limitar longitud del mensaje inicial
    if (message.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'El mensaje no puede exceder 1000 caracteres',
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

    // Solo se puede conversar sobre publicaciones disponibles, en_conversacion o reservado
    if (!['disponible', 'en_conversacion', 'reservado'].includes(publication.status)) {
      return res.status(400).json({
        success: false,
        message: 'Esta publicación ya no está disponible',
      })
    }

    // Verificar si ESTE USUARIO ya tiene conversación activa para esta publicación
    const existing = await Conversation.findOne({
      publication: publicationId,
      initiatedBy: user._id,
      status: 'activo',
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

    // Marcar la publicación como en_conversacion si estaba disponible
    // (indica que al menos un interesado contactó)
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

    // SEGURIDAD: limitar longitud del mensaje
    if (text.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'El mensaje no puede exceder 1000 caracteres' })
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
 * Cerrar una conversación con razón enriquecida.
 * Body: { reason } — 'no_acuerdo' | 'sin_respuesta' | 'spam' | 'otro'
 */
const closeConversation = async (req, res) => {
  try {
    const user = req.user
    const { reason } = req.body || {}
    const conversation = await Conversation.findById(req.params.id)
      .populate('publication')

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === user._id.toString()
    )
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    if (conversation.status === 'cerrado') {
      return res.status(400).json({ success: false, message: 'La conversación ya está cerrada' })
    }

    // Cerrar con datos enriquecidos
    const validReasons = ['no_acuerdo', 'sin_respuesta', 'spam', 'otro']
    const safeReason = validReasons.includes(reason) ? reason : 'otro'

    conversation.status = 'cerrado'
    conversation.closedAt = new Date()
    conversation.closedBy = user._id
    conversation.closedReason = safeReason
    await conversation.save()

    // Si no quedan conversaciones activas para la publicación → revertir a 'disponible'
    if (conversation.publication) {
      const activeCount = await Conversation.countDocuments({
        publication: conversation.publication._id || conversation.publication,
        status: 'activo',
      })
      if (activeCount === 0) {
        const pub = await Publication.findById(conversation.publication._id || conversation.publication)
        if (pub && ['en_conversacion', 'reservado'].includes(pub.status)) {
          pub.status = 'disponible'
          await pub.save()
        }
      }
    }

    // Notificar al otro participante
    try {
      const recipientId = conversation.participants.find(
        pId => pId.toString() !== user._id.toString()
      )
      if (recipientId) {
        const pub = conversation.publication
        await notificationService.createFromTemplate(
          recipientId,
          'conversacion_cerrada',
          {
            product: pub?.product || 'publicación',
            reason: reason || 'otro',
          },
          { conversationId: conversation._id, publicationId: pub?._id }
        )
      }
    } catch (err) {
      console.error('[Conversations] Error al notificar cierre:', err.message)
    }

    res.json({ success: true, message: 'Conversación cerrada' })
  } catch (error) {
    console.error('Error closeConversation:', error)
    res.status(500).json({ success: false, message: 'Error al cerrar conversación' })
  }
}

/**
 * POST /api/conversations/:id/reserve
 * El dueño de la publicación marca la publicación como reservada para este interesado.
 */
const reserveConversation = async (req, res) => {
  try {
    const user = req.user
    const conversation = await Conversation.findById(req.params.id)
      .populate('publication')

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    if (conversation.status !== 'activo') {
      return res.status(400).json({ success: false, message: 'La conversación no está activa' })
    }

    const publication = await Publication.findById(conversation.publication._id || conversation.publication)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor de la publicación puede reservar
    if (publication.author.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Solo el dueño de la publicación puede reservar' })
    }

    // Validar transición
    if (!['disponible', 'en_conversacion'].includes(publication.status)) {
      return res.status(400).json({
        success: false,
        message: `No se puede reservar desde estado "${publication.status}"`,
      })
    }

    publication.status = 'reservado'
    await publication.save()

    // Notificar al interesado
    try {
      const interesadoId = conversation.participants.find(
        pId => pId.toString() !== user._id.toString()
      )
      if (interesadoId) {
        await notificationService.createFromTemplate(
          interesadoId,
          'publicacion_reservada',
          { product: publication.product },
          { conversationId: conversation._id, publicationId: publication._id }
        )
      }
    } catch (err) {
      console.error('[Conversations] Error al notificar reserva:', err.message)
    }

    res.json({
      success: true,
      message: `Publicación "${publication.product}" reservada`,
      data: { publicationStatus: 'reservado' },
    })
  } catch (error) {
    console.error('Error reserveConversation:', error)
    res.status(500).json({ success: false, message: 'Error al reservar' })
  }
}

/**
 * POST /api/conversations/:id/agree
 * El dueño de la publicación confirma el acuerdo con este interesado.
 * - Marca la conversación como isAgreed
 * - Cambia pub a 'acordado' con agreedWith
 * - Cierra las demás conversaciones activas con closedReason: 'no_acuerdo'
 */
const agreeConversation = async (req, res) => {
  try {
    const user = req.user
    const conversation = await Conversation.findById(req.params.id)

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversación no encontrada' })
    }

    if (conversation.status !== 'activo') {
      return res.status(400).json({ success: false, message: 'La conversación no está activa' })
    }

    const publication = await Publication.findById(conversation.publication)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor de la publicación puede confirmar acuerdo
    if (publication.author.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Solo el dueño de la publicación puede confirmar acuerdo' })
    }

    // Validar transición
    if (!['en_conversacion', 'reservado'].includes(publication.status)) {
      return res.status(400).json({
        success: false,
        message: `No se puede acordar desde estado "${publication.status}"`,
      })
    }

    // Identificar al interesado
    const interesadoId = conversation.participants.find(
      pId => pId.toString() !== user._id.toString()
    )

    // 1) Marcar esta conversación como acordada
    conversation.isAgreed = true
    conversation.status = 'cerrado'
    conversation.closedAt = new Date()
    conversation.closedBy = user._id
    conversation.closedReason = 'acordado'
    await conversation.save()

    // 2) Actualizar publicación
    publication.status = 'acordado'
    publication.agreedWith = {
      user: interesadoId,
      conversation: conversation._id,
      agreedAt: new Date(),
    }
    await publication.save()

    // 3) Cerrar las demás conversaciones activas de esta publicación
    const otherConversations = await Conversation.find({
      publication: publication._id,
      _id: { $ne: conversation._id },
      status: 'activo',
    })

    for (const otherConv of otherConversations) {
      otherConv.status = 'cerrado'
      otherConv.closedAt = new Date()
      otherConv.closedBy = user._id
      otherConv.closedReason = 'no_acuerdo'
      await otherConv.save()

      // Notificar a los otros interesados
      try {
        const otherUserId = otherConv.participants.find(
          pId => pId.toString() !== user._id.toString()
        )
        if (otherUserId) {
          await notificationService.createFromTemplate(
            otherUserId,
            'otros_interesados_cerrados',
            { product: publication.product },
            { conversationId: otherConv._id, publicationId: publication._id }
          )
        }
      } catch (err) {
        console.error('[Conversations] Error al notificar cierre de otra conv:', err.message)
      }
    }

    // 4) Notificar al interesado elegido
    try {
      if (interesadoId) {
        await notificationService.createFromTemplate(
          interesadoId,
          'acuerdo_confirmado',
          { product: publication.product },
          { conversationId: conversation._id, publicationId: publication._id }
        )
      }
    } catch (err) {
      console.error('[Conversations] Error al notificar acuerdo:', err.message)
    }

    // 5) Notificar al autor también
    try {
      await notificationService.createFromTemplate(
        user._id,
        'publicacion_acordada',
        { product: publication.product, quantity: publication.quantity, unit: publication.unit },
        { publicationId: publication._id }
      )
    } catch (err) {
      console.error('[Conversations] Error al notificar autor:', err.message)
    }

    res.json({
      success: true,
      message: `Acuerdo confirmado para "${publication.product}"`,
      data: { publicationStatus: 'acordado', conversationId: conversation._id },
    })
  } catch (error) {
    console.error('Error agreeConversation:', error)
    res.status(500).json({ success: false, message: 'Error al confirmar acuerdo' })
  }
}

/**
 * GET /api/conversations/publication/:publicationId
 * Lista las conversaciones activas ligadas a una publicación (solo para el autor).
 */
const getConversationsForPublication = async (req, res) => {
  try {
    const user = req.user
    const { publicationId } = req.params

    const publication = await Publication.findById(publicationId)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor puede ver los interesados
    if (publication.author.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    const conversations = await Conversation.find({
      publication: publicationId,
    })
      .populate('participants', 'name avatar role location institution verified')
      .populate('initiatedBy', 'name avatar role')
      .populate('lastMessage.sender', 'name')
      .sort({ 'lastMessage.date': -1 })
      .lean()

    // Enriquecer con info del interesado
    const enriched = conversations.map(conv => {
      const interesado = conv.participants.find(
        p => p._id.toString() !== user._id.toString()
      )
      return {
        ...conv,
        interesado,
        myUnread: conv.unreadCount?.[user._id.toString()] || 0,
      }
    })

    res.json({ success: true, data: enriched })
  } catch (error) {
    console.error('Error getConversationsForPublication:', error)
    res.status(500).json({ success: false, message: 'Error al obtener interesados' })
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
  reserveConversation,
  agreeConversation,
  getConversationsForPublication,
}
