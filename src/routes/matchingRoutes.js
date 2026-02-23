const express = require('express')
const router = express.Router()
const { requireAuth, getUser } = require('../../middleware/clerkAuth')
const { loadUser } = require('../../middleware/roleAuth')
const { getSuggestions, getMatchesForPublication } = require('../controllers/matchingController')

// Todas las rutas de matching requieren autenticación + usuario con rol
router.use(requireAuth, getUser, loadUser)

// GET /api/matching/suggestions — Sugerencias automáticas para mi rol
router.get('/suggestions', getSuggestions)

// GET /api/matching/for/:publicationId — Matches para una publicación específica
router.get('/for/:publicationId', getMatchesForPublication)

module.exports = router
