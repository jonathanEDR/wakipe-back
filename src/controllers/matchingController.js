const Publication = require('../models/Publication')
const User = require('../models/User')
const notificationService = require('../services/notificationService')

// ── Helper: calcular distancia Haversine en km ──────────────────────────────
function haversineKm(coord1, coord2) {
  // coord1, coord2: [lng, lat]
  const toRad = (x) => (x * Math.PI) / 180
  const [lng1, lat1] = coord1
  const [lng2, lat2] = coord2
  const R = 6371 // radio de la Tierra en km

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Helper: puntuación por distancia ────────────────────────────────────────
function distanceScore(km) {
  if (km < 10) return { points: 4, label: 'cercania_muy_alta' }
  if (km < 50) return { points: 3, label: 'cercania_alta' }
  if (km < 100) return { points: 2, label: 'cercania_media' }
  if (km < 200) return { points: 1, label: 'cercania_baja' }
  return { points: 0, label: null }
}

/**
 * GET /api/matching/suggestions
 *
 * Devuelve publicaciones complementarias para el usuario autenticado.
 * - Si es productor (publica ofertas) → muestra demandas que coinciden
 * - Si es centro de acopio (publica demandas) → muestra ofertas que coinciden
 *
 * Puntuación (max 8 puntos):
 *   +3 mismo producto exacto
 *   +4/3/2/1 distancia geográfica (<10/<50/<100/<200 km)
 *       fallback: +2 mismo departamento, +1 misma provincia (sin coords)
 *   +1 fechas compatibles (±30 días)
 *
 * Query params:
 *   ?page=1&limit=10
 *   ?product=Papa
 *   ?departamento=Cusco
 *   ?maxDistance=100       (km, solo si el usuario tiene coordenadas)
 */
const getSuggestions = async (req, res) => {
  try {
    const user = req.user
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 10))
    const maxDistFilter = req.query.maxDistance ? parseFloat(req.query.maxDistance) : null

    // Determinar qué tipo de publicación buscar (complementario al rol)
    const searchType = user.role === 'productor' ? 'demanda' : 'oferta'

    // 1) Obtener MIS publicaciones activas para comparar
    const myPublications = await Publication.find({
      author: user._id,
      status: { $in: ['disponible', 'en_conversacion'] },
    }).lean()

    if (myPublications.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'Crea una publicación primero para ver sugerencias.',
        pagination: { page, pages: 0, total: 0 },
      })
    }

    // 2) Extraer datos clave de mis publicaciones
    const myProducts = [...new Set(myPublications.map(p => p.product))]
    const myCoords = user.location?.coordinates?.coordinates || null // [lng, lat]
    const myDepartamento = user.location?.departamento || null
    const myProvincia = user.location?.provincia || null
    const myDates = myPublications
      .filter(p => p.availabilityDate)
      .map(p => new Date(p.availabilityDate).getTime())

    // 3) Construir filtro base
    const filter = {
      type: searchType,
      status: 'disponible',
      author: { $ne: user._id },
    }
    if (req.query.product) filter.product = req.query.product
    if (req.query.departamento) filter['location.departamento'] = req.query.departamento

    // 4) Obtener candidatas
    const candidates = await Publication.find(filter)
      .populate('author', 'name avatar location institution role verified')
      .lean()

    // 5) Puntuar y ordenar
    const MAX_SCORE = 8
    const scored = candidates.map(pub => {
      let score = 0
      const reasons = []
      let distanceKm = null

      // Mismo producto (+3)
      if (myProducts.includes(pub.product)) {
        score += 3
        reasons.push('mismo_producto')
      }

      // Distancia geoespacial
      const pubCoords = pub.location?.coordinates?.coordinates || null
      if (myCoords && pubCoords && pubCoords.length === 2) {
        distanceKm = Math.round(haversineKm(myCoords, pubCoords) * 10) / 10
        const ds = distanceScore(distanceKm)
        score += ds.points
        if (ds.label) reasons.push(ds.label)
      } else {
        // Fallback: comparación por strings
        if (myDepartamento && pub.location?.departamento === myDepartamento) {
          score += 2
          reasons.push('mismo_departamento')
        }
        if (myProvincia && pub.location?.provincia === myProvincia) {
          score += 1
          reasons.push('misma_provincia')
        }
      }

      // Fechas compatibles (±30 días)
      if (pub.availabilityDate && myDates.length > 0) {
        const pubDate = new Date(pub.availabilityDate).getTime()
        const thirtyDays = 30 * 24 * 60 * 60 * 1000
        const compatible = myDates.some(d => Math.abs(pubDate - d) <= thirtyDays)
        if (compatible) {
          score += 1
          reasons.push('fecha_compatible')
        }
      }

      const matchPercent = Math.round((score / MAX_SCORE) * 100)

      return {
        ...pub,
        _score: score,
        matchPercent,
        matchReasons: reasons,
        distanceKm,
      }
    })

    // Filtrar por distancia máxima si se pidió
    let matches = scored.filter(s => s._score > 0)
    if (maxDistFilter && myCoords) {
      matches = matches.filter(s => s.distanceKm !== null && s.distanceKm <= maxDistFilter)
    }

    matches.sort((a, b) => b._score - a._score)

    // Paginar
    const total = matches.length
    const pages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const paged = matches.slice(start, start + limit)

    // ── Notificar matches de alta compatibilidad (≥70%) ──────────────────
    // Solo notificar la primera vez (página 1) para evitar spam
    if (page === 1) {
      const highMatches = paged.filter(m => m.matchPercent >= 70)
      for (const match of highMatches.slice(0, 3)) { // Máx 3 notificaciones por consulta
        try {
          await notificationService.createFromTemplate(
            user._id,
            'nuevo_match',
            {
              product: match.product,
              distance: match.distanceKm,
              matchScore: match.matchPercent
            },
            { publicationId: match._id }
          )
        } catch (err) {
          // No bloquear el flujo si falla la notificación
          console.error('[Matching] Error al notificar match:', err.message)
        }
      }
    }

    res.json({
      success: true,
      data: paged,
      pagination: { page, pages, total, limit },
    })
  } catch (error) {
    console.error('Error getSuggestions:', error)
    res.status(500).json({ success: false, message: 'Error al obtener sugerencias' })
  }
}

/**
 * GET /api/matching/for/:publicationId
 *
 * Devuelve publicaciones complementarias a UNA publicación específica.
 */
const getMatchesForPublication = async (req, res) => {
  try {
    const user = req.user
    const publication = await Publication.findById(req.params.publicationId).lean()

    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' })
    }

    // Solo el autor puede ver matches de su publicación
    if (publication.author.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'No autorizado' })
    }

    const searchType = publication.type === 'oferta' ? 'demanda' : 'oferta'

    const candidates = await Publication.find({
      type: searchType,
      status: 'disponible',
      author: { $ne: user._id },
    })
      .populate('author', 'name avatar location institution role verified')
      .lean()

    const pubCoords = publication.location?.coordinates?.coordinates || null
    const pubDate = publication.availabilityDate
      ? new Date(publication.availabilityDate).getTime()
      : null
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const MAX_SCORE = 8

    const scored = candidates.map(c => {
      let score = 0
      const reasons = []
      let distanceKm = null

      // Producto
      if (c.product === publication.product) { score += 3; reasons.push('mismo_producto') }

      // Distancia geoespacial
      const cCoords = c.location?.coordinates?.coordinates || null
      if (pubCoords && cCoords && cCoords.length === 2) {
        distanceKm = Math.round(haversineKm(pubCoords, cCoords) * 10) / 10
        const ds = distanceScore(distanceKm)
        score += ds.points
        if (ds.label) reasons.push(ds.label)
      } else {
        // Fallback strings
        if (publication.location?.departamento && c.location?.departamento === publication.location.departamento) {
          score += 2; reasons.push('mismo_departamento')
        }
        if (publication.location?.provincia && c.location?.provincia === publication.location.provincia) {
          score += 1; reasons.push('misma_provincia')
        }
      }

      // Fecha
      if (pubDate && c.availabilityDate) {
        const cDate = new Date(c.availabilityDate).getTime()
        if (Math.abs(pubDate - cDate) <= thirtyDays) { score += 1; reasons.push('fecha_compatible') }
      }

      return { ...c, _score: score, matchPercent: Math.round((score / MAX_SCORE) * 100), matchReasons: reasons, distanceKm }
    })

    const results = scored.filter(s => s._score > 0).sort((a, b) => b._score - a._score)

    res.json({ success: true, data: results })
  } catch (error) {
    console.error('Error getMatchesForPublication:', error)
    res.status(500).json({ success: false, message: 'Error al obtener coincidencias' })
  }
}

module.exports = { getSuggestions, getMatchesForPublication }
