/**
 * Prospectos → Google Sheets
 *
 * Recibe los prospectos calificados desde la app (PWA) y los guarda en la pestaña
 * "App prospectos" de ESTA hoja de cálculo. Si el prospecto ya existe (mismo ID),
 * actualiza su fila; si no, agrega una nueva. Nunca borra filas.
 *
 * Columnas A–P = mismas que tu pestaña "Calificación de prospectos".
 * Columnas Q–R = ID y fecha de actualización (las usa el script para no duplicar).
 *
 * PASOS
 * 1. Abre tu hoja "Prospección" → Extensiones → Apps Script.
 * 2. Borra lo que haya, pega este archivo completo y cambia el CÓDIGO de abajo.
 * 3. Implementar → Nueva implementación → tipo "Aplicación web".
 *      - Ejecutar como: Yo
 *      - Quién tiene acceso: Cualquier persona
 *    Autoriza los permisos la primera vez.
 * 4. Copia la URL que termina en /exec y pégala en la app: Ajustes → URL.
 *    En Ajustes → Código escribe el mismo CÓDIGO que pusiste aquí.
 *
 * 5. (Para "Buscar nuevos") Configuración del proyecto (engrane) → Propiedades del script →
 *    Agregar propiedad: PLACES_KEY = tu llave de Google Maps Platform (Places API (New)).
 *    Limita la llave solo a Places API y pon una alerta de presupuesto en Google Cloud.
 *
 * Si cambias este script después, usa Implementar → Administrar implementaciones →
 * editar → Nueva versión. La URL se conserva.
 */

const TOKEN = 'CAMBIA-ESTE-CODIGO';   // <- pon aquí un código largo y privado
const SHEET_ID = '';                  // vacío = la hoja a la que está vinculado este script
const TAB = 'App prospectos';

const HEADERS = [
  'Nombre del negocio', 'Giro', 'Segmento', 'Dirección', 'Municipio', 'Teléfono', 'Fuente',
  'Tamaño estimado', 'Consumo estimado (kWh/mes)', 'Tarifa CFE probable',
  '¿Tiene refrigeración/AC/motores grandes?', 'Turnos de operación', 'Puntaje (1-5)', 'Prioridad',
  'Estatus de contacto', 'Notas', 'ID', 'Actualizado'
];
const ID_COL = 17;          // columna Q
const NUMERIC_COLS = [9, 13]; // consumo y puntaje se guardan como número

function doGet() {
  return out_({ ok: true, msg: 'Prospectos: script activo' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return out_({ ok: false, error: 'Código incorrecto' });

    if (body.action === 'ping') {
      const sh = getSheet_();
      return out_({
        ok: true, tab: TAB, rows: Math.max(0, sh.getLastRow() - 1),
        places: !!PropertiesService.getScriptProperties().getProperty('PLACES_KEY')
      });
    }
    if (body.action === 'buscar') return out_(buscar_(body));
    if (body.action !== 'upsert') return out_({ ok: false, error: 'Acción desconocida' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return out_(upsert_(body.rows || []));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function upsert_(rows) {
  const sh = getSheet_();
  const last = sh.getLastRow();
  const index = {};
  if (last > 1) {
    sh.getRange(2, ID_COL, last - 1, 1).getValues().forEach(function (r, i) {
      if (r[0]) index[String(r[0])] = i + 2;
    });
  }

  let added = 0, updated = 0;
  const toAppend = [];
  rows.forEach(function (r) {
    if (!r || !r.id) return;
    const vals = toValues_(r);
    if (index[r.id]) {
      sh.getRange(index[r.id], 1, 1, HEADERS.length).setValues([vals]);
      updated++;
    } else {
      toAppend.push(vals);
      added++;
    }
  });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, HEADERS.length).setValues(toAppend);
  }
  return { ok: true, added: added, updated: updated };
}

function toValues_(r) {
  const num = function (v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    return isFinite(n) ? n : '';
  };
  return [
    r.nombre, r.giro, r.segmento, r.direccion, r.municipio, r.telefono, r.fuente,
    r.tamano, num(r.consumo), r.tarifa, r.equipo, r.turnos, num(r.puntaje), r.prioridad,
    r.estatus, r.notas, r.id, r.updated
  ].map(function (v) { return v === null || v === undefined ? '' : v; });
}

/* ================= Buscar nuevos prospectos (Google Places) =================
 * La llave de Google NUNCA va en la app: se guarda en
 * Configuración del proyecto → Propiedades del script → PLACES_KEY.
 * Cada llamada a Places se cobra por búsqueda (con teléfono: nivel "Enterprise").
 */
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const CENTER = { latitude: 21.1250, longitude: -101.6860 };  // León, Gto.
const RADIUS = 25000;                                         // metros
const KNOWN_TABS = ['Calificación de prospectos', TAB];      // pestañas contra las que se compara

function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function phone10_(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
function nameKey_(name, addr) { return norm_(name) + '|' + norm_(addr).slice(0, 14); }

// Nombres/direcciones/teléfonos que ya tienes en la hoja (A=nombre, D=dirección, F=teléfono)
function knownSet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const keys = {}, phones = {};
  KNOWN_TABS.forEach(function (t) {
    const sh = ss.getSheetByName(t);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (r[0]) keys[nameKey_(r[0], r[3])] = 1;
      const p = phone10_(r[5]);
      if (p) phones[p] = 1;
    });
  });
  return { keys: keys, phones: phones };
}

function buscar_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('PLACES_KEY');
  if (!key) return { ok: false, error: 'Falta PLACES_KEY en las Propiedades del script' };
  const q = String(body.query || '').trim();
  if (!q) return { ok: false, error: 'Escribe qué buscar' };

  const withPhone = body.phone !== false;
  const mask = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.businessStatus']
    .concat(withPhone ? ['places.nationalPhoneNumber'] : [])
    .concat(['nextPageToken']).join(',');
  const payload = {
    textQuery: q, languageCode: 'es', regionCode: 'MX', pageSize: 20,
    locationBias: { circle: { center: CENTER, radius: RADIUS } }
  };
  if (body.pageToken) payload.pageToken = body.pageToken;

  const res = UrlFetchApp.fetch(PLACES_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
    payload: JSON.stringify(payload)
  });
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* respuesta no JSON */ }
  if (code !== 200) {
    return { ok: false, error: 'Google respondió ' + code + ': ' + ((data.error && data.error.message) || 'sin detalle') };
  }

  const known = knownSet_();
  const seen = {};
  const places = [];
  let enHoja = 0, cerrados = 0;
  (data.places || []).forEach(function (p) {
    const name = p.displayName && p.displayName.text || '';
    if (!name || seen[p.id]) return;
    seen[p.id] = 1;
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { cerrados++; return; }
    const addr = String(p.formattedAddress || '').replace(/,\s*México$/i, '');
    const tel = p.nationalPhoneNumber || '';
    const ph = phone10_(tel);
    if (known.keys[nameKey_(name, addr)] || (ph && known.phones[ph])) { enHoja++; return; }
    places.push({ placeId: p.id, nombre: name, direccion: addr, telefono: tel });
  });
  return { ok: true, places: places, enHoja: enHoja, cerrados: cerrados, nextPageToken: data.nextPageToken || '' };
}

function getSheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  if (sh.getLastRow() === 0) {
    // Texto plano en todas las columnas menos las numéricas: así un nombre que empiece
    // con "=" o "+" nunca se interpreta como fórmula.
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');
    NUMERIC_COLS.forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('General'); });
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF').setWrap(true);
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 1, 220);
    sh.setColumnWidths(2, 3, 150);
    sh.setColumnWidth(4, 260);
    sh.setColumnWidths(5, 12, 120);
    sh.setColumnWidth(16, 260);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
