/**
 * fixGeoIndex.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Corrige documentos de User que tienen location.coordinates con GeoJSON
 * inválido: { type: "Point" } sin el array coordinates.
 *
 * Esto provoca el error:
 *   "Can't extract geo keys: ... Point must be an array or object,
 *    instead got type missing"
 *
 * Uso:
 *   node scripts/fixGeoIndex.js
 *
 * Requiere: .env con MONGO_URI configurado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()
const mongoose = require('mongoose')

async function fix() {
  console.log('🔌 Conectando a MongoDB...')
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado\n')

  const db = mongoose.connection.db
  const col = db.collection('users')

  // ── 1. Encontrar documentos con GeoJSON inválido ─────────────────────────
  // Un Point válido necesita: { type: 'Point', coordinates: [lng, lat] }
  // Los inválidos tienen el subdocumento pero sin el array coordinates.
  const badDocs = await col.find({
    'location.coordinates.type': 'Point',
    'location.coordinates.coordinates': { $exists: false }
  }).toArray()

  console.log(`🔍 Documentos con GeoJSON inválido encontrados: ${badDocs.length}`)

  if (badDocs.length === 0) {
    console.log('✅ No hay nada que corregir. Base de datos limpia.')
    await mongoose.disconnect()
    return
  }

  // Mostrar los afectados
  badDocs.forEach(d => {
    console.log(`   · ${d.name || d.email} (${d._id}) — rol: ${d.role}`)
  })

  // ── 2. Eliminar el subdocumento coordinates inválido ─────────────────────
  const ids = badDocs.map(d => d._id)
  const result = await col.updateMany(
    { _id: { $in: ids } },
    { $unset: { 'location.coordinates': '' } }
  )

  console.log(`\n🛠️  Documentos corregidos: ${result.modifiedCount}`)

  // ── 3. Reconstruir el índice 2dsphere ────────────────────────────────────
  console.log('\n🔄 Reconstruyendo índice 2dsphere...')
  try {
    // Primero droppear el índice viejo si existía como non-sparse
    const indexes = await col.indexes()
    const geoIndex = indexes.find(idx =>
      idx.key && idx.key['location.coordinates'] === '2dsphere'
    )
    if (geoIndex) {
      await col.dropIndex(geoIndex.name)
      console.log('   · Índice anterior eliminado')
    }

    // Crear el nuevo índice sparse
    await col.createIndex(
      { 'location.coordinates': '2dsphere' },
      { sparse: true, name: 'location.coordinates_2dsphere_sparse' }
    )
    console.log('   · Nuevo índice sparse creado ✅')
  } catch (err) {
    console.warn('   ⚠️  Error al reconstruir índice (puede ignorarse si Mongoose lo crea al arrancar):', err.message)
  }

  console.log('\n🎉 Migración completada. Reinicia el servidor backend.')
  await mongoose.disconnect()
}

fix().catch(err => {
  console.error('❌ Error en migración:', err)
  process.exit(1)
})
