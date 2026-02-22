const { PRODUCTS, UNITS, INSTITUTION_TYPES, DEPARTAMENTOS, ROLES } = require('../config/constants');

/**
 * Obtener lista de productos agrícolas
 * GET /api/catalogs/products
 */
exports.getProducts = (req, res) => {
  res.json({
    success: true,
    data: PRODUCTS
  });
};

/**
 * Obtener unidades de medida
 * GET /api/catalogs/units
 */
exports.getUnits = (req, res) => {
  res.json({
    success: true,
    data: UNITS
  });
};

/**
 * Obtener tipos de instituciones
 * GET /api/catalogs/institution-types
 */
exports.getInstitutionTypes = (req, res) => {
  res.json({
    success: true,
    data: INSTITUTION_TYPES
  });
};

/**
 * Obtener lista de departamentos
 * GET /api/catalogs/departamentos
 */
exports.getDepartamentos = (req, res) => {
  res.json({
    success: true,
    data: DEPARTAMENTOS
  });
};

/**
 * Obtener todos los catálogos
 * GET /api/catalogs/all
 */
exports.getAllCatalogs = (req, res) => {
  res.json({
    success: true,
    data: {
      products: PRODUCTS,
      units: UNITS,
      institutionTypes: INSTITUTION_TYPES,
      departamentos: DEPARTAMENTOS,
      roles: ROLES.filter(r => r !== 'admin' && r !== 'super_admin') // No exponer roles admin
    }
  });
};
