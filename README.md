# Prospectos Solar

App instalable (PWA) para cazar, calificar y dar seguimiento a prospectos de Bajío Sustentable y Wise Solar Energy.

- `index.html`, `manifest.json`, `sw.js`, íconos: la app.
- `apps-script.gs`: se pega en Apps Script (hoja "Prospección"). Recibe lo calificado y hace de proxy de Google Places. El código secreto y la llave de Google NO van en este repo.

## Ruta de visitas (`rutas/`)

Segunda app instalable, en `https://miguelsanchezzam-hub.github.io/prospectos/rutas/`. Registra visitas y se sincroniza en los dos sentidos con la hoja "Seguimiento_prospectos_mejorado" mediante `rutas/rutas-script.gs` (se pega en el Apps Script de esa hoja). El código secreto no va en este repo.
