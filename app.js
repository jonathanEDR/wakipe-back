const express = require('express');
const cors = require('cors');
const app = express();

// Configuración de CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json());

app.use((req, res, next) => {
  next();
});

app.get('/', (req, res) => {
  console.log('Ejecutando ruta: GET /');
  res.json({ status: 'ok', message: 'API funcionando' });
});

console.log('Cargando rutas de usuarios...');
const userRoutes = require('./src/routes/userRoutes');

app.use('/api/users', userRoutes);
console.log('Rutas de usuarios cargadas en /api/users');

console.log('Cargando rutas de catálogos...');
const catalogRoutes = require('./src/routes/catalogRoutes');

app.use('/api/catalogs', catalogRoutes);
console.log('Rutas de catálogos cargadas en /api/catalogs');

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