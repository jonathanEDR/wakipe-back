/**
 * Script para asignar el rol super_admin a un usuario por email.
 *
 * Uso:
 *   node scripts/setSuperAdmin.js <email>
 *
 * Ejemplo:
 *   node scripts/setSuperAdmin.js edjonathan5@gmail.com
 */

require('dotenv').config()
const mongoose = require('mongoose')
const User = require('../src/models/User')

const email = process.argv[2]

if (!email) {
  console.error('\n❌  Debes proporcionar un email.')
  console.error('   Uso: node scripts/setSuperAdmin.js <email>\n')
  process.exit(1)
}

async function run() {
  try {
    console.log(`\n🔌  Conectando a MongoDB: ${process.env.MONGO_URI}`)
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅  Conectado.\n')

    // Buscar por email (exacto, case-insensitive)
    const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } })

    if (!user) {
      console.error(`❌  No se encontró ningún usuario con email: ${email}`)
      console.error('   Asegúrate de que el usuario haya completado el onboarding.\n')
      process.exit(1)
    }

    const rolAnterior = user.role || '(sin rol)'
    user.role = 'super_admin'
    await user.save()

    console.log('🎉  Rol actualizado correctamente:')
    console.log(`   Nombre  : ${user.name || 'Sin nombre'}`)
    console.log(`   Email   : ${user.email}`)
    console.log(`   Rol ant.: ${rolAnterior}`)
    console.log(`   Rol nuevo: super_admin\n`)

  } catch (err) {
    console.error('❌  Error:', err.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('🔌  Desconectado de MongoDB.')
  }
}

run()
