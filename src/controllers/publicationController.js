const Publication = require('../models/Publication')
const User = require('../models/User')
const { PRODUCTS, UNITS } = require('../config/constants')
const notificationService = require('../services/notificationService')
const { triggerReactiveMatching } = require('./matchingController')

// Helper: escapar caracteres especiales de regex para prevenir ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================
// CREAR PUBLICACIÓN
// POST /api/publications
// ============================================
exports.createPublication = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' })
    }

    // Determinar tipo según rol
    let type
    if (user.role === 'productor') {
      type = 'oferta'
    } else if (user.role === 'centro_acopio') {
      type = 'demanda'
    } else {
      return res.status(403).json({
        success: false,
        message: 'Solo productores y centros de acopio pueden crear publicaciones',
      })
    }

    const { product, quantity, unit, price, currency, availabilityDate, description, location } = req.body

    // Validaciones básicas
    if (!product || !quantity || !unit || !availabilityDate) {
      return res.status(400).json({
        success: false,
        message: 'Producto, cantidad, unidad y fecha de disponibilidad son obligatorios',
      })
    }

    if (!UNITS.includes(unit)) {
      return res.status(400).json({
        success: false,
        message: `Unidad inválida. Opciones: ${UNITS.join(', ')}`,
      })
    }

    // Fecha no puede ser pasada
    if (new Date(availabilityDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'La fecha de disponibilidad no puede ser pasada',
      })
    }

    // Construir ubicación con coordenadas
    const pubLocation = location
      ? {
          departamento: location.departamento || null,
          provincia: location.provincia || null,
          distrito: location.distrito || null,
        }
      : {
          departamento: user.location?.departamento || null,
          provincia: user.location?.provincia || null,
          distrito: user.location?.distrito || null,
        }

    // Agregar coordenadas GeoJSON si vienen en el body o del perfil del usuario
    const coords = location?.coordinates || user.location?.coordinates?.coordinates
    if (coords && Array.isArray(coords) && coords.length === 2) {
      pubLocation.coordinates = { type: 'Point', coordinates: coords }
    }

    const publication = new Publication({
      type,
      author: user._id,
      authorRole: user.role,
      product: product.trim(),
      quantity,
      unit,
      price: price || null,
      currency: currency || 'PEN',
      availabilityDate,
      description: description?.trim() || '',
      location: pubLocation,
      status: 'disponible',
    })

    await publication.save()

    // Populate author para la respuesta
    await publication.populate('author', 'name avatar role verified location institution')

    // Disparar matching reactivo en background (no bloquea la respuesta)
    setImmediate(() => triggerReactiveMatching(publication.toObject()).catch(console.error))

    res.status(201).json({
      success: true,
      message: `${type === 'oferta' ? 'Oferta' : 'Demanda'} creada correctamente`,
      data: publication,
    })
  } catch (error) {
    console.error('Error en createPublication:', error.message)
    res.status(500).json({ success: false, message: 'Error al crear publicación' })
  }
}

// ============================================
// LISTAR PUBLICACIONES (público, con filtros)
// GET /api/publications
// ============================================
exports.getPublications = async (req, res) => {
  try {
    const {
      type,        // 'oferta' | 'demanda'
      product,
      status,
      departamento,
      provincia,
      distrito,
      author,      // filtrar por autor (userId)
      lat,         // filtro geoespacial: latitud del usuario
      lng,         // filtro geoespacial: longitud del usuario
      maxDistance,  // radio en km (default sin límite)
      sort,        // 'recent' | 'date' | 'quantity' | 'distance'
      page = 1,
      limit = 20,
    } = req.query

    // Construir filtro con validación estricta (prevenir inyección NoSQL)
    const filter = {}

    const validTypes = ['oferta', 'demanda']
    if (type && validTypes.includes(String(type))) filter.type = String(type)

    if (product) filter.product = { $regex: escapeRegex(String(product)), $options: 'i' }

    if (author && typeof author === 'string') filter.author = author

    const validStatuses = ['disponible', 'en_conversacion', 'reservado', 'acordado', 'cerrado']
    if (status && validStatuses.includes(String(status))) filter.status = String(status)
    else filter.status = { $ne: 'cerrado' }  // por defecto no mostrar cerradas

    if (departamento && typeof departamento === 'string') filter['location.departamento'] = String(departamento)
    if (provincia && typeof provincia === 'string') filter['location.provincia'] = String(provincia)
    if (distrito && typeof distrito === 'string') filter['location.distrito'] = String(distrito)

    // Filtro geoespacial: buscar dentro de un radio
    const hasGeo = lat && lng
    if (hasGeo && maxDistance) {
      const radiusMeters = parseFloat(maxDistance) * 1000
      filter['location.coordinates'] = {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: radiusMeters,
        },
      }
    }

    // Ordenamiento
    let sortObj = { createdAt: -1 } // más recientes primero
    if (sort === 'date') sortObj = { availabilityDate: 1 }
    if (sort === 'quantity') sortObj = { quantity: -1 }

    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
    const skip = (Number(page) - 1) * safeLimit

    const [publications, total] = await Promise.all([
      Publication.find(filter)
        .populate('author', 'name avatar role verified location institution')
        .sort(sortObj)
        .skip(skip)
        .limit(safeLimit),
      Publication.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: publications,
      pagination: {
        page: Number(page),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    })
  } catch (error) {
    console.error('Error en getPublications:', error.message)
    res.status(500).json({ success: false, message: 'Error al obtener publicaciones' })
  }
}

// ============================================
// MIS PUBLICACIONES (autenticado)
// GET /api/publications/my
// ============================================
exports.getMyPublications = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' })
    }

    const { status, page = 1, limit = 20 } = req.query
    const filter = { author: user._id }

    // Validar status contra whitelist
    const validStatuses = ['disponible', 'en_conversacion', 'reservado', 'acordado', 'cerrado']
    if (status && validStatuses.includes(String(status))) filter.status = String(status)

    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
    const skip = (Number(page) - 1) * safeLimit

    const [publications, total] = await Promise.all([
      Publication.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Publication.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: publications,
      pagination: {
        page: Number(page),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    })
  } catch (error) {
    console.error('Error en getMyPublications:', error.message)
    res.status(500).json({ success: false, message: 'Error al obtener mis publicaciones' })
  }
}

// ============================================
// VER DETALLE
// GET /api/publications/:id
// ============================================
exports.getPublication = async (req, res) => {
  try {
    const publication = await Publication.findById(req.params.id)
      .populate('author', 'name avatar role verified location institution products farmSize coverageArea')

    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    res.json({ success: true, data: publication })
  } catch (error) {
    console.error('Error en getPublication:', error.message)
    res.status(500).json({ success: false, message: 'Error al obtener publicación' })
  }
}

// ============================================
// EDITAR PUBLICACIÓN (solo el autor)
// PUT /api/publications/:id
// ============================================
exports.updatePublication = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' })
    }

    const publication = await Publication.findById(req.params.id)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor puede editar
    if (publication.author.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para editar esta publicación' })
    }

    // Solo se puede editar si está "disponible"
    if (publication.status !== 'disponible') {
      return res.status(400).json({
        success: false,
        message: `No se puede editar una publicación en estado "${publication.status}"`,
      })
    }

    const { product, quantity, unit, price, currency, availabilityDate, description, location } = req.body

    if (product) publication.product = product.trim()
    if (quantity) publication.quantity = quantity
    if (unit) {
      if (!UNITS.includes(unit)) {
        return res.status(400).json({ success: false, message: `Unidad inválida: ${unit}` })
      }
      publication.unit = unit
    }
    if (price !== undefined) publication.price = price
    if (currency) publication.currency = currency
    if (availabilityDate) publication.availabilityDate = availabilityDate
    if (description !== undefined) publication.description = description.trim()
    if (location) {
      publication.location = {
        departamento: location.departamento || publication.location?.departamento,
        provincia: location.provincia || publication.location?.provincia,
        distrito: location.distrito || publication.location?.distrito,
      }
      // Coordenadas GeoJSON
      if (location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
        publication.location.coordinates = { type: 'Point', coordinates: location.coordinates }
      }
    }

    await publication.save()
    await publication.populate('author', 'name avatar role verified location institution')

    res.json({ success: true, message: 'Publicación actualizada', data: publication })
  } catch (error) {
    console.error('Error en updatePublication:', error.message)
    res.status(500).json({ success: false, message: 'Error al actualizar publicación' })
  }
}

// ============================================
// CAMBIAR ESTADO
// PATCH /api/publications/:id/status
// ============================================
exports.updateStatus = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' })
    }

    const publication = await Publication.findById(req.params.id)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor o un admin puede cambiar el estado
    const isAuthor = publication.author.toString() === user._id.toString()
    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ success: false, message: 'No tienes permiso' })
    }

    const { status } = req.body
    const validTransitions = {
      disponible:       ['en_conversacion', 'reservado', 'cerrado'],
      en_conversacion:  ['disponible', 'reservado', 'cerrado'],
      reservado:        ['acordado', 'disponible', 'cerrado'],
      acordado:         ['cerrado'],
      cerrado:          [],  // estado final
    }

    if (!validTransitions[publication.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `No se puede pasar de "${publication.status}" a "${status}"`,
      })
    }

    const previousStatus = publication.status
    publication.status = status
    await publication.save()

    // ── Notificar al autor sobre cambios de estado ────────────────────────
    try {
      if (status === 'acordado') {
        await notificationService.createFromTemplate(
          publication.author,
          'publicacion_acordada',
          {
            product: publication.product,
            quantity: publication.quantity,
            unit: publication.unit
          },
          { publicationId: publication._id, previousStatus }
        )
      } else if (status === 'cerrado') {
        await notificationService.createFromTemplate(
          publication.author,
          'publicacion_cerrada',
          { product: publication.product },
          { publicationId: publication._id, previousStatus }
        )
      }
    } catch (err) {
      console.error('[Publications] Error al notificar cambio de estado:', err.message)
    }

    res.json({ success: true, message: `Estado cambiado a "${status}"`, data: publication })
  } catch (error) {
    console.error('Error en updateStatus:', error.message)
    res.status(500).json({ success: false, message: 'Error al cambiar estado' })
  }
}

// ============================================
// ELIMINAR PUBLICACIÓN (autor o admin)
// DELETE /api/publications/:id
// ============================================
exports.deletePublication = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' })
    }

    const publication = await Publication.findById(req.params.id)
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    const isAuthor = publication.author.toString() === user._id.toString()
    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para eliminar esta publicación' })
    }

    await publication.deleteOne()

    res.json({ success: true, message: 'Publicación eliminada' })
  } catch (error) {
    console.error('Error en deletePublication:', error.message)
    res.status(500).json({ success: false, message: 'Error al eliminar publicación' })
  }
}
