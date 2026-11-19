# Metro de Bogotá · Operación y mantenimiento

Monitor independiente de titulares y fechas de la [sala de prensa de la Empresa Metro de Bogotá](https://www.metrodebogota.gov.co/noticias). Los enlaces llevan a la publicación original.

`node build-site.mjs` (Node.js 24) genera el sitio en `_site/`. El índice oficial se consulta cada 15 minutos en GitHub Actions. Se revisan las seis primeras páginas y se seleccionan noticias relacionadas con operación, mantenimiento, pruebas y trenes según el titular y la entradilla oficial. La clasificación es automática. Puede omitir artículos que no utilicen términos reconocidos.

En GitHub, la fuente de Pages es **GitHub Actions**. Si falla la consulta o cambia la estructura de origen, el flujo se detiene y se conserva la versión publicada.
