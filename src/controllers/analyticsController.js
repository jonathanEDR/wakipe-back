/**
 * Analytics Controller — Estadísticas y reportes para el panel de administración.
 * 
 * Endpoints:
 *   GET /api/analytics/overview    — Métricas generales (contadores)
 *   GET /api/analytics/trends      — Tendencias por período (últimos 30 días)
 *   GET /api/analytics/products    — Top productos por oferta/demanda
 *   GET /api/analytics/locations   — Distribución geográfica
 */

const User = require('../models/User')
const Publication = require('../models/Publication')
const Conversation = require('../models/Conversation')

// ── Helper: Inicio del día hace N días ──────────────────────────────────────
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

// ============================================
// GET /api/analytics/overview
// Métricas generales del sistema
// ============================================
exports.getOverview = async (req, res) => {
  try {
    const [
      totalUsers,
      productores,
      centrosAcopio,
      admins,
      verifiedUsers,
      bannedUsers,
      totalPublications,
      ofertas,
      demandas,
      pubDisponibles,
      pubEnConversacion,
      pubAcordadas,
      pubCerradas,
      totalConversations,
      convActivas,
      // Últimos 7 días
      usersLast7d,
      pubsLast7d,
      convsLast7d,
      // Últimos 30 días
      usersLast30d,
      pubsLast30d,
      convsLast30d,
    ] = await Promise.all([
      // Usuarios
      User.countDocuments(),
      User.countDocuments({ role: 'productor' }),
      User.countDocuments({ role: 'centro_acopio' }),
      User.countDocuments({ role: { $in: ['admin', 'super_admin'] } }),
      User.countDocuments({ verified: true }),
      User.countDocuments({ banned: true }),
      // Publicaciones
      Publication.countDocuments(),
      Publication.countDocuments({ type: 'oferta' }),
      Publication.countDocuments({ type: 'demanda' }),
      Publication.countDocuments({ status: 'disponible' }),
      Publication.countDocuments({ status: 'en_conversacion' }),
      Publication.countDocuments({ status: 'acordado' }),
      Publication.countDocuments({ status: 'cerrado' }),
      // Conversaciones
      Conversation.countDocuments(),
      Conversation.countDocuments({ status: 'activo' }),
      // Últimos 7 días
      User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
      Publication.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
      Conversation.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
      // Últimos 30 días
      User.countDocuments({ createdAt: { $gte: daysAgo(30) } }),
      Publication.countDocuments({ createdAt: { $gte: daysAgo(30) } }),
      Conversation.countDocuments({ createdAt: { $gte: daysAgo(30) } }),
    ])

    // Contar mensajes totales (soma de messages.length en todas las conversaciones)
    const [msgAgg] = await Conversation.aggregate([
      { $project: { count: { $size: '$messages' } } },
      { $group: { _id: null, total: { $sum: '$count' } } },
    ])
    const totalMessages = msgAgg?.total || 0

    // Usuarios con coordenadas (geolocalización activa)
    const usersWithCoords = await User.countDocuments({
      'location.coordinates.coordinates': { $exists: true, $ne: null },
    })

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          productores,
          centrosAcopio,
          admins,
          verified: verifiedUsers,
          banned: bannedUsers,
          withCoordinates: usersWithCoords,
        },
        publications: {
          total: totalPublications,
          ofertas,
          demandas,
          byStatus: {
            disponible: pubDisponibles,
            en_conversacion: pubEnConversacion,
            acordado: pubAcordadas,
            cerrado: pubCerradas,
          },
        },
        conversations: {
          total: totalConversations,
          activas: convActivas,
          totalMessages,
        },
        recent: {
          last7days: { users: usersLast7d, publications: pubsLast7d, conversations: convsLast7d },
          last30days: { users: usersLast30d, publications: pubsLast30d, conversations: convsLast30d },
        },
      },
    })
  } catch (error) {
    console.error('Error en getOverview:', error)
    res.status(500).json({ success: false, message: 'Error al obtener resumen analítico' })
  }
}

// ============================================
// GET /api/analytics/trends?days=30
// Datos agrupados por día para gráficas
// ============================================
exports.getTrends = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const since = daysAgo(days)

    const [userTrend, pubTrend, convTrend] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Publication.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
            ofertas: { $sum: { $cond: [{ $eq: ['$type', 'oferta'] }, 1, 0] } },
            demandas: { $sum: { $cond: [{ $eq: ['$type', 'demanda'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Conversation.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ])

    res.json({
      success: true,
      data: {
        days,
        users: userTrend,
        publications: pubTrend,
        conversations: convTrend,
      },
    })
  } catch (error) {
    console.error('Error en getTrends:', error)
    res.status(500).json({ success: false, message: 'Error al obtener tendencias' })
  }
}

// ============================================
// GET /api/analytics/products?limit=10
// Top productos más publicados
// ============================================
exports.getTopProducts = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)

    const [topGeneral, topOfertas, topDemandas] = await Promise.all([
      Publication.aggregate([
        { $group: { _id: '$product', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Publication.aggregate([
        { $match: { type: 'oferta' } },
        { $group: { _id: '$product', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Publication.aggregate([
        { $match: { type: 'demanda' } },
        { $group: { _id: '$product', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
    ])

    res.json({
      success: true,
      data: {
        general: topGeneral.map(p => ({ product: p._id, count: p.count })),
        ofertas: topOfertas.map(p => ({ product: p._id, count: p.count })),
        demandas: topDemandas.map(p => ({ product: p._id, count: p.count })),
      },
    })
  } catch (error) {
    console.error('Error en getTopProducts:', error)
    res.status(500).json({ success: false, message: 'Error al obtener productos principales' })
  }
}

// ============================================
// GET /api/analytics/locations
// Distribución geográfica de usuarios y publicaciones
// ============================================
exports.getLocationStats = async (req, res) => {
  try {
    const [usersByDept, pubsByDept] = await Promise.all([
      User.aggregate([
        { $match: { 'location.departamento': { $nin: [null, ''] } } },
        {
          $group: {
            _id: '$location.departamento',
            count: { $sum: 1 },
            verified: { $sum: { $cond: ['$verified', 1, 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Publication.aggregate([
        { $match: { 'location.departamento': { $nin: [null, ''] } } },
        {
          $group: {
            _id: '$location.departamento',
            count: { $sum: 1 },
            ofertas: { $sum: { $cond: [{ $eq: ['$type', 'oferta'] }, 1, 0] } },
            demandas: { $sum: { $cond: [{ $eq: ['$type', 'demanda'] }, 1, 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ])

    res.json({
      success: true,
      data: {
        users: usersByDept.map(d => ({
          departamento: d._id,
          count: d.count,
          verified: d.verified,
        })),
        publications: pubsByDept.map(d => ({
          departamento: d._id,
          count: d.count,
          ofertas: d.ofertas,
          demandas: d.demandas,
        })),
      },
    })
  } catch (error) {
    console.error('Error en getLocationStats:', error)
    res.status(500).json({ success: false, message: 'Error al obtener estadísticas de ubicación' })
  }
}
