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
const readline = require('readline')
const User = require('../src/models/User')

// Helper: escapar regex
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const email = process.argv[2]

if (!email) {
  console.error('\n❌  Debes proporcionar un email.')
  console.error('   Uso: node scripts/setSuperAdmin.js <email>\n')
  process.exit(1)
}

async function run() {
  try {
    // SEGURIDAD: no logear la URI de conexión (contiene credenciales)
    console.log('\n🔌  Conectando a MongoDB...')
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅  Conectado.\n')

    // Buscar por email (exacto, case-insensitive, con regex escapado)
    const safeEmail = escapeRegex(email)
    const user = await User.findOne({ email: { $regex: new RegExp(`^${safeEmail}$`, 'i') } })

    if (!user) {
      console.error(`❌  No se encontró ningún usuario con email: ${email}`)
      console.error('   Asegúrate de que el usuario haya completado el onboarding.\n')
      process.exit(1)
    }

    const rolAnterior = user.role || '(sin rol)'

    // Confirmación interactiva
    console.log(`⚠️  Vas a promover a super_admin:`);
    console.log(`   Nombre  : ${user.name || 'Sin nombre'}`);
    console.log(`   Email   : ${user.email}`);
    console.log(`   Rol actual: ${rolAnterior}\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('¿Confirmar? (s/N): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 's') {
      console.log('\n❌  Operación cancelada.');
      process.exit(0);
    }

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
