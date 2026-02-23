require('dotenv').config();
const app = require('./app');
const connectDB = require('./src/config/database');

const PORT = process.env.PORT || 3000;
const ENV  = process.env.NODE_ENV || 'development';

connectDB();

app.listen(PORT, () => {
  console.log(`\uD83D\uDE80 Wakipe API corriendo en puerto ${PORT} [${ENV}]`);
  if (ENV !== 'production') {
    console.log(`   http://localhost:${PORT}`);
  }
});