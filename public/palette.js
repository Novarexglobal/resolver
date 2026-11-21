// Aplica la paleta guardada antes de pintar la página, para que no parpadee el color.
// Se carga en el head como script externo (la política de contenido no admite scripts en línea).
(function () {
  try {
    var saved = localStorage.getItem('resolver.palette');
    if (saved === 'ion' || saved === 'brasa' || saved === 'musgo' || saved === 'hielo') {
      document.documentElement.setAttribute('data-palette', saved);
    }
  } catch (e) {
    /* sin almacenamiento disponible: se usa la paleta por defecto */
  }
})();
