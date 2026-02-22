const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

const requireAuth = ClerkExpressRequireAuth({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const getUser = async (req, res, next) => {
  try {
    if (req.auth && req.auth.userId) {
      req.userId = req.auth.userId;
      req.userEmail = req.auth.claims?.email;
    }
    next();
  } catch (error) {
    console.error('Error en auth:', error);
    next(error);
  }
};

module.exports = { requireAuth, getUser };