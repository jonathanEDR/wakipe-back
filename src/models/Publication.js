const mongoose = require('mongoose')

const publicationSchema = new mongoose.Schema(
  {
    // Tipo: un productor crea OFERTA, un centro de acopio crea DEMANDA
    type: {
      type: String,
      enum: ['oferta', 'demanda'],
      required: true,
    },

    // Autor de la publicación
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorRole: {
      type: String,
      enum: ['productor', 'centro_acopio'],
      required: true,
    },

    // Producto principal
    product: {
      type: String,
      required: [true, 'El producto es obligatorio'],
      trim: true,
    },

    // Cantidad y unidad
    quantity: {
      type: Number,
      required: [true, 'La cantidad es obligatoria'],
      min: [0.01, 'La cantidad debe ser mayor a 0'],
    },
    unit: {
      type: String,
      enum: ['kg', 'toneladas', 'sacos', 'cajas', 'jabas', 'arrobas', 'quintales'],
      required: [true, 'La unidad es obligatoria'],
    },

    // Precio referencial (opcional)
    price: {
      type: Number,
      default: null,   // precio por unidad — null = "a convenir"
      min: 0,
    },
    currency: {
      type: String,
      enum: ['PEN', 'USD'],
      default: 'PEN',
    },

    // Fecha de disponibilidad / necesidad
    availabilityDate: {
      type: Date,
      required: [true, 'La fecha de disponibilidad es obligatoria'],
    },

    // Ubicación (copia liviana de la ubicación del autor)
    location: {
      departamento: { type: String, default: null },
      provincia: { type: String, default: null },
      distrito: { type: String, default: null },
      // GeoJSON Point para queries geoespaciales
      coordinates: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: undefined }  // [lng, lat]
      }
    },

    // Estado del ciclo de vida
    status: {
      type: String,
      enum: ['disponible', 'en_conversacion', 'acordado', 'cerrado'],
      default: 'disponible',
    },

    // Descripción libre
    description: {
      type: String,
      maxlength: 500,
      default: '',
    },

    // Imágenes del producto (Cloudinary)
    images: [
      {
        publicId: { type: String, required: true },
        url: { type: String, required: true },
        width: { type: Number },
        height: { type: Number },
      },
    ],
  },
  {
    timestamps: true,  // createdAt, updatedAt
  }
)

// ── Índices para consultas frecuentes ────────────────────────────────────────
publicationSchema.index({ type: 1, status: 1, product: 1 })
publicationSchema.index({ author: 1, status: 1 })
publicationSchema.index({ 'location.departamento': 1 })
publicationSchema.index({ availabilityDate: 1 })
publicationSchema.index({ createdAt: -1 })
publicationSchema.index({ 'location.coordinates': '2dsphere' })

module.exports = mongoose.model('Publication', publicationSchema)
