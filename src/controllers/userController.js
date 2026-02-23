const User = require("../models/User");
const notificationService = require('../services/notificationService');

// ============================================
// GESTIÓN DE ROLES Y ONBOARDING
// ============================================

/**
 * Establecer el rol del usuario (onboarding)
 * POST /api/users/role
 */
exports.setRole = async (req, res) => {
  try {
    const { role } = req.body;
    
    // Validar que el rol sea válido
    const validRoles = ['productor', 'centro_acopio'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Rol inválido. Debe ser "productor" o "centro_acopio"'
      });
    }

    // Buscar usuario
    let user = await User.findOne({ clerkId: req.userId });
    
    if (!user) {
      // Usuario nuevo: crear con datos de Clerk disponibles en req (via clerkAuth middleware)
      const fullName = [req.userFirstName, req.userLastName].filter(Boolean).join(' ')

      user = new User({
        clerkId: req.userId,
        email: req.userEmail,
        name: fullName || null,
        avatar: req.userAvatar || null,
        role
      });
    } else {
      // Si ya tiene rol, no permitir cambio (seguridad)
      if (user.role && user.role !== role) {
        return res.status(400).json({
          success: false,
          message: 'Ya tienes un rol asignado. Contacta a soporte para cambios'
        });
      }
      user.role = role;
    }

    await user.save();
    
    res.json({
      success: true,
      message: 'Rol establecido correctamente',
      data: user
    });
  } catch (error) {
    console.error("Error en setRole:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Actualizar perfil del usuario según su rol
 * PUT /api/users/profile
 */
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado"
      });
    }

    // Campos comunes para todos los roles
    const { name, avatar, location } = req.body;
    
    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    if (location) {
      user.location = {
        departamento: location.departamento || user.location?.departamento,
        provincia: location.provincia || user.location?.provincia,
        distrito: location.distrito || user.location?.distrito,
        referencia: location.referencia || user.location?.referencia,
      };
      // Guardar coordenadas GeoJSON si vienen
      if (location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
        user.location.coordinates = {
          type: 'Point',
          coordinates: location.coordinates  // [lng, lat]
        };
      }
    }

    // Campos específicos según el rol
    if (user.role === 'productor') {
      const { products, farmSize } = req.body;
      if (products) user.products = products;
      if (farmSize !== undefined) user.farmSize = farmSize;
    } else if (user.role === 'centro_acopio') {
      const { institution, institutionType, coverageArea } = req.body;
      if (institution) user.institution = institution;
      if (institutionType) user.institutionType = institutionType;
      if (coverageArea) user.coverageArea = coverageArea;
    }

    await user.save();
    
    res.json({
      success: true,
      message: 'Perfil actualizado correctamente',
      data: user
    });
  } catch (error) {
    console.error("Error en updateProfile:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Obtener usuarios por rol
 * GET /api/users/by-role/:role
 */
exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const { verified, departamento, provincia, distrito } = req.query;
    
    // Construir filtro
    const filter = { role };
    
    if (verified !== undefined) {
      filter.verified = verified === 'true';
    }
    
    if (departamento) {
      filter['location.departamento'] = departamento;
    }
    
    if (provincia) {
      filter['location.provincia'] = provincia;
    }
    
    if (distrito) {
      filter['location.distrito'] = distrito;
    }

    const users = await User.find(filter).select('-clerkId');
    
    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error("Error en getUsersByRole:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================
// VERIFICACIÓN DE USUARIOS (SOLO ADMIN)
// ============================================

/**
 * Verificar un usuario (solo admin)
 * PUT /api/users/:id/verify
 */
exports.verifyUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { verified } = req.body; // true o false
    
    const userToVerify = await User.findById(id);
    
    if (!userToVerify) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    userToVerify.verified = verified;
    if (verified) {
      userToVerify.verifiedBy = req.user._id; // Admin que verificó
      userToVerify.verifiedAt = new Date();
    } else {
      userToVerify.verifiedBy = null;
      userToVerify.verifiedAt = null;
    }

    await userToVerify.save();

    // ── Notificar al usuario sobre su verificación ──────────────────────
    try {
      if (verified) {
        await notificationService.createFromTemplate(
          userToVerify._id,
          'usuario_verificado',
          {},
          { verifiedBy: req.user._id }
        )
      }
    } catch (err) {
      console.error('[Users] Error al notificar verificación:', err.message)
    }
    
    res.json({
      success: true,
      message: `Usuario ${verified ? 'verificado' : 'desverificado'} correctamente`,
      data: userToVerify
    });
  } catch (error) {
    console.error("Error en verifyUser:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Banear/desbanear usuario (solo super_admin)
 * PUT /api/users/:id/ban
 */
exports.banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { banned, reason } = req.body;
    
    const userToBan = await User.findById(id);
    
    if (!userToBan) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // No permitir banear a super admins
    if (userToBan.isSuperAdmin()) {
      return res.status(403).json({
        success: false,
        message: 'No se puede banear a un super administrador'
      });
    }

    userToBan.isBanned = banned;
    userToBan.bannedReason = banned ? reason : null;
    
    await userToBan.save();

    // ── Notificar al usuario sobre ban/unban ────────────────────────────
    try {
      if (banned) {
        await notificationService.createFromTemplate(
          userToBan._id,
          'usuario_baneado',
          { reason: reason || null },
          { bannedBy: req.user._id }
        )
      }
    } catch (err) {
      console.error('[Users] Error al notificar ban:', err.message)
    }
    
    res.json({
      success: true,
      message: `Usuario ${banned ? 'baneado' : 'desbaneado'} correctamente`,
      data: userToBan
    });
  } catch (error) {
    console.error("Error en banUser:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Asignar rol de administrador (solo super_admin)
 * PUT /api/users/:id/promote
 */
exports.promoteToAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body; // 'admin' o 'super_admin'
    
    if (!['admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Rol inválido. Debe ser "admin" o "super_admin"'
      });
    }

    const userToPromote = await User.findById(id);
    
    if (!userToPromote) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    userToPromote.role = role;
    await userToPromote.save();
    
    res.json({
      success: true,
      message: `Usuario promovido a ${role} correctamente`,
      data: userToPromote
    });
  } catch (error) {
    console.error("Error en promoteToAdmin:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================
// ENDPOINTS EXISTENTES (MANTENIDOS)
// ============================================

/**
 * Create/update perfil del usuario autenticado
 * POST /api/users/sync
 */
exports.syncUser = async (req, res) => {
  try {
    const { name, age, address, avatar } = req.body;
    let user = await User.findOne({ clerkId: req.userId });
    if (!user) {
      user = new User({
        clerkId: req.userId,
        email: req.userEmail,
        name,
        age,
        address,
        avatar,
      });
    } else {
      user.name = name || user.name;
      user.age = age || user.age;
      user.address = address || user.address;
      user.avatar = avatar || user.avatar;
    }

    await user.save();
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Obtener perfil del usuario autenticado
 * GET /api/users/me
 */
exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Perfil no encontrado",
      });
    }
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Obtener todos los usuarios (público)
 * GET /api/users/all
 */
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-clerkId');
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
