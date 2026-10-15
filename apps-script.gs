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
 *    OPCIÓN GRATIS: DENUE_TOKEN = tu token gratuito de INEGI (directorio oficial de negocios).
 *    OPCIÓN DE PAGO: PLACES_KEY = tu llave de Google Maps Platform (Places API (New)).
 *    Si hay las dos, se usa DENUE. Con Google, limita la llave solo a Places API y pon alerta de presupuesto.
 *
 * Si cambias este script después, usa Implementar → Administrar implementaciones →
 * editar → Nueva versión. La URL se conserva.
 */

const TOKEN = 'CAMBIA-ESTE-CODIGO';   // <- pon aquí un código largo y privado
const SHEET_ID = '';                  // DÉJALO VACÍO si abriste el script desde la hoja (Extensiones → Apps Script)
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
        places: !!PropertiesService.getScriptProperties().getProperty('PLACES_KEY'),
        denue: !!PropertiesService.getScriptProperties().getProperty('DENUE_TOKEN')
      });
    }
    if (body.action === 'buscar') return out_(buscar_(body));
    if (body.action === 'seguimiento') return out_(seguimiento_());
    if (body.action === 'pull') return out_(pull_());
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

// Acepta el ID solo o la dirección completa del documento (…/d/ID/edit?gid=…)
function cleanId_(s) {
  s = String(s || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s.split(/[\/?#]/)[0];
}

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
  const ss = SHEET_ID ? SpreadsheetApp.openById(cleanId_(SHEET_ID)) : SpreadsheetApp.getActiveSpreadsheet();
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

/* ---------- DENUE (INEGI): gratis, directorio oficial de negocios ---------- */
const DENUE_URL = 'https://www.inegi.org.mx/app/api/denue/v1/consulta/BuscarAreaActEstr/';
const DENUE_ENTIDAD = '11';      // Guanajuato
const DENUE_MUNICIPIO = '020';   // León
const DENUE_PAGE = 100;          // registros por consulta

function titleCase_(s) {
  s = String(s || '').trim();
  if (s !== s.toUpperCase()) return s;   // ya tiene minúsculas: se respeta
  return s.toLowerCase().replace(/(^|[\s\-\/(.])([a-záéíóúñü])/g, function (m, a, b) { return a + b.toUpperCase(); });
}
function digits_(v, max) { const d = String(v || '').replace(/\D/g, ''); return d && d.length <= max ? d : '0'; }

function buscarDenue_(body, token) {
  const sp = body.denue || {};
  const nombre = String(sp.nombre || '').trim();
  const act = [digits_(sp.sector, 2), digits_(sp.subsector, 3), digits_(sp.rama, 4), digits_(sp.clase, 6)];
  if (!nombre && act.every(function (x) { return x === '0'; })) return { ok: false, error: 'Elige un giro o escribe qué buscar' };
  const minEmp = Number(sp.min) || 0;
  const zona = norm_(body.zona || '').replace(/,?\s*leon.*$/, '').trim();
  const known = knownSet_();
  const seen = {}, places = [];
  let enHoja = 0, start = Number(body.pageToken) || 1, next = '', calls = 0, error = '';

  while (calls < 4 && places.length < 20) {
    calls++;
    const url = DENUE_URL + [DENUE_ENTIDAD, DENUE_MUNICIPIO, 0, 0, 0].concat(act).concat([
      nombre ? encodeURIComponent(nombre) : '0', start, start + DENUE_PAGE - 1, 0, 0, token]).join('/');
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    let data = null;
    const txt = res.getContentText() || '';
    try { data = JSON.parse(txt); } catch (e) { /* no JSON */ }
    if (code !== 200 || !Array.isArray(data)) {
      // INEGI responde 200 con [] o error de texto cuando no hay resultados
      if (code === 200 && /no se encontr|sin resultados/i.test(txt)) { data = []; }
      else { error = 'INEGI respondió ' + code + ': ' + txt.slice(0, 160); break; }
    }
    data.forEach(function (r) {
      const id = String(r.Id || r.CLEE || '');
      if (!id || seen[id]) return;
      seen[id] = 1;
      const name = titleCase_(r.Nombre || r.Razon_social);
      if (!name) return;
      const est = String(r.Estrato || '');
      const m = est.match(/\d+/);
      if (minEmp && m && Number(m[0]) < minEmp) return;
      const calle = [r.Tipo_vialidad, r.Calle, r.Num_Exterior].filter(String).join(' ').trim();
      const addr = [titleCase_(calle), titleCase_(r.Colonia), r.CP ? 'C.P. ' + r.CP : ''].filter(String).join(', ');
      if (zona && norm_(addr).indexOf(zona) === -1) return;
      const tel = String(r.Telefono || '').trim();
      const ph = phone10_(tel);
      if (known.keys[nameKey_(name, addr)] || (ph && known.phones[ph])) { enHoja++; return; }
      places.push({ placeId: id, nombre: name, direccion: addr, telefono: tel, tamano: est, giroReal: String(r.Clase_actividad || '') });
    });
    if (data.length >= DENUE_PAGE) { start += DENUE_PAGE; next = String(start); } else { next = ''; break; }
  }
  if (error && !places.length) return { ok: false, error: error };
  return { ok: true, places: places, enHoja: enHoja, cerrados: 0, nextPageToken: next, fuente: 'DENUE (INEGI)' };
}

function buscar_(body) {
  const props = PropertiesService.getScriptProperties();
  const dtoken = props.getProperty('DENUE_TOKEN');
  if (dtoken) return buscarDenue_(body, dtoken);
  const key = props.getProperty('PLACES_KEY');
  if (!key) return { ok: false, error: 'Falta DENUE_TOKEN (gratis) o PLACES_KEY en las Propiedades del script' };
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

/* ================= Seguimiento (pipeline de tu documento de seguimiento) =================
 * Lee la pestaña "Prospectos" de "Seguimiento_prospectos_mejorado" y se la manda a la app.
 * Esos datos son privados: viajan solo con tu código secreto y se guardan solo en tu celular.
 * Las columnas se reconocen por el NOMBRE del encabezado (no por su posición).
 */
const SEG_SHEET_ID = '1HMYvjpsh1yWWOC0uKFnV5Fa9S6U2g5Y7yifAgt1Xfrc';  // "Seguimiento_prospectos_mejorado"
const SEG_TAB = 'Prospectos';
// 1) Encabezados EXACTOS (ya normalizados: sin acentos, minúsculas). Se prueban primero.
const SEG_EXACT = {
  negocio: ['negocio'], encargado: ['encargado'], contacto: ['contacto'], zona: ['zona'], tipo: ['tipo'], etapa: ['etapa'],
  recibo: ['recibo mensual (mxn)', 'recibo mensual'], precio: ['precio con iva (mxn)', 'precio con iva'],
  comision: ['comision (mxn)', 'comision'], comPond: ['comision ponderada (mxn)', 'comision ponderada'],
  prob: ['probabilidad'], objecion: ['objecion principal', 'objecion'],
  fechaSig: ['fecha del siguiente paso', 'fecha siguiente paso', 'fecha de siguiente paso'],
  sigPaso: ['siguiente paso', 'proximo paso'], comentarios: ['comentarios', 'comentario', 'notas']
};
// 2) Si algún encabezado no coincide exacto, se busca por parecido (solo en columnas todavía libres).
const SEG_RULES = [
  ['encargado', /encargad|responsable|dueno/],
  ['negocio', /negocio|nombre/],
  ['comPond', /ponderad/],
  ['comision', /^comision(?!.*(ponderad|%))/],
  ['contacto', /^(telefono|contacto|celular|whats)/],
  ['zona', /zona/],
  ['tipo', /^tipo|giro|segmento/],
  ['etapa', /^etapa|estatus|estado/],
  ['recibo', /^recibo/],
  ['precio', /precio|inversion|monto|cotiza/],
  ['prob', /probab/],
  ['objecion', /objeci/],
  ['fechaSig', /fecha.*(siguiente|proximo)/],
  ['sigPaso', /^(siguiente|proximo) (paso|accion)|^accion/],
  ['comentarios', /comentario|^notas?$|observ/]
];

function segMap_(row) {
  const heads = row.map(function (h) { return norm_(h); });
  const map = {}, used = {};
  Object.keys(SEG_EXACT).forEach(function (key) {
    for (let i = 0; i < heads.length; i++) {
      if (!used[i] && heads[i] && SEG_EXACT[key].indexOf(heads[i]) !== -1) { map[key] = i; used[i] = 1; return; }
    }
  });
  SEG_RULES.forEach(function (rule) {
    if (map[rule[0]] !== undefined) return;
    for (let i = 0; i < heads.length; i++) {
      if (!used[i] && heads[i] && rule[1].test(heads[i])) { map[rule[0]] = i; used[i] = 1; return; }
    }
  });
  return map;
}
function segNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function segDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function segText_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function seguimiento_() {
  const ss = SpreadsheetApp.openById(cleanId_(SEG_SHEET_ID));
  const sh = ss.getSheetByName(SEG_TAB);
  if (!sh) return { ok: false, error: 'No encontré la pestaña «' + SEG_TAB + '» en el documento de seguimiento' };
  const data = sh.getDataRange().getValues();
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const m = segMap_(data[i]);
    if (Object.keys(m).length >= 3 && m.negocio !== undefined) { hi = i; map = m; break; }
  }
  if (hi < 0 || map.etapa === undefined) {
    return { ok: false, error: 'No reconocí los encabezados (necesito al menos Negocio y Etapa). Primera fila: ' + data[0].filter(String).slice(0, 12).join(' | ') };
  }
  const get = function (r, k) { return map[k] === undefined ? '' : r[map[k]]; };
  const rows = [];
  for (let i = hi + 1; i < data.length; i++) {
    const r = data[i];
    const negocio = segText_(get(r, 'negocio'));
    if (!negocio) continue;
    let prob = segNum_(get(r, 'prob'));
    if (prob !== null && prob > 0 && prob <= 1) prob = Math.round(prob * 100);
    const comision = segNum_(get(r, 'comision'));
    let pond = segNum_(get(r, 'comPond'));
    if (pond === null && comision !== null && prob !== null) pond = comision * prob / 100;
    rows.push({
      negocio: negocio, encargado: segText_(get(r, 'encargado')), contacto: segText_(get(r, 'contacto')),
      zona: segText_(get(r, 'zona')), tipo: segText_(get(r, 'tipo')), etapa: segText_(get(r, 'etapa')) || 'Sin contactar',
      recibo: segNum_(get(r, 'recibo')), precio: segNum_(get(r, 'precio')), comision: comision, prob: prob, comPond: pond,
      objecion: segText_(get(r, 'objecion')), fechaSig: segDate_(get(r, 'fechaSig')), sigPaso: segText_(get(r, 'sigPaso')),
      comentarios: segText_(get(r, 'comentarios'))
    });
  }
  const faltan = SEG_RULES.map(function (x) { return x[0]; }).filter(function (k) { return map[k] === undefined; });
  const res = { ok: true, rows: rows, faltan: faltan };
  try { Object.assign(res, panelExtra_(ss)); } catch (e) {}
  return res;
}

// Meta mensual (Listas) y actividad semanal (meta contra real), para el panel de la app.
function panelExtra_(ss) {
  const out = { meta: null, semanas: [] };
  const li = ss.getSheetByName('Listas');
  if (li) {
    const v = segNum_(li.getRange('B8').getValue());
    if (v) out.meta = v;
  }
  const ac = ss.getSheetByName('Actividad semanal');
  if (ac) {
    const d = ac.getDataRange().getValues();
    let hi = -1;
    for (let i = 0; i < Math.min(10, d.length); i++) if (norm_(d[i][0]) === 'semana') { hi = i; break; }
    if (hi >= 0) {
      for (let i = hi + 1; i < d.length; i++) {
        const n = segNum_(d[i][0]);
        if (n === null || !/^\s*\d+\s*$/.test(String(d[i][0]))) break;
        out.semanas.push({ n: n, fechas: segText_(d[i][1]), vMeta: segNum_(d[i][2]), vReal: segNum_(d[i][3]), eMeta: segNum_(d[i][5]), eReal: segNum_(d[i][6]) });
      }
    }
  }
  return out;
}

// Devuelve todo lo guardado en "App prospectos" para que otros dispositivos se pongan al día.
function pull_() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  const t = function (v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
    return v === null || v === undefined ? '' : String(v);
  };
  const rows = [];
  sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (v) {
    if (!v[ID_COL - 1] || !v[0]) return;
    rows.push({
      nombre: t(v[0]), giro: t(v[1]), segmento: t(v[2]), direccion: t(v[3]), municipio: t(v[4]),
      telefono: t(v[5]), fuente: t(v[6]), tamano: t(v[7]),
      consumo: typeof v[8] === 'number' ? v[8] : '', tarifa: t(v[9]), equipo: t(v[10]), turnos: t(v[11]),
      estatus: t(v[14]), notas: t(v[15]), id: t(v[ID_COL - 1]), updated: t(v[17])
    });
  });
  return { ok: true, rows: rows };
}

function getSheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(cleanId_(SHEET_ID)) : SpreadsheetApp.getActiveSpreadsheet();
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
