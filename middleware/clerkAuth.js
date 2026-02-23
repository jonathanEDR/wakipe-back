const { ClerkExpressRequireAuth, createClerkClient } = require('@clerk/clerk-sdk-node');

const requireAuth = ClerkExpressRequireAuth({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Cliente de Clerk para consultar datos del usuario (email, nombre, etc.)
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Middleware que extrae userId y userEmail del token de Clerk.
 *
 * IMPORTANTE: el JWT de Clerk por defecto NO incluye el email en sus claims.
 * Por eso usamos clerkClient.users.getUser() para obtenerlo desde la API de Clerk.
 */
const getUser = async (req, res, next) => {
  try {
    if (req.auth && req.auth.userId) {
      req.userId = req.auth.userId;

      // Obtener email real desde Clerk (no está en el JWT por defecto)
      try {
        const clerkUser = await clerkClient.users.getUser(req.auth.userId);
        req.userEmail = clerkUser.emailAddresses?.[0]?.emailAddress || null;
        req.userFirstName = clerkUser.firstName || null;
        req.userLastName = clerkUser.lastName || null;
        req.userAvatar = clerkUser.imageUrl || null;
      } catch (clerkErr) {
        console.error('Error al obtener usuario de Clerk:', clerkErr.message);
        req.userEmail = null;
      }
    }
    next();
  } catch (error) {
    console.error('Error en auth:', error);
    next(error);
  }
};

module.exports = { requireAuth, getUser };