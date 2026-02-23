const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
const { cacheFor } = require('../middleware/cache');

// Rutas públicas para obtener catálogos (cache 1 hora — datos estáticos)
router.use(cacheFor(3600));
router.get('/products', catalogController.getProducts);
router.get('/units', catalogController.getUnits);
router.get('/institution-types', catalogController.getInstitutionTypes);
router.get('/departamentos', catalogController.getDepartamentos);
router.get('/all', catalogController.getAllCatalogs);

module.exports = router;
