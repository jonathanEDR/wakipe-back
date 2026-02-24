const express = require('express')
const router = express.Router()
const { requireAuth, getUser } = require('../../middleware/clerkAuth')
const { loadUser } = require('../../middleware/roleAuth')
const {
  startConversation,
  getMyConversations,
  getMessages,
  sendMessage,
  closeConversation,
  getUnreadTotal,
  reserveConversation,
  agreeConversation,
  getConversationsForPublication,
} = require('../controllers/conversationController')

// Todas las rutas de conversación requieren autenticación
router.use(requireAuth, getUser, loadUser)

// POST   /api/conversations          — Iniciar conversación
router.post('/', startConversation)

// GET    /api/conversations           — Mis conversaciones
router.get('/', getMyConversations)

// GET    /api/conversations/unread-count — Total no leídos
router.get('/unread-count', getUnreadTotal)

// GET    /api/conversations/publication/:publicationId — Interesados por publicación
router.get('/publication/:publicationId', getConversationsForPublication)

// GET    /api/conversations/:id/messages — Mensajes de una conversación
router.get('/:id/messages', getMessages)

// POST   /api/conversations/:id/messages — Enviar mensaje
router.post('/:id/messages', sendMessage)

// POST   /api/conversations/:id/reserve  — Reservar publicación
router.post('/:id/reserve', reserveConversation)

// POST   /api/conversations/:id/agree    — Confirmar acuerdo
router.post('/:id/agree', agreeConversation)

// PATCH  /api/conversations/:id/close    — Cerrar conversación
router.patch('/:id/close', closeConversation)

module.exports = router
