/**
 * Location Controller — Proxy a Nominatim (OpenStreetMap)
 * 
 * Nominatim es gratuito con rate-limit de 1 req/s.
 * Este controller implementa caché en memoria para evitar
 * llamadas repetidas y respetar el rate-limit.
 */

// ── Cache en memoria ────────────────────────────────────────────────────────
const cache = new Map()
const CACHE_TTL = 1000 * 60 * 60 // 1 hora

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() })
  // Limpieza periódica: máximo 500 entradas
  if (cache.size > 500) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
}

// ── Rate limiter simple (1 req/s a Nominatim) ──────────────────────────────
let lastNominatimCall = 0

async function nominatimFetch(url) {
  const now = Date.now()
  const wait = Math.max(0, 1100 - (now - lastNominatimCall))
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait))
  }
  lastNominatimCall = Date.now()

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Wakipe-AgriApp/1.0 (contact@wakipe.com)',
      'Accept-Language': 'es',
    },
  })

  if (!response.ok) {
    throw new Error(`Nominatim respondió con status ${response.status}`)
  }

  return response.json()
}

// ── Helper: limpiar prefijos administrativos de Nominatim ──────────────────
function cleanAdminName(name) {
  if (!name) return null
  // Nominatim a veces devuelve "Región de X", "Departamento de X", etc.
  return name
    .replace(/^(Región|Region|Departamento|Provincia|Distrito|Province|District)\s+de\s+/i, '')
    .trim()
}

// ── Helper: Extraer departamento/provincia/distrito de Nominatim ────────────
function extractLocationParts(address) {
  /*
   * Nominatim Perú — campos observados en campo real:
   *
   *   state  → Departamento  (siempre presente, más confiable)
   *   region → Departamento O Provincia según la localidad:
   *            • Si region !== state → region ES la Provincia  (ej: San Martín/Moyobamba)
   *            • Si region  == state → la provincia comparte nombre con el dpto.
   *   county  / province → NUNCA aparecen para Perú en Nominatim
   *   state_district → Aparece en Lima Metropolitana y similares
   *   city / town / village / hamlet / suburb → Distrito
   */

  const rawState  = address.state  || address.region || null
  const rawRegion = address.region || null

  const departamento = cleanAdminName(rawState)

  // Provincia: cuando region ≠ state → region es la provincia
  // Cuando son iguales o faltan → la prov. tiene el mismo nombre que el dpto.
  let provincia = cleanAdminName(address.province) ||
                  cleanAdminName(address.county)   ||
                  null

  if (!provincia) {
    if (rawRegion && rawState && rawRegion !== rawState) {
      // Nominatim distingue: state=Departamento, region=Provincia
      provincia = cleanAdminName(rawRegion)
    } else {
      // Capital de provincia = mismo nombre que departamento
      // Usar state_district si existe (ej: Lima Metropolitana → Lima)
      provincia = cleanAdminName(address.state_district) || departamento
    }
  }

  const distrito =
    cleanAdminName(address.city)         ||
    cleanAdminName(address.town)         ||
    cleanAdminName(address.village)      ||
    cleanAdminName(address.hamlet)       ||
    cleanAdminName(address.city_district)||
    cleanAdminName(address.suburb)       ||
    null

  return { departamento, provincia, distrito }
}

// ============================================
// GEOCODIFICACIÓN INVERSA
// GET /api/locations/reverse?lat=X&lng=Y
// ============================================
exports.reverseGeocode = async (req, res) => {
  try {
    const { lat, lng } = req.query

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Los parámetros lat y lng son obligatorios',
      })
    }

    const latitude = parseFloat(lat)
    const longitude = parseFloat(lng)

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: 'lat y lng deben ser números válidos',
      })
    }

    // Verificar caché
    const cacheKey = `reverse:${latitude.toFixed(5)},${longitude.toFixed(5)}`
    const cached = getCached(cacheKey)
    if (cached) {
      return res.json({ success: true, data: cached, source: 'cache' })
    }

    // Llamar a Nominatim
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1&accept-language=es`
    const result = await nominatimFetch(url)

    if (!result || result.error) {
      return res.status(404).json({
        success: false,
        message: result?.error || 'No se encontró ubicación para estas coordenadas',
      })
    }

    const { departamento, provincia, distrito } = extractLocationParts(result.address || {})

    const data = {
      departamento,
      provincia,
      distrito,
      displayName: result.display_name,
      coordinates: [longitude, latitude],  // [lng, lat] formato GeoJSON
    }

    setCache(cacheKey, data)

    res.json({ success: true, data })
  } catch (error) {
    console.error('Error en reverseGeocode:', error.message)
    res.status(500).json({ success: false, message: 'Error en geocodificación' })
  }
}

// ============================================
// BÚSQUEDA DE LUGARES
// GET /api/locations/search?q=Cusco
// ============================================
exports.searchPlaces = async (req, res) => {
  try {
    const { q } = req.query

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El parámetro q debe tener al menos 2 caracteres',
      })
    }

    const query = q.trim()

    // Verificar caché
    const cacheKey = `search:${query.toLowerCase()}`
    const cached = getCached(cacheKey)
    if (cached) {
      return res.json({ success: true, data: cached, source: 'cache' })
    }

    // Llamar a Nominatim — restringir a Perú (countrycodes=pe)
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=pe&addressdetails=1&limit=5&accept-language=es`
    const results = await nominatimFetch(url)

    if (!Array.isArray(results) || results.length === 0) {
      return res.json({ success: true, data: [] })
    }

    const data = results.map((r) => {
      const { departamento, provincia, distrito } = extractLocationParts(r.address || {})
      return {
        displayName: r.display_name,
        departamento,
        provincia,
        distrito,
        coordinates: [parseFloat(r.lon), parseFloat(r.lat)],  // [lng, lat]
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        type: r.type,
        importance: r.importance,
      }
    })

    setCache(cacheKey, data)

    res.json({ success: true, data })
  } catch (error) {
    console.error('Error en searchPlaces:', error.message)
    res.status(500).json({ success: false, message: 'Error al buscar lugares' })
  }
}
