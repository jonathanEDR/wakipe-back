const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Verificar conexión al iniciar
const verifyConnection = async () => {
  try {
    const result = await cloudinary.api.ping();
    console.log('☁️  Cloudinary conectado:', result.status);
    return true;
  } catch (error) {
    console.error('❌ Error conectando a Cloudinary:', error.message);
    return false;
  }
};

module.exports = { cloudinary, verifyConnection };
