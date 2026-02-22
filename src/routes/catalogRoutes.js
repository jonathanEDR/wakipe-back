const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');

// Rutas públicas para obtener catálogos
router.get('/products', catalogController.getProducts);
router.get('/units', catalogController.getUnits);
router.get('/institution-types', catalogController.getInstitutionTypes);
router.get('/departamentos', catalogController.getDepartamentos);
router.get('/all', catalogController.getAllCatalogs);

module.exports = router;
