/**
 * Datos constantes para la red social agrícola Wakipe
 * Productos, tipos de instituciones, y catálogos
 */

// Lista de productos agrícolas disponibles
const PRODUCTS = [
  // Tubérculos
  'Papa',
  'Camote',
  'Yuca',
  'Olluco',
  'Mashua',
  
  // Cereales
  'Maíz',
  'Quinua',
  'Kiwicha',
  'Cañihua',
  'Trigo',
  'Cebada',
  'Arroz',
  
  // Legumbres
  'Habas',
  'Frijol',
  'Arveja',
  'Lenteja',
  'Pallar',
  
  // Hortalizas
  'Tomate',
  'Cebolla',
  'Zanahoria',
  'Lechuga',
  'Repollo',
  'Coliflor',
  'Brócoli',
  'Ají',
  'Rocoto',
  'Zapallo',
  
  // Frutas
  'Manzana',
  'Plátano',
  'Naranja',
  'Mandarina',
  'Limón',
  'Palta',
  'Mango',
  'Papaya',
  'Piña',
  'Uva',
  'Durazno',
  'Chirimoya',
  'Lúcuma',
  'Granadilla',
  'Tuna',
  
  // Otros
  'Café',
  'Cacao',
  'Alfalfa',
  'Maracuyá',
  'Sacha inchi'
];

// Unidades de medida
const UNITS = [
  'kg',
  'toneladas',
  'sacos',
  'cajas',
  'jabas',
  'arrobas',
  'quintales'
];

// Tipos de instituciones
const INSTITUTION_TYPES = [
  'cooperativa',
  'centro_acopio',
  'asociacion',
  'municipalidad',
  'agencia_agraria',
  'otro'
];

// Departamentos del Perú
const DEPARTAMENTOS = [
  'Amazonas',
  'Áncash',
  'Apurímac',
  'Arequipa',
  'Ayacucho',
  'Cajamarca',
  'Callao',
  'Cusco',
  'Huancavelica',
  'Huánuco',
  'Ica',
  'Junín',
  'La Libertad',
  'Lambayeque',
  'Lima',
  'Loreto',
  'Madre de Dios',
  'Moquegua',
  'Pasco',
  'Piura',
  'Puno',
  'San Martín',
  'Tacna',
  'Tumbes',
  'Ucayali'
];

// Estados de publicaciones
const PUBLICATION_STATUS = [
  'disponible',
  'en_conversacion',
  'acordado',
  'cerrado'
];

// Roles del sistema
const ROLES = [
  'productor',
  'centro_acopio',
  'admin',
  'super_admin'
];

module.exports = {
  PRODUCTS,
  UNITS,
  INSTITUTION_TYPES,
  DEPARTAMENTOS,
  PUBLICATION_STATUS,
  ROLES
};
