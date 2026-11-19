# Metro de Bogotá · Operación y mantenimiento

Monitor independiente de titulares y fechas de la [sala de prensa de la Empresa Metro de Bogotá](https://www.metrodebogota.gov.co/noticias). Los enlaces llevan a la publicación original.

`node build-site.mjs` (Node.js 24 y PowerShell 7) genera el sitio en `_site/`. El índice oficial se consulta cada 15 minutos en GitHub Actions. La fuente alternativa es la [sección de Metro del Portal Bogotá](https://bogota.gov.co/tag/metro-de-bogota). Se revisan las seis primeras páginas de la fuente consultada y se seleccionan noticias relacionadas con operación, mantenimiento, pruebas y trenes según el titular y la entradilla oficial. La clasificación es automática. Puede omitir artículos que no utilicen términos reconocidos.

En GitHub, la fuente de Pages es **GitHub Actions**. Las noticias de referencia que no aparezcan en la consulta actual se marcan como archivo. Si falla la consulta o cambia la estructura de origen, el flujo se detiene y se conserva la versión publicada.
