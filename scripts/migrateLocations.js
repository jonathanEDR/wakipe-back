#!/usr/bin/env node

/**
 * migrateLocations.js — Migración de ubicaciones existentes
 * 
 * Busca todos los Users y Publications que tengan departamento
 * pero NO tengan coordenadas, y los geocodifica usando Nominatim.
 * 
 * Uso:
 *   node scripts/migrateLocations.js              # migrar todo
 *   node scripts/migrateLocations.js --dry-run     # solo mostrar qué se migraría
 *   node scripts/migrateLocations.js --users       # solo usuarios
 *   node scripts/migrateLocations.js --publications # solo publicaciones
 * 
 * Requiere MONGO_URI en .env (o variable de entorno)
 */

require('dotenv').config()
const mongoose = require('mongoose')
const User = require('../src/models/User')
const Publication = require('../src/models/Publication')

// ── Configuración ───────────────────────────────────────────────────────────
const NOMINATIM_DELAY_MS = 1100 // 1 req/s + margen
const USER_AGENT = 'Wakipe-AgriApp/1.0 (migration-script)'

// ── Parse argumentos ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ONLY_USERS = args.includes('--users')
const ONLY_PUBS = args.includes('--publications')

// ── Rate limiter ────────────────────────────────────────────────────────────
let lastCall = 0

async function nominatimSearch(query) {
  const now = Date.now()
  const wait = Math.max(0, NOMINATIM_DELAY_MS - (now - lastCall))
  if (wait > 0) {
    await new Promise(r => setTimeout(r, wait))
  }
  lastCall = Date.now()

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=pe&addressdetails=1&limit=1&accept-language=es`

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'es',
    },
  })

  if (!response.ok) {
    throw new Error(`Nominatim status: ${response.status}`)
  }

  const results = await response.json()
  if (!Array.isArray(results) || results.length === 0) {
    return null
  }

  const r = results[0]
  return {
    coordinates: [parseFloat(r.lon), parseFloat(r.lat)], // [lng, lat] GeoJSON
    displayName: r.display_name,
  }
}

// ── Construir query de búsqueda a partir de ubicación ───────────────────────
function buildSearchQuery(location) {
  const parts = []
  if (location.distrito) parts.push(location.distrito)
  if (location.provincia) parts.push(location.provincia)
  if (location.departamento) parts.push(location.departamento)
  parts.push('Perú')
  return parts.join(', ')
}

// ── Migrar documentos de una colección ──────────────────────────────────────
async function migrateCollection(Model, collectionName) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Migrando: ${collectionName}`)
  console.log(`${'═'.repeat(60)}`)

  // Buscar documentos que tengan departamento pero no coordenadas
  const filter = {
    'location.departamento': { $nin: [null, ''] },
    $or: [
      { 'location.coordinates.coordinates': { $exists: false } },
      { 'location.coordinates.coordinates': null },
      { 'location.coordinates.coordinates': { $size: 0 } },
    ],
  }

  const docs = await Model.find(filter).lean()
  console.log(`  Encontrados: ${docs.length} documentos sin coordenadas\n`)

  if (docs.length === 0) {
    console.log('  ✔ Nada que migrar.\n')
    return { total: 0, success: 0, failed: 0, skipped: 0 }
  }

  const stats = { total: docs.length, success: 0, failed: 0, skipped: 0 }

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const loc = doc.location
    const identifier = doc.email || doc.clerkId || doc.product || doc._id.toString()
    const progress = `[${i + 1}/${docs.length}]`

    const searchQuery = buildSearchQuery(loc)
    console.log(`  ${progress} ${identifier}`)
    console.log(`           Buscando: "${searchQuery}"`)

    if (DRY_RUN) {
      console.log(`           ⏭️  DRY RUN — se omitiría\n`)
      stats.skipped++
      continue
    }

    try {
      const result = await nominatimSearch(searchQuery)

      if (!result) {
        // Intentar con menos especificidad (solo depto)
        const fallbackQuery = `${loc.departamento}, Perú`
        console.log(`           ⚠️  Sin resultado, reintentando: "${fallbackQuery}"`)
        const fallback = await nominatimSearch(fallbackQuery)

        if (!fallback) {
          console.log(`           ❌ No se encontró ubicación\n`)
          stats.failed++
          continue
        }

        await Model.updateOne(
          { _id: doc._id },
          {
            $set: {
              'location.coordinates': {
                type: 'Point',
                coordinates: fallback.coordinates,
              },
            },
          }
        )

        console.log(`           ✔ Geocodificado (fallback): [${fallback.coordinates}]`)
        console.log(`             → ${fallback.displayName}\n`)
        stats.success++
        continue
      }

      await Model.updateOne(
        { _id: doc._id },
        {
          $set: {
            'location.coordinates': {
              type: 'Point',
              coordinates: result.coordinates,
            },
          },
        }
      )

      console.log(`           ✔ Geocodificado: [${result.coordinates}]`)
      console.log(`             → ${result.displayName}\n`)
      stats.success++
    } catch (err) {
      console.log(`           ❌ Error: ${err.message}\n`)
      stats.failed++
    }
  }

  return stats
}

// ── Resumen final ───────────────────────────────────────────────────────────
function printSummary(label, stats) {
  if (!stats) return
  console.log(`  ${label}: ${stats.success} OK, ${stats.failed} fallidos, ${stats.skipped} omitidos (de ${stats.total})`)
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║   WAKIPE — Migración de ubicaciones a coordenadas      ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  if (DRY_RUN) {
    console.log('\n  🔍 MODO DRY RUN — No se modificará la base de datos\n')
  }

  // Conectar a MongoDB
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    console.error('❌ MONGO_URI no definido en .env')
    process.exit(1)
  }

  console.log(`  Conectando a ${mongoUri} ...`)
  await mongoose.connect(mongoUri)
  console.log('  ✔ MongoDB conectado\n')

  let userStats = null
  let pubStats = null

  try {
    if (!ONLY_PUBS) {
      userStats = await migrateCollection(User, 'Usuarios')
    }

    if (!ONLY_USERS) {
      pubStats = await migrateCollection(Publication, 'Publicaciones')
    }
  } catch (err) {
    console.error('\n  ❌ Error fatal durante migración:', err.message)
  }

  // Resumen
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  RESUMEN DE MIGRACIÓN')
  console.log(`${'═'.repeat(60)}`)
  printSummary('Usuarios      ', userStats)
  printSummary('Publicaciones ', pubStats)
  console.log(`${'═'.repeat(60)}\n`)

  await mongoose.disconnect()
  console.log('  ✔ Conexión cerrada. Migración finalizada.\n')
}

main().catch((err) => {
  console.error('Error inesperado:', err)
  process.exit(1)
})
