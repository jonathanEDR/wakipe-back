const express = require('express');
const cors = require('cors');
const compression = require('compression');
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
  'http://localhost:5173', // siempre permitir dev local
  'http://localhost:4173', // vite preview
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir peticiones sin origin (Postman, curl, mobile, health checks)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Permitir subdominios *.vercel.app para despliegues de preview
    if (/\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origen no permitido: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Compresión gzip/brotli para todas las respuestas > 1KB
app.use(compression({ threshold: 1024 }));

// Middleware
app.use(express.json());

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
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor',
    error: err.message 
  });
});

module.exports = app;