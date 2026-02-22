# Backend - Wakipe (Red Social Agrícola)

API REST para la red social agrícola orientada a la anticipación de oferta y demanda entre productores y centros de acopio.

## 🚀 Tecnologías

- **Node.js** - Runtime de JavaScript
- **Express** - Framework web minimalista
- **MongoDB** - Base de datos NoSQL
- **Mongoose** - ODM para MongoDB
- **Clerk** - Autenticación y gestión de usuarios
- **dotenv** - Gestión de variables de entorno
- **nodemon** - Desarrollo con hot-reload

## 📁 Estructura del Proyecto

```
back/
├── middleware/
│   └── clerkAuth.js        # Autenticación con Clerk
├── src/
│   ├── config/
│   │   └── database.js     # Conexión a MongoDB
│   ├── controllers/
│   │   └── userController.js
│   ├── models/
│   │   └── User.js         # Modelo de usuario
│   └── routes/
│       └── userRoutes.js   # Rutas de usuarios
├── .env                    # Variables de entorno (NO commitear)
├── .env.example            # Ejemplo de variables de entorno
├── app.js                  # Configuración de Express
├── server.js               # Punto de entrada del servidor
└── package.json
```

## 🛠️ Instalación y Configuración

### 1. Instalar dependencias
```bash
cd back
npm install
```

### 2. Configurar variables de entorno
Copia `.env.example` a `.env` y configura las siguientes variables:

```env
# Puerto del servidor
PORT=3000

# MongoDB - Conexión a la base de datos
MONGO_URI=mongodb://localhost:27017/wakipe

# Clerk - Secret Key
CLERK_SECRET_KEY=tu_clerk_secret_key

# Frontend URL (para CORS)
FRONTEND_URL=http://localhost:5173
```

### 3. Iniciar MongoDB localmente
Asegúrate de tener MongoDB instalado y corriendo:
```bash
mongod
```

### 4. Iniciar el servidor

**Modo desarrollo** (con nodemon):
```bash
npm run dev
```

**Modo producción**:
```bash
npm start
```

El servidor estará disponible en: `http://localhost:3000`

## 📡 API Endpoints

### Health Check
```
GET /
```
Verifica que la API esté funcionando.

**Respuesta**:
```json
{
  "status": "ok",
  "message": "API funcionando"
}
```

---

### 📋 Catálogos (Públicos)

#### Obtener todos los catálogos
```
GET /api/catalogs/all
```
Retorna productos, unidades, tipos de instituciones, departamentos y roles.

#### Obtener productos agrícolas
```
GET /api/catalogs/products
```
Lista de productos: Papa, Maíz, Quinua, etc.

#### Obtener unidades de medida
```
GET /api/catalogs/units
```
Unidades: kg, toneladas, sacos, cajas, etc.

#### Obtener tipos de instituciones
```
GET /api/catalogs/institution-types
```
Tipos: cooperativa, centro_acopio, asociacion, etc.

#### Obtener departamentos del Perú
```
GET /api/catalogs/departamentos
```
Lista de 25 departamentos.

---

### 👥 Usuarios

#### Obtener todos los usuarios (público)
```
GET /api/users/all
```

#### Obtener usuarios por rol (público)
```
GET /api/users/by-role/:role
Query params opcionales:
  - verified: true/false
  - departamento: nombre del departamento
  - provincia: nombre de la provincia
  - distrito: nombre del distrito

Ejemplo: GET /api/users/by-role/productor?verified=true&departamento=Lima
```

#### Obtener mi perfil (autenticado)
```
GET /api/users/me
Headers: Authorization: Bearer <token>
```

---

### 🎯 Onboarding y Roles (Autenticado)

#### Establecer rol del usuario (primera vez)
```
POST /api/users/role
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "role": "productor" | "centro_acopio"
}
```

**Nota**: Solo se puede establecer una vez. Para cambios, contactar soporte.

#### Actualizar perfil según rol
```
PUT /api/users/profile
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body (común a todos):
{
  "name": "Juan Pérez",
  "avatar": "https://...",
  "location": {
    "departamento": "Lima",
    "provincia": "Lima",
    "distrito": "Miraflores",
    "referencia": "Cerca del parque"
  }
}

Body adicional para PRODUCTOR:
{
  "products": ["Papa", "Maíz"],
  "farmSize": 5  // hectáreas
}

Body adicional para CENTRO DE ACOPIO:
{
  "institution": "Cooperativa San Juan",
  "institutionType": "cooperativa",
  "coverageArea": ["Distrito A", "Distrito B"]
}
```

#### Sincronizar perfil (legacy - compatibilidad)
```
POST /api/users/sync
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "name": "Juan Pérez",
  "age": 35,
  "address": "Lima, Perú",
  "avatar": "https://..."
}
```

---

### 🔐 Administración (Solo Admin)

#### Verificar/desverificar usuario
```
PUT /api/users/:id/verify
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "verified": true | false
}
```

**Requiere**: Rol `admin` o `super_admin`

---

### ⚡ Super Administrador (Solo Super Admin)

#### Banear/desbanear usuario
```
PUT /api/users/:id/ban
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "banned": true | false,
  "reason": "Motivo del ban" (opcional)
}
```

**Requiere**: Rol `super_admin`

#### Promover usuario a administrador
```
PUT /api/users/:id/promote
Headers: Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "role": "admin" | "super_admin"
}
```

**Requiere**: Rol `super_admin`

## 🔐 Autenticación

El backend usa **Clerk** para autenticación mediante JWT.

### Cómo funciona:
1. El frontend obtiene un token de Clerk con `getToken()`
2. El token se envía en el header `Authorization: Bearer <token>`
3. El middleware `requireAuth` verifica el token
4. El middleware `getUser` extrae `userId` y `userEmail` del token
5. Los controladores acceden a `req.userId` y `req.userEmail`

### Proteger una ruta:
```javascript
router.get('/ruta-protegida', requireAuth, getUser, controller.metodo);
```

## 🗂️ Modelos de Datos

### User (Implementado - Fase 1)
```javascript
{
  // Identificación (Clerk)
  clerkId: String (required, unique),
  email: String (required, unique),
  name: String,
  avatar: String,
  
  // Sistema de roles
  role: String (enum: ['productor', 'centro_acopio', 'admin', 'super_admin']),
  
  // Verificación institucional
  verified: Boolean (default: false),
  verifiedBy: ObjectId (ref: 'User'),  // Admin que verificó
  verifiedAt: Date,
  
  // Ubicación geográfica
  location: {
    departamento: String,
    provincia: String,
    distrito: String,
    referencia: String  // Dirección aproximada
  },
  
  // Campos específicos PRODUCTOR
  products: [String],  // Ej: ["Papa", "Maíz", "Quinua"]
  farmSize: Number,    // Hectáreas
  
  // Campos específicos CENTRO DE ACOPIO
  institution: String,  // Nombre de la cooperativa/centro
  institutionType: String (enum: ['cooperativa', 'centro_acopio', 'asociacion', 'municipalidad', 'agencia_agraria', 'otro']),
  coverageArea: [String],  // Zonas que cubre
  
  // Control de cuentas
  isActive: Boolean (default: true),
  isBanned: Boolean (default: false),
  bannedReason: String,
  
  // Campos legacy (compatibilidad)
  age: Number,
  address: String,
  
  // Timestamps automáticos
  createdAt: Date,
  updatedAt: Date
}
```

**Métodos del modelo**:
- `hasRole(roles)` - Verifica si el usuario tiene un rol específico
- `isAdmin()` - Retorna true si es admin o super_admin
- `isSuperAdmin()` - Retorna true si es super_admin

---

### Próximos Modelos (Según plan)

### Publication (Fase 2 - Próximamente)
```javascript
{
  type: String (enum: ['oferta', 'demanda']),
  author: ObjectId (ref: 'User'),
  authorRole: String,
  product: String,
  quantity: Number,
  unit: String,
  availabilityDate: Date,
  location: { distrito, provincia },
  status: String (enum: ['disponible', 'en_conversacion', 'acordado', 'cerrado']),
  description: String,
  createdAt: Date
}
```

### Conversation (Fase 3 - Próximamente)
```javascript
{
  publication: ObjectId (ref: 'Publication'),
  participants: [ObjectId] (ref: 'User'),
  messages: [{
    sender: ObjectId (ref: 'User'),
    text: String,
    timestamp: Date
  }],
  status: String (enum: ['activo', 'cerrado'])
}
```

## 🔧 Scripts Disponibles

```json
{
  "start": "node server.js",      // Iniciar en producción
  "dev": "nodemon server.js"      // Iniciar en desarrollo
}
```

## 🌐 CORS

El backend está configurado para aceptar peticiones desde:
- `http://localhost:5173` (frontend en desarrollo)
- URL configurada en `FRONTEND_URL`

Métodos permitidos: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`

## 📝 Próximas Implementaciones

Según el [PLAN_DE_TRABAJO.md](../PLAN_DE_TRABAJO.md):

### Fase 1 - Roles:
- [ ] Sistema de roles (productor/centro_acopio)
- [ ] Actualizar modelo User con campos agrícolas
- [ ] Middleware de autorización por rol

### Fase 2 - Publicaciones:
- [ ] Modelo `Publication` (oferta/demanda)
- [ ] CRUD de publicaciones
- [ ] Validaciones por rol

### Fase 3 - Matching:
- [ ] Sistema de matching básico
- [ ] Modelo `Conversation`
- [ ] Mensajería simple

### Fase 4 - Geolocalización:
- [ ] Colección de ubicaciones (distritos/provincias)
- [ ] Filtros geográficos
- [ ] Verificación institucional

## 🐛 Debugging

### Verificar conexión a MongoDB:
```bash
mongo
> use wakipe
> db.users.find()
```

### Ver logs del servidor:
El servidor imprime logs en consola:
- ✅ Conexión a MongoDB
- 🚀 Servidor iniciado
- 🔍 Rutas cargadas
- ⚠️ Errores y excepciones

### Errores comunes:

**Error: Cannot find module 'dotenv'**
```bash
npm install
```

**Error: MongoDB no conectado**
- Verifica que `mongod` esté corriendo
- Revisa la URI en `.env`

**Error: Clerk authentication failed**
- Verifica `CLERK_SECRET_KEY` en `.env`
- Asegúrate de usar la Secret Key, no la Publishable Key

## 📚 Recursos

- [Express Documentation](https://expressjs.com/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [Clerk Node SDK](https://clerk.com/docs/backend-requests/handling/nodejs)
- [MongoDB Documentation](https://www.mongodb.com/docs/)

## 🤝 Contribuir

1. Sigue la estructura de carpetas existente
2. Usa `async/await` para operaciones asíncronas
3. Maneja errores con try/catch
4. Retorna respuestas consistentes:
   ```javascript
   // Éxito
   res.json({ success: true, data: resultado })
   
   // Error
   res.status(400).json({ success: false, message: "Error..." })
   ```

---

**Última actualización**: 22 de febrero de 2026  
**Versión**: 1.0.0  
**Proyecto**: Wakipe - Red Social Agrícola MVP
