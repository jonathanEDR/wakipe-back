const express = require('express')
const router = express.Router()
const locationController = require('../controllers/locationController')
const { cacheFor } = require('../middleware/cache')

// Estos endpoints son públicos (no requieren auth).
// Cache 5 minutos — resultados de geocoding cambian poco.
router.use(cacheFor(300))

// GET /api/locations/reverse?lat=X&lng=Y
router.get('/reverse', locationController.reverseGeocode)

// GET /api/locations/search?q=Cusco
router.get('/search', locationController.searchPlaces)

module.exports = router
