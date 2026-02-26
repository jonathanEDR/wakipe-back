const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { requireAuth, getUser } = require("../../middleware/clerkAuth");
const { requireRole, requireAdmin, requireSuperAdmin, loadUser } = require("../../middleware/roleAuth");

// ============================================
// RUTAS PROTEGIDAS (requieren autenticación)
// ============================================

// Obtener todos los usuarios (solo autenticados)
router.get("/all", requireAuth, getUser, userController.getUsers);

// Obtener usuarios por rol (solo autenticados, con filtros opcionales)
router.get("/by-role/:role", requireAuth, getUser, userController.getUsersByRole);

// ============================================
// RUTAS DE AUTENTICACIÓN BÁSICA (requieren Clerk auth)
// ============================================

// Obtener mi perfil
router.get("/me", requireAuth, getUser, userController.getMyProfile);

// Sincronizar perfil (legacy - mantener compatibilidad)
router.post("/sync", requireAuth, getUser, userController.syncUser);

// ============================================
// RUTAS DE ONBOARDING Y ROLES
// ============================================

// Establecer rol del usuario (solo primera vez)
router.post("/role", requireAuth, getUser, userController.setRole);

// Actualizar perfil según rol (requiere tener rol asignado)
router.put("/profile", requireAuth, getUser, loadUser, userController.updateProfile);

// Actualizar preferencias de matching
router.put("/match-preferences", requireAuth, getUser, loadUser, userController.updateMatchPreferences);

// ============================================
// RUTAS DE ADMINISTRACIÓN (solo admin o super_admin)
// ============================================

// Verificar/desverificar usuario
router.get("/:id/public", requireAuth, getUser, userController.getUserById);

router.put("/:id/verify", requireAuth, getUser, requireAdmin, userController.verifyUser);

// ============================================
// RUTAS DE SUPER ADMINISTRADOR
// ============================================

// Banear/desbanear usuario
router.put("/:id/ban", requireAuth, getUser, requireSuperAdmin, userController.banUser);

// Promover usuario a admin
router.put("/:id/promote", requireAuth, getUser, requireSuperAdmin, userController.promoteToAdmin);

console.log("Rutas de usuarios configuradas con sistema de roles");

module.exports = router;
