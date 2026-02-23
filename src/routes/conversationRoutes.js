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
} = require('../controllers/conversationController')

// Todas las rutas de conversación requieren autenticación
router.use(requireAuth, getUser, loadUser)

// POST   /api/conversations          — Iniciar conversación
router.post('/', startConversation)

// GET    /api/conversations           — Mis conversaciones
router.get('/', getMyConversations)

// GET    /api/conversations/unread-count — Total no leídos
router.get('/unread-count', getUnreadTotal)

// GET    /api/conversations/:id/messages — Mensajes de una conversación
router.get('/:id/messages', getMessages)

// POST   /api/conversations/:id/messages — Enviar mensaje
router.post('/:id/messages', sendMessage)

// PATCH  /api/conversations/:id/close    — Cerrar conversación
router.patch('/:id/close', closeConversation)

module.exports = router
