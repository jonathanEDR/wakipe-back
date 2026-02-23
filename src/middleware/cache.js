/**
 * Middleware de Cache-Control para respuestas HTTP.
 * 
 * Uso:  router.get('/path', cacheFor(3600), controller.handler)
 *       router.use(cacheFor(300))   // aplicar a todas las rutas del router
 * 
 * @param {number} seconds — Duración del cache público en segundos.
 * @returns Express middleware
 */
function cacheFor(seconds = 300) {
  return (req, res, next) => {
    // Solo cachear respuestas GET exitosas
    if (req.method !== 'GET') return next()

    res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${Math.floor(seconds / 2)}`)
    next()
  }
}

/**
 * Middleware para marcar respuestas como no-cacheables.
 * Útil para datos sensibles o que cambian constantemente.
 */
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  next()
}

module.exports = { cacheFor, noCache }
