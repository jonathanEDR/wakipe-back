const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    clerkId: {
      type: String,
      required: true,
      unique: true  // ID de Clerk
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
    },
    avatar: {
      type: String,
    },
    
    // Sistema de roles
    role: {
      type: String,
      enum: ['productor', 'centro_acopio', 'admin', 'super_admin'],
      default: null  // Usuario debe seleccionar rol en onboarding
    },
    
    // Verificación institucional
    verified: {
      type: Boolean,
      default: false
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',  // Referencia al admin/institución que verificó
      default: null
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    
    // Ubicación geográfica
    location: {
      departamento: { type: String, default: null },
      provincia: { type: String, default: null },
      distrito: { type: String, default: null },
      referencia: { type: String, default: null },  // Dirección aproximada
      // GeoJSON Point para queries geoespaciales
      // IMPORTANTE: no poner default en 'type' para evitar crear { type: 'Point' }
      // sin el array coordinates, lo que rompe el índice 2dsphere.
      coordinates: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number], default: undefined }  // [lng, lat]
      }
    },
    
    // Campos específicos para PRODUCTOR
    products: {
      type: [String],  // Ej: ["Papa", "Maíz", "Quinua"]
      default: []
    },
    farmSize: {  // Tamaño de parcela (opcional)
      type: Number,  // En hectáreas
      default: null
    },
    
    // Campos específicos para CENTRO DE ACOPIO
    institution: {
      type: String,  // Nombre de la cooperativa/centro
      default: null
    },
    institutionType: {
      type: String,  // "cooperativa", "centro_acopio", "asociacion", etc.
      enum: ['cooperativa', 'centro_acopio', 'asociacion', 'municipalidad', 'agencia_agraria', 'otro', null],
      default: null
    },
    coverageArea: {  // Zonas que cubre el centro de acopio
      type: [String],  // Ej: ["Distrito A", "Distrito B"]
      default: []
    },
    
    // Contacto
    phone: {
      type: String,
      default: null,
      trim: true,
    },

    // Campos heredados (mantener compatibilidad)
    age: {
      type: Number,
    },
    address: {
      type: String,
    },
    
    // Estado de la cuenta
    isActive: {
      type: Boolean,
      default: true
    },
    isBanned: {
      type: Boolean,
      default: false
    },
    bannedReason: {
      type: String,
      default: null
    }
  },
  { 
    timestamps: true  // createdAt, updatedAt
  }
);

// Índices para búsquedas eficientes
userSchema.index({ role: 1 });
userSchema.index({ 'location.departamento': 1 });
userSchema.index({ 'location.provincia': 1 });
userSchema.index({ 'location.distrito': 1 });
userSchema.index({ verified: 1 });
// sparse: true → MongoDB omite del índice los documentos donde coordinates es null/undefined.
// Sin esto, un documento con { type: 'Point' } sin array coordinates rompe el índice 2dsphere.
userSchema.index({ 'location.coordinates': '2dsphere' }, { sparse: true });

// Método para verificar si el usuario tiene un rol específico
userSchema.methods.hasRole = function(roles) {
  if (Array.isArray(roles)) {
    return roles.includes(this.role);
  }
  return this.role === roles;
};

// Método para verificar si el usuario es administrador
userSchema.methods.isAdmin = function() {
  return this.role === 'admin' || this.role === 'super_admin';
};

// Método para verificar si el usuario es super administrador
userSchema.methods.isSuperAdmin = function() {
  return this.role === 'super_admin';
};

module.exports = mongoose.model("User", userSchema);