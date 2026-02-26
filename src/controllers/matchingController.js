const Publication = require('../models/Publication')
const User = require('../models/User')
const Conversation = require('../models/Conversation')
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

// ── Helper: conversión a kg y puntuación por compatibilidad de cantidad ──────
const TO_KG = {
  kg: 1,
  toneladas: 1000,
  quintales: 46,
  arrobas: 11.5,
  sacos: 50,
  cajas: 20,
  jabas: 20,
  unidad: 0.5,
}

function qtyScore(pubQty, pubUnit, userQty, userUnit) {
  const pubKg  = (pubQty  || 0) * (TO_KG[pubUnit]  || 1)
  const userKg = (userQty || 0) * (TO_KG[userUnit] || 1)
  if (!pubKg || !userKg) return { points: 0, ratio: 0 }
  const ratio = Math.min(pubKg, userKg) / Math.max(pubKg, userKg)
  if (ratio >= 0.8) return { points: 2, ratio: Math.round(ratio * 100) }
  if (ratio >= 0.4) return { points: 1, ratio: Math.round(ratio * 100) }
  return { points: 0, ratio: Math.round(ratio * 100) }
}

// ── Helper: calcular máximo puntaje alcanzable dinámicamente ─────────────────
// Esto permite normalizar el % de match sin penalizar usuarios sin GPS o sin qty
function calcMaxAchievable(hasGeo, hasQty) {
  let max = 3  // producto (máx)
  max += 1     // fecha
  if (hasGeo) max += 4  // distancia geoespacial
  else max += 3         // fallback texto: depto(2) + provincia(1)
  if (hasQty) max += 2  // cantidad
  return max   // máx 10 con geo+qty, 8 sin qty, 7 sin geo
}

/**
 * GET /api/matching/suggestions
 *
 * Devuelve publicaciones complementarias para el usuario autenticado.
 * - Si es productor (publica ofertas) → muestra demandas que coinciden
 * - Si es centro de acopio (publica demandas) → muestra ofertas que coinciden
 *
 * Puntuación (max 10 puntos — dinámico según datos disponibles):
 *   +3 mismo producto exacto
 *   +4/3/2/1 distancia geográfica (<10/<50/<100/<200 km)
 *       fallback: +2 mismo departamento, +1 misma provincia (sin coords)
 *   +2/+1 compatibilidad de cantidad (ratio ≥80% / ≥40%)
 *   +1 fechas compatibles (±30 días)
 *
 * Query params:
 *   ?page=1&limit=10
 *   ?product=Papa
 *   ?departamento=Cusco
 *   ?maxDistance=100       (km, solo si el usuario tiene coordenadas)
 *   ?includeContacted=true  (incluir publicaciones ya contactadas)
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
    // Cantidades de mis publicaciones para comparar
    const myQtyMap = {} // { product: { qty, unit } }
    myPublications.forEach(p => {
      if (p.quantity && p.unit) myQtyMap[p.product] = { qty: p.quantity, unit: p.unit }
    })

    // 3) Construir filtro base
    const filter = {
      type: searchType,
      status: 'disponible',
      author: { $ne: user._id },
    }
    if (req.query.product && typeof req.query.product === 'string') filter.product = String(req.query.product)
    if (req.query.departamento && typeof req.query.departamento === 'string') filter['location.departamento'] = String(req.query.departamento)

    // 4) Excluir publicaciones ya contactadas (salvo que se pida explícitamente)
    const includeContacted = req.query.includeContacted === 'true'
    let excludedPubIds = new Set()
    if (!includeContacted) {
      const contactedIds = await Conversation.find({ participants: user._id })
        .distinct('publication')
      excludedPubIds = new Set(contactedIds.map(id => id.toString()))
    }

    // 5) Obtener candidatas
    const candidates = await Publication.find(filter)
      .populate('author', 'name avatar location institution role verified')
      .lean()

    // Filtrar las ya contactadas
    const filteredCandidates = includeContacted
      ? candidates
      : candidates.filter(c => !excludedPubIds.has(c._id.toString()))

    // 6) Puntuar y ordenar
    const scored = filteredCandidates.map(pub => {
      let score = 0
      const reasons = []
      let distanceKm = null
      let qtyRatio = null

      // Mismo producto (+3)
      if (myProducts.includes(pub.product)) {
        score += 3
        reasons.push('mismo_producto')
      }

      // Distancia geoespacial
      const pubCoords = pub.location?.coordinates?.coordinates || null
      const hasGeo = !!(myCoords && pubCoords && pubCoords.length === 2)
      if (hasGeo) {
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

      // Compatibilidad de cantidad (+2/+1)
      const myQty = myQtyMap[pub.product]
      const hasQty = !!(myQty && pub.quantity && pub.unit)
      if (hasQty) {
        const qs = qtyScore(pub.quantity, pub.unit, myQty.qty, myQty.unit)
        score += qs.points
        qtyRatio = qs.ratio
        if (qs.points === 2) reasons.push('cantidad_ideal')
        else if (qs.points === 1) reasons.push('cantidad_parcial')
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

      const maxScore = calcMaxAchievable(hasGeo, hasQty)
      const matchPercent = Math.round((score / maxScore) * 100)

      return {
        ...pub,
        _score: score,
        matchPercent,
        matchReasons: reasons,
        distanceKm,
        qtyRatio,
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

    // Excluir publicaciones ya contactadas (salvo que se pida)
    const includeContacted = req.query?.includeContacted === 'true'
    let excludedPubIds = new Set()
    if (!includeContacted) {
      const contactedIds = await Conversation.find({ participants: user._id })
        .distinct('publication')
      excludedPubIds = new Set(contactedIds.map(id => id.toString()))
    }

    const allCandidates = await Publication.find({
      type: searchType,
      status: 'disponible',
      author: { $ne: user._id },
    })
      .populate('author', 'name avatar location institution role verified')
      .lean()

    const candidates = includeContacted
      ? allCandidates
      : allCandidates.filter(c => !excludedPubIds.has(c._id.toString()))

    const pubCoords = publication.location?.coordinates?.coordinates || null
    const pubDate = publication.availabilityDate
      ? new Date(publication.availabilityDate).getTime()
      : null
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    const scored = candidates.map(c => {
      let score = 0
      const reasons = []
      let distanceKm = null
      let qtyRatio = null

      // Producto
      if (c.product === publication.product) { score += 3; reasons.push('mismo_producto') }

      // Distancia geoespacial
      const cCoords = c.location?.coordinates?.coordinates || null
      const hasGeo = !!(pubCoords && cCoords && cCoords.length === 2)
      if (hasGeo) {
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

      // Compatibilidad de cantidad (+2/+1)
      const hasQty = !!(publication.quantity && publication.unit && c.quantity && c.unit)
      if (hasQty) {
        const qs = qtyScore(c.quantity, c.unit, publication.quantity, publication.unit)
        score += qs.points
        qtyRatio = qs.ratio
        if (qs.points === 2) reasons.push('cantidad_ideal')
        else if (qs.points === 1) reasons.push('cantidad_parcial')
      }

      // Fecha
      if (pubDate && c.availabilityDate) {
        const cDate = new Date(c.availabilityDate).getTime()
        if (Math.abs(pubDate - cDate) <= thirtyDays) { score += 1; reasons.push('fecha_compatible') }
      }

      const maxScore = calcMaxAchievable(hasGeo, hasQty)
      return { ...c, _score: score, matchPercent: Math.round((score / maxScore) * 100), matchReasons: reasons, distanceKm, qtyRatio }
    })

    const results = scored.filter(s => s._score > 0).sort((a, b) => b._score - a._score)

    res.json({ success: true, data: results })
  } catch (error) {
    console.error('Error getMatchesForPublication:', error)
    res.status(500).json({ success: false, message: 'Error al obtener coincidencias' })
  }
}

module.exports = { getSuggestions, getMatchesForPublication, triggerReactiveMatching }

/**
 * triggerReactiveMatching(publication)
 *
 * Disparado en background al crear una publicación.
 * Busca usuarios con rol complementario que tengan publicaciones con productos coincidentes
 * y les notifica si el matchPercent es ≥ 60%.
 * Se llama con setImmediate() desde createPublication para no bloquear la respuesta.
 */
async function triggerReactiveMatching(pub) {
  try {
    // Rol complementario: si pub es oferta → buscar demandantes, y viceversa
    const targetRole = pub.type === 'oferta' ? 'centro_acopio' : 'productor'
    const complementaryType = pub.type === 'oferta' ? 'demanda' : 'oferta'

    // Buscar publicaciones complementarias con el mismo producto
    const complementaryPubs = await Publication.find({
      type: complementaryType,
      product: pub.product,
      status: 'disponible',
      author: { $ne: pub.author },
    })
      .populate('author', 'name location role')
      .lean()

    if (complementaryPubs.length === 0) return

    // Agrupar por autor para no envisar duplicados
    const authorMap = new Map()
    const pubCoords = pub.location?.coordinates?.coordinates || null
    const pubDate = pub.availabilityDate ? new Date(pub.availabilityDate).getTime() : null
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    for (const cp of complementaryPubs) {
      const authorId = cp.author._id.toString()
      if (authorMap.has(authorId)) continue // ya procesamos a este autor

      let score = 0
      // Producto ya coincide → +3
      score += 3

      // Distancia
      const cpCoords = cp.location?.coordinates?.coordinates || null
      const hasGeo = !!(pubCoords && cpCoords && cpCoords.length === 2)
      let distanceKm = null
      if (hasGeo) {
        distanceKm = Math.round(haversineKm(pubCoords, cpCoords) * 10) / 10
        score += distanceScore(distanceKm).points
      } else {
        if (pub.location?.departamento && cp.location?.departamento === pub.location.departamento) score += 2
        if (pub.location?.provincia && cp.location?.provincia === pub.location.provincia) score += 1
      }

      // Cantidad
      const hasQty = !!(pub.quantity && pub.unit && cp.quantity && cp.unit)
      if (hasQty) {
        score += qtyScore(cp.quantity, cp.unit, pub.quantity, pub.unit).points
      }

      // Fecha
      if (pubDate && cp.availabilityDate) {
        const cpDate = new Date(cp.availabilityDate).getTime()
        if (Math.abs(pubDate - cpDate) <= thirtyDays) score += 1
      }

      const maxScore = calcMaxAchievable(hasGeo, hasQty)
      const matchPercent = Math.round((score / maxScore) * 100)

      if (matchPercent >= 60) {
        authorMap.set(authorId, { userId: cp.author._id, matchPercent, distanceKm })
      }
    }

    // Notificar a los mejores 10
    const topMatches = [...authorMap.values()]
      .sort((a, b) => b.matchPercent - a.matchPercent)
      .slice(0, 10)

    for (const match of topMatches) {
      try {
        await notificationService.createFromTemplate(
          match.userId,
          'nuevo_match',
          {
            product: pub.product,
            distance: match.distanceKm,
            matchScore: match.matchPercent,
          },
          { publicationId: pub._id }
        )
      } catch (err) {
        console.error('[ReactiveMatching] Error al notificar:', err.message)
      }
    }

    if (topMatches.length > 0) {
      console.log(`[ReactiveMatching] Publicación ${pub._id}: ${topMatches.length} usuarios notificados`)
    }
  } catch (err) {
    console.error('[ReactiveMatching] Error general:', err.message)
  }
}
