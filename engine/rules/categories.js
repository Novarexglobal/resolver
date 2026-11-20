// Categorías y marcas. Palabras clave sobre texto plegado (sin acentos). Son sugerencias: la categoría declarada siempre tiene prioridad.

// Nombres que RESOLVER acepta (árbol del módulo 7: raíces y subcategorías conservadas)
export const CATEGORY_NAMES = [
  'Tecnología y teléfonos',
  'Celulares',
  'Electrónica',
  'Electrodomésticos',
  'Informática',
  'Computadoras',
  'Vehículos',
  'Motocicletas y bicicletas',
  'Hogar y muebles',
  'Hogar',
  'Ropa y calzado',
  'Belleza y cuidado personal',
  'Alimentación',
  'Ferretería y construcción',
  'Herramientas',
  'Deportes',
  'Repuestos y accesorios',
  'Otros',
];

// Orden importa: en empate gana la primera regla.
export const KEYWORD_RULES = [
  { category: 'Celulares', words: ['celular', 'celulares', 'smartphone', 'telefono', 'iphone', 'galaxy', 'redmi', 'xiaomi', 'huawei', 'motorola', 'moto g', 'android'] },
  { category: 'Computadoras', words: ['laptop', 'computadora', 'pc', 'macbook', 'notebook', 'portatil', 'all in one'] },
  { category: 'Electrónica', words: ['televisor', 'tv', 'smart tv', 'bocina', 'bocinas', 'audifonos', 'consola', 'playstation', 'xbox', 'camara', 'parlante', 'tablet', 'ipad'] },
  { category: 'Electrodomésticos', words: ['nevera', 'refrigerador', 'lavadora', 'licuadora', 'microondas', 'ventilador', 'aire acondicionado', 'batidora', 'plancha', 'arrocera', 'freidora', 'cocina electrica', 'olla'] },
  { category: 'Vehículos', words: ['carro', 'auto', 'automovil', 'camioneta', 'jeep', 'camion', 'vehiculo'] },
  { category: 'Motocicletas y bicicletas', words: ['moto', 'motocicleta', 'scooter', 'bicicleta', 'bici'] },
  { category: 'Hogar y muebles', words: ['sofa', 'mesa', 'cama', 'colchon', 'silla', 'sillas', 'armario', 'buro', 'gabinete', 'closet'] },
  { category: 'Ropa y calzado', words: ['ropa', 'camisa', 'pantalon', 'vestido', 'zapatos', 'tenis', 'zapatillas', 'calzado', 'chaqueta', 'blusa'] },
  { category: 'Belleza y cuidado personal', words: ['perfume', 'crema', 'shampoo', 'maquillaje', 'secador', 'cosmetico', 'cosmeticos'] },
  { category: 'Alimentación', words: ['aceite', 'arroz', 'cafe', 'azucar', 'harina', 'pollo', 'queso', 'galletas', 'refresco'] },
  { category: 'Ferretería y construcción', words: ['cemento', 'tornillo', 'tornillos', 'pintura', 'tuberia', 'ladrillo', 'bloque', 'clavos', 'plomeria'] },
  { category: 'Herramientas', words: ['taladro', 'martillo', 'llave', 'destornillador', 'sierra', 'amoladora', 'soldadora', 'herramienta'] },
  { category: 'Deportes', words: ['pelota', 'balon', 'pesas', 'mancuerna', 'mancuernas', 'raqueta', 'guantes de boxeo', 'deportivo'] },
  { category: 'Repuestos y accesorios', words: ['repuesto', 'repuestos', 'pieza', 'filtro', 'funda', 'cargador', 'cable', 'protector de pantalla', 'accesorio', 'accesorios'] },
];

// Marcas: alias de producto → marca. Solo se sugieren; si la fuente publica la marca, se usa la declarada.
export const BRANDS = [
  { brand: 'Apple', words: ['apple', 'iphone', 'ipad', 'macbook', 'imac', 'airpods'] },
  { brand: 'Samsung', words: ['samsung', 'galaxy'] },
  { brand: 'Xiaomi', words: ['xiaomi', 'redmi'] },
  { brand: 'Huawei', words: ['huawei', 'honor'] },
  { brand: 'Motorola', words: ['motorola'] },
  { brand: 'LG', words: ['lg'] },
  { brand: 'Sony', words: ['sony', 'playstation'] },
  { brand: 'HP', words: ['hp'] },
  { brand: 'Lenovo', words: ['lenovo', 'thinkpad'] },
  { brand: 'Dell', words: ['dell'] },
  { brand: 'Asus', words: ['asus'] },
  { brand: 'Acer', words: ['acer'] },
  { brand: 'Mabe', words: ['mabe'] },
  { brand: 'Whirlpool', words: ['whirlpool'] },
  { brand: 'Haier', words: ['haier'] },
  { brand: 'Hisense', words: ['hisense'] },
  { brand: 'Oster', words: ['oster'] },
  { brand: 'JBL', words: ['jbl'] },
  { brand: 'Nintendo', words: ['nintendo'] },
];
