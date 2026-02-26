const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const app = express();

// Render (y cualquier proxy inverso) — necesario para req.ip, secure cookies, etc.
app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
// Soporta múltiples orígenes: Vercel (prod) + localhost (dev).
// FRONTEND_URL puede ser una lista separada por comas, por ej.:
//   FRONTEND_URL=https://wakipe.vercel.app,https://wakipe-preview.vercel.app
const rawOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...rawOrigins,
  'http://localhost:5173', // siempre permitir dev local (puerto por defecto de Vite)
  'http://localhost:5174', // Vite usa este si el 5173 está ocupado
  'http://localhost:4173', // vite preview
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir peticiones sin origin (Postman, curl, mobile, health checks)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Permitir cualquier puerto de localhost en desarrollo (Vite puede usar 5173-5179, etc.)
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
      return callback(null, true);
    }
    // Permitir subdominios de wakipe en vercel.app (solo nuestro proyecto)
    if (/^https:\/\/wakipe[\w-]*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origen no permitido: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// ── SEGURIDAD ────────────────────────────────────────────────────────────────
// Headers de seguridad HTTP (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Desactivar CSP para API pura (el frontend lo maneja)
  crossOriginEmbedderPolicy: false,
}));

// Sanitizar inputs contra inyección NoSQL ($gt, $ne, $where, etc.)
// NOTA: express-mongo-sanitize no es compatible con Express 5 (req.query es read-only).
// Usamos un middleware personalizado que sanitiza body/params con la librería
// y bloquea operadores $ en query params sin necesidad de reasignar req.query.
app.use((req, res, next) => {
  // Sanitizar body (writable en Express 5)
  if (req.body && typeof req.body === 'object') {
    req.body = mongoSanitize.sanitize(req.body, { replaceWith: '_' });
  }
  // Sanitizar params (writable en Express 5)
  if (req.params && typeof req.params === 'object') {
    req.params = mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  }
  // Para req.query (read-only en Express 5): detectar y bloquear operadores $
  if (req.query && typeof req.query === 'object') {
    const queryStr = JSON.stringify(req.query);
    if (queryStr.includes('$')) {
      console.warn(`⚠️  Intento de NoSQL injection en query bloqueado desde IP: ${req.ip} → ${req.method} ${req.path}`);
      return res.status(400).json({ success: false, message: 'Parámetros de consulta inválidos' });
    }
  }
  next();
});

// Proteger contra HTTP Parameter Pollution
app.use(hpp());

// ── RATE LIMITING ────────────────────────────────────────────────────────────
// Límite global: 100 peticiones por minuto por IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas peticiones. Intenta de nuevo en un momento.' },
});
app.use('/api/', globalLimiter);

// Límite estricto para endpoints sensibles (auth, uploads)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados intentos. Espera 15 minutos.' },
});
app.use('/api/users/role', strictLimiter);
app.use('/api/images/upload', strictLimiter);
app.use('/api/images/upload-multiple', strictLimiter);
app.use('/api/notifications/broadcast', strictLimiter);

// Compresión gzip/brotli para todas las respuestas > 1KB
app.use(compression({ threshold: 1024 }));

// Middleware — limitar tamaño del body a 2MB
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Wakipe API funcionando', version: '1.0.0' });
});

const userRoutes         = require('./src/routes/userRoutes');
const catalogRoutes      = require('./src/routes/catalogRoutes');
const publicationRoutes  = require('./src/routes/publicationRoutes');
const matchingRoutes     = require('./src/routes/matchingRoutes');
const conversationRoutes = require('./src/routes/conversationRoutes');
const locationRoutes     = require('./src/routes/locationRoutes');
const imageRoutes        = require('./src/routes/imageRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const analyticsRoutes    = require('./src/routes/analyticsRoutes');

app.use('/api/users',         userRoutes);
app.use('/api/catalogs',      catalogRoutes);
app.use('/api/publications',  publicationRoutes);
app.use('/api/matching',      matchingRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/locations',     locationRoutes);
app.use('/api/images',        imageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics',     analyticsRoutes);

console.log('✅ Rutas registradas: /api/users | catalogs | publications | matching | conversations | locations | images | notifications | analytics');

app.use((req, res) => {
  console.log('Ruta no encontrada:', req.method, req.url);
  res.status(404).json({ 
    success: false, 
    message: `Ruta no encontrada: ${req.method} ${req.url}` 
  });
});

app.use((err, req, res, next) => {
  console.error('Error en la aplicación:', err);

  // SEGURIDAD: nunca exponer error.message en producción
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({ 
    success: false, 
    message: isDev ? err.message : 'Error interno del servidor',
  });
});

module.exports = app;