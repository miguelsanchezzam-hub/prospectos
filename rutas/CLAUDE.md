# Ruta de visitas — contexto para Claude Code

App instalable (PWA) que Miguel usa en su iPhone mientras visita prospectos de paneles solares
(Bajío Sustentable para comercial/residencial, Wise Solar Energy para industrial) en León, Gto.
Lee y escribe en su Google Sheet de seguimiento en los **dos sentidos**, mediante un Apps Script propio.

- App publicada: https://miguelsanchezzam-hub.github.io/prospectos/rutas/ (GitHub Pages, rama `main`).
- Vive en la carpeta `rutas/` del repo `miguelsanchezzam-hub/prospectos`. La raíz del repo es OTRA app
  (Prospectos: cazar y calificar prospectos) con su propio `apps-script.gs`, `sw.js` y `index.html`. No la toques
  salvo que se pida.
- Todo el texto de la interfaz y los mensajes van en **español de México**.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la app: HTML + CSS + JS en un solo archivo, sin dependencias ni build. JS ES5 dentro de un IIFE. |
| `rutas-script.gs` | Apps Script que Miguel pega en la hoja "Seguimiento_prospectos_mejorado" (proyecto de Apps Script **distinto** al de Prospección). |
| `sw.js` | Service worker: red primero, caché de respaldo. **Sube `CACHE` (`rutas-vN`) cada vez que cambies `index.html`**, o el iPhone sigue mostrando la versión vieja. |
| `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Instalación en el iPhone. |

El `sw.js` de la raíz ignora a propósito todo lo que esté bajo `/rutas/` (la app de rutas tiene su propio service worker).

## Secretos (nunca en el repo, es público)

- `const TOKEN = 'CAMBIA-ESTE-CODIGO'` se queda así en el repo. Miguel pone su código real solo en su Apps Script.
- La URL `/exec` del script y el código viven en el `localStorage` del teléfono (Ajustes en la app).
- No escribas en el repo el ID de la hoja, la URL del script ni datos de clientes.

## Pantallas

1. **Semana** (antes era "Guion"; Miguel pidió cambiarla por métricas):
   - Tarjeta **Atraso promedio (hoy)**, con meta de **menos de 2 días** (verde si cumple, naranja si no), y los 5 más atrasados.
   - Navegación por semana (lunes a sábado; trabaja lunes a sábado, viernes y sábado hasta la 1:30 pm).
   - KPIs: visitas y estimados enviados contra la meta de "Actividad semanal", contactos útiles, con encargado,
     recibos vistos, WhatsApp/llamadas, negocios nuevos y avances de etapa.
   - Visitas por día y por zona, lista de avances y embudo actual con comisión ponderada contra la meta mensual.
   - Si una semana no tiene registros en la bitácora, usa los números "real" que Miguel capturó a mano en "Actividad semanal".
2. **Registrar**: formulario de visita.
   - Arriba: **¿Qué registras?** con tres opciones: `visita`, `llamada` ("WhatsApp o llamada") y `nota` ("Solo actualizar datos").
     **No hay opción marcada por omisión: es obligatorio elegir.** Antes venía "Visita" marcada y generó visitas falsas.
   - Campos: negocio, dirección, zona, tipo, origen (solo para nuevos), quién atendió (solo si es visita), dueño, horario,
     WhatsApp, refrigeradores, aire acondicionado, ¿vio el recibo?, pago bimestral, etapa, objeción (solo en Perdido o En pausa),
     paso (regresar/whatsapp/cotizar/descartar), "¿Qué sigue?", "¿Cuándo?" y nota de hoy.
   - Si la fecha del siguiente paso ya pasó, aparece el aviso "pon la nueva fecha".
3. **Seguimiento**: lista de negocios con búsqueda.
   - Filtros: Hoy y atrasados, Por visitar, Con siguiente paso, Visitados hoy, Todos. Además, filtro por zona y por tipo.
   - Cada tarjeta muestra los enlaces "Cómo llegar" (Google Maps con negocio + dirección) y WhatsApp (`wa.me/52…`).

Arriba hay un indicador de sincronización (Sin conectar / Sincronizando / N por enviar / Error / Al día). Al tocarlo, sincroniza.
El engrane abre Ajustes: URL, código, "Guardar y probar", "Sincronizar ahora" y respaldo (copiar y restaurar) en JSON.

## Reglas de negocio (importantes, las pidió Miguel)

- **Último contacto** se actualiza **solo** con `visita` o `llamada` (WhatsApp). Con `nota` (solo actualizar datos) **no** cambia.
  El script además lo toma de la bitácora como respaldo, y nunca lo mueve hacia atrás.
- **Atraso** de un prospecto = días que lleva vencida la "Fecha del siguiente paso" (0 si va en tiempo).
  - Un pendiente **se da por atendido** si "Último contacto" ≥ "Fecha del siguiente paso". Así ya no cuenta como atrasado
    ni aparece en "Hoy y atrasados"; la app lo marca "Atendido · falta nueva fecha".
  - El **atraso promedio** solo incluye prospectos ya contactados y abiertos. Se excluyen *Sin contactar*, *En pausa*,
    *Perdido* y *Ganado*. Los que no tienen fecha de siguiente paso no entran en el promedio y se cuentan aparte.
  - Meta: **menos de 2 días** en promedio.
  - La hoja aplica la misma regla en "Resumen del día" (ver abajo). App y hoja deben dar siempre el mismo resultado.
- **Etapas** (en este orden; los nombres deben coincidir con la pestaña Listas): Sin contactar, Contactado, Visita hecha,
  Recibo recibido, Estimado enviado, Crédito / negociación, Ganado, Perdido, En pausa.
- **Tipo**: Comercial / Industrial / Residencial. Industrial va con Wise Solar Energy; comercial y residencial, con Bajío Sustentable.
- **Origen**: Frío / Referido / Lead de la empresa.
- **Zonas** (`zonaId`): Zona1Sureste, Zona2CentroOriente, Zona3Centro, Zona4Poniente, Zona5NorteCentro, Zona6Norte,
  ZonaSilao, ForáneoNorte, Pendiente.
- **Objeciones**: Ya tiene proveedor o competencia, Cierra o vende el negocio, Instalación o técnica, Sin flujo por ahora,
  Confianza, Otra.
- El pago de luz **siempre es bimestral**, aunque la columna de la hoja diga "Recibo mensual (MXN)". En la hoja se guarda
  como texto `"$X,XXX MXN"`.
- La **nota de hoy** se agrega al final de "Comentarios" en la hoja como `dd/mm/aaaa: texto`. Nunca se borra lo anterior.
- Paso "descartar" pone la etapa en Perdido. Al llegar a Perdido o Ganado, el script llena "Fecha de cierre" si está vacía.
- Contacto útil = habló con el encargado, o hay nombre del dueño, horario, teléfono o recibo visto.

## Sincronización (ida y vuelta)

El cliente hace `fetch(POST)` a la URL `/exec` con `Content-Type: text/plain;charset=utf-8`, para evitar el preflight de CORS.
El cuerpo es JSON con `token` y `action`:

- `ping`, que devuelve `{ok, tab, rows}`.
- `pull`, que devuelve:
  - `items`: todos los negocios de "Prospectos", con `key`, los campos de la hoja, `comision`, `comPond`, `prob` y `extra`
    (datos de "App rutas").
  - `log`: la bitácora de los últimos 200 días.
  - `semanas`: las metas de "Actividad semanal".
  - `metaMensual`, que sale de Listas!B8.
- `push` con `items: [{id, key, negocio, changes, extra, contactoFecha, nota, notaFecha, log:[…]}]`:
  - `changes` trae **solo los campos que cambiaron** respecto a `base` (lo último que vino de la hoja). Así no se pisan
    ediciones hechas en la hoja desde otra parte.
  - Devuelve `results: [{id, key, fila, nuevo}]`.

Modelo local (`localStorage`):

- `rutas-v1` guarda `{items, log, semanas, metaMensual, lastPull}`.
- `rutas-cfg-v1` guarda `{url, token}`.
- `rutas-tab` y `rutas-filtro` recuerdan la pestaña y el filtro.
- Cada item tiene `base` (la foto de la hoja) y `pending` (los cambios por enviar).
- Cada guardado agrega una entrada a `log` con `sent:false`.
- Sincronizar = `push()` y luego `pull()`. Se dispara 800 ms después de guardar, al volver la señal y al regresar a la app.
- Sin internet, todo queda en cola ("N por enviar").
- En `pull`, los campos con cambio local pendiente no se sobrescriben.
- Lo que ya no está en la hoja y no tiene pendientes se quita del teléfono.
- **Clave** de cada negocio = nombre normalizado: minúsculas, sin acentos, espacios colapsados. La función `norm` del JS
  y `norm_`/`keyOf_` del script deben quedar idénticas.

## La hoja "Seguimiento_prospectos_mejorado"

**Prospectos**:

- Encabezados en la fila 4; los datos empiezan en la fila 5. El script reconoce las columnas **por nombre de encabezado**, no por letra.
- Columnas actuales:
  - A Negocio, B Encargado, C Contacto, D Zona, E Ubicación, F Tipo, G Origen, H Interés, I Etapa.
  - J Fecha de inicio, K Último contacto, **L Días sin contacto (fórmula)**, M Siguiente paso, N Fecha del siguiente paso,
    O Recibo mensual (MXN).
  - **P ¿Califica? (fórmula)**, Q Tamaño (kW), **R Paneles (fórmula)**, **S Precio con IVA (fórmula)**, **T % comisión (fórmula)**,
    **U Comisión (fórmula)**, **V Probabilidad (fórmula)**, **W Comisión ponderada (fórmula)**.
  - X Objeción principal, Y Fecha de cierre, Z Recibos (n.º de servicio CFE), AA Comentarios.
- Regla de oro del script: **nunca escribir en una celda con fórmula, nunca borrar filas**.
- Los negocios nuevos van a la primera fila vacía después del último dato. Esas filas ya traen las fórmulas.
  Si no hay filas vacías, el script copia las fórmulas R1C1 de la fila anterior.
- Las fechas se escriben como `Date` (al mediodía), no como texto.

Otras pestañas:

- **App rutas** (la crea el script si no existe): Clave, Negocio, Quién atendió, Horario, Refrigeradores, Aire acondicionado,
  Recibo visto, Paso, Primera visita, Actualizado. Son los datos que solo usa la app. Formato texto.
- **Registro de visitas** (bitácora; la crea el script): ID, Fecha, Hora, Tipo (visita/llamada/actualización), Negocio, Clave,
  Quién atendió, Útil, Recibo visto, Etapa antes, Etapa después, Nuevo, Zona. Sin duplicados por ID.
  De aquí salen las métricas de la semana.
- **Actividad semanal**: encabezado "Semana" en la columna A.
  - Columnas: Semana, Fechas ("21 a 25 sep"), Visitas (meta), Visitas (real), %, Estimados (meta), Estimados (real), %.
  - El plan arrancó el lunes 21 sep 2026. El script calcula `inicio` (lunes) de cada semana a partir del texto de fechas.
- **Listas**: B8 = meta de comisión mensual ($150,000). A12:A20 = etapas con probabilidad.
- **Resumen del día** (no lo toca la app):
  - La tabla A8:F22 muestra lo atrasado o para hoy.
  - La columna J8:J157 es la ayuda interna, con una fórmula igual en todas las filas:
    `=LET(n,INDEX(Prospectos!$N:$N,ROW()-3),e,INDEX(Prospectos!$I:$I,ROW()-3),k,INDEX(Prospectos!$K:$K,ROW()-3),IF(AND(n<>"",n<=TODAY(),e<>"Ganado",e<>"Perdido",OR(k="",k<n)),n+ROW()/100000,999999))`
  - Se usa `INDEX(…,ROW()-3)` para que no se descuadre al insertar filas en Prospectos. Ese descuadre ya pasó antes con referencias directas.

## Cómo probar (la nube no llega a github.io ni a script.google.com)

- Sirve la carpeta con `python3 -m http.server` y prueba con Playwright en viewport de **390×844** (iPhone).
  Revisa que no haya scroll horizontal (`document.documentElement.scrollWidth <= 390`) ni errores de página.
- Para el backend, corre `rutas-script.gs` **tal cual** en Node con `vm` y simula: `SpreadsheetApp` (una hoja en memoria con
  `getDataRange/getValues/getFormulas/getFormulasR1C1/setValue/setValues/setFormulaR1C1/getLastRow/insertSheet`),
  `Session.getScriptTimeZone`, `Utilities.formatDate`, `LockService` y `ContentService`.
  - Marca como fórmula las columnas L, P, R–W. El mock debe **fallar si se escribe sobre una fórmula**.
  - En Playwright, intercepta `https://script.google.com/macros/s/TEST/exec` con `context.route` y reenvía al mock.
  - Pon `localStorage['rutas-cfg-v1'] = {url, token}` antes de recargar.
- Casos que conviene cubrir:
  - Visita: cambia etapa, último contacto y nota.
  - Solo actualizar: no toca último contacto.
  - Negocio nuevo: cae en la primera fila vacía con las fórmulas intactas.
  - Cambio hecho en la hoja: llega a la app.
  - Sin internet: queda en cola y se envía al volver.
  - Atraso promedio y Resumen del día dan lo mismo.
- Después de editar el `<head>`, verifica con `grep` que el manifest, el apple-touch-icon y el título sí quedaron. Ya pasó una vez que no.

## Publicar

1. Commit y push a `main`. GitHub Pages publica solo en ~1 minuto.
2. Sube `CACHE` en `rutas/sw.js`.
3. Si cambió `rutas-script.gs`, Miguel tiene que pegarlo en su Apps Script **conservando su TOKEN** y luego ir a
   Implementar → Administrar implementaciones → lápiz → Versión: **Nueva versión** → Implementar. La URL no cambia.
   Mientras no lo haga, la app funciona con el script viejo, pero sin lo nuevo.
4. En el iPhone: cerrar la app por completo y volver a abrirla. Si cambiaron el ícono o el nombre, hay que borrar el acceso
   directo y volverlo a agregar desde Safari.

## Cómo trabajar con Miguel

- Trabaja desde el iPhone casi siempre. Explicaciones cortas, en español, sin jerga. Pasos manuales numerados y concretos
  (Apps Script en el celular solo se edita con "sitio de escritorio").
- **Si un mensaje empieza con "duda", no cambies nada: solo responde la pregunta.**
- Pídele captura o el texto exacto del error antes de adivinar fallas de conexión.
- Cosas que ya rechazó o cambió (no las repitas sin preguntar):
  - Aviso diario de pendientes **por correo**: lo quitó ("así no").
  - Pantalla de guion: la reemplazó por Semana.
  - Visita marcada por omisión: se quitó.
- Ideas pendientes que se le ofrecieron y no decidió: notificaciones vía Recordatorios del iPhone o Calendario de Google;
  devolver el guion como sección plegable dentro de Registrar; que el script llene solo "Visitas (real)" de Actividad semanal.
