const express = require('express')
const router = express.Router()
const { requireAuth, getUser } = require('../../middleware/clerkAuth')
const { requireAdmin } = require('../../middleware/roleAuth')
const { cacheFor } = require('../middleware/cache')
const analyticsController = require('../controllers/analyticsController')

// Todas las rutas requieren autenticación + rol admin
router.use(requireAuth)
router.use(getUser)
router.use(requireAdmin)

// Cache breve (2 minutos) — los datos cambian pero no necesitan ser en tiempo real
router.use(cacheFor(120))

// GET /api/analytics/overview    — Contadores generales
router.get('/overview', analyticsController.getOverview)

// GET /api/analytics/trends?days=30 — Tendencias diarias
router.get('/trends', analyticsController.getTrends)

// GET /api/analytics/products?limit=10 — Top productos
router.get('/products', analyticsController.getTopProducts)

// GET /api/analytics/locations   — Distribución geográfica
router.get('/locations', analyticsController.getLocationStats)

module.exports = router
