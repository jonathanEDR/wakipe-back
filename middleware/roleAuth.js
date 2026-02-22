const User = require('../src/models/User');

/**
 * Middleware para verificar que el usuario tenga un rol específico
 * @param {Array|String} allowedRoles - Roles permitidos para acceder a la ruta
 * @returns {Function} Middleware de Express
 */
const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      // Verificar que el usuario esté autenticado
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          message: 'No autenticado'
        });
      }

      // Buscar el usuario en la base de datos
      const user = await User.findOne({ clerkId: req.userId });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Usuario no encontrado'
        });
      }

      // Verificar que el usuario tenga un rol asignado
      if (!user.role) {
        return res.status(403).json({
          success: false,
          message: 'Debes completar tu perfil y seleccionar un rol'
        });
      }

      // Verificar que el usuario no esté baneado
      if (user.isBanned) {
        return res.status(403).json({
          success: false,
          message: `Cuenta suspendida${user.bannedReason ? ': ' + user.bannedReason : ''}`
        });
      }

      // Verificar que el usuario tenga uno de los roles permitidos
      const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
      
      if (!rolesArray.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permisos para acceder a este recurso',
          requiredRole: allowedRoles,
          yourRole: user.role
        });
      }

      // Adjuntar el usuario completo al request para uso posterior
      req.user = user;
      next();
    } catch (error) {
      console.error('Error en requireRole middleware:', error);
      res.status(500).json({
        success: false,
        message: 'Error al verificar permisos'
      });
    }
  };
};

/**
 * Middleware para verificar que el usuario sea administrador (admin o super_admin)
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado'
      });
    }

    const user = await User.findOne({ clerkId: req.userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    if (!user.isAdmin()) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Se requieren permisos de administrador'
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: 'Cuenta suspendida'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error en requireAdmin middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar permisos de administrador'
    });
  }
};

/**
 * Middleware para verificar que el usuario sea super administrador
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado'
      });
    }

    const user = await User.findOne({ clerkId: req.userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    if (!user.isSuperAdmin()) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Se requieren permisos de super administrador'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error en requireSuperAdmin middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar permisos de super administrador'
    });
  }
};

/**
 * Middleware opcional que carga el usuario pero no requiere rol específico
 * Útil para rutas que necesitan info del usuario pero son accesibles a todos
 */
const loadUser = async (req, res, next) => {
  try {
    if (req.userId) {
      const user = await User.findOne({ clerkId: req.userId });
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    console.error('Error en loadUser middleware:', error);
    next(); // Continuar aunque falle
  }
};

module.exports = {
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  loadUser
};
