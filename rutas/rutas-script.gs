/**
 * Ruta de visitas ⇄ Seguimiento_prospectos_mejorado
 *
 * Comunicación de ida y vuelta entre la app "Ruta de visitas" y tu hoja de seguimiento:
 *   - "pull": manda a la app todos los negocios de la pestaña "Prospectos"
 *             (más los datos de visita que solo usa la app, guardados en la pestaña "App rutas").
 *   - "push": recibe lo que registraste en la app y lo escribe en "Prospectos":
 *             etapa, último contacto, siguiente paso y su fecha, encargado, teléfono, zona,
 *             dirección, tipo, recibo, objeción, fecha de cierre y una nota fechada en Comentarios.
 *             Si el negocio no existe, lo agrega en la primera fila vacía.
 *
 * Reglas de seguridad:
 *   - NUNCA escribe en una celda que tenga fórmula (Días sin contacto, Califica, Paneles, Precio, etc.).
 *   - NUNCA borra filas.
 *   - Las columnas se reconocen por el nombre del encabezado, no por su posición.
 *
 * PASOS
 * 1. Abre "Seguimiento_prospectos_mejorado" → Extensiones → Apps Script.
 *    (Es un proyecto NUEVO, distinto al de Prospección; no toques ese.)
 * 2. Borra lo que haya, pega este archivo completo y cambia el CÓDIGO de abajo.
 * 3. Implementar → Nueva implementación → tipo "Aplicación web".
 *      - Ejecutar como: Yo
 *      - Quién tiene acceso: Cualquier persona
 *    Autoriza los permisos la primera vez.
 * 4. Copia la URL que termina en /exec y pégala en la app: Ajustes → URL.
 *    En Ajustes → Código escribe el mismo CÓDIGO que pusiste aquí.
 *
 * Si cambias este script después: Implementar → Administrar implementaciones →
 * editar (lápiz) → Versión: Nueva versión → Implementar. La URL se conserva.
 */

const TOKEN = 'CAMBIA-ESTE-CODIGO';   // <- pon aquí un código largo y privado
const TAB = 'Prospectos';
const EXTRA_TAB = 'App rutas';

// Encabezados de "Prospectos" (normalizados: minúsculas, sin acentos) → campo de la app
const COLS = {
  negocio: ['negocio'],
  encargado: ['encargado'],
  contacto: ['contacto'],
  zona: ['zona'],
  ubicacion: ['ubicacion', 'direccion'],
  tipo: ['tipo'],
  origen: ['origen'],
  interes: ['interes'],
  etapa: ['etapa'],
  fechaInicio: ['fecha de inicio'],
  ultimoContacto: ['ultimo contacto'],
  sigPaso: ['siguiente paso'],
  fechaSig: ['fecha del siguiente paso'],
  recibo: ['recibo mensual (mxn)', 'recibo mensual', 'recibo bimestral (mxn)', 'recibo bimestral'],
  kw: ['tamano (kw)'],
  objecion: ['objecion principal'],
  fechaCierre: ['fecha de cierre'],
  comentarios: ['comentarios'],
  comision: ['comision (mxn)'],
  comPond: ['comision ponderada (mxn)'],
  prob: ['probabilidad']
};
const DATE_FIELDS = { fechaInicio: 1, ultimoContacto: 1, fechaSig: 1, fechaCierre: 1 };
const EXTRA_HEADERS = ['Clave', 'Negocio', 'Quién atendió', 'Horario', 'Refrigeradores',
  'Aire acondicionado', 'Recibo visto', 'Paso', 'Primera visita', 'Actualizado'];
const EXTRA_KEYS = ['quien', 'horario', 'refris', 'aire', 'reciboVisto', 'paso', 'visitado'];
// Bitácora de cada visita/llamada registrada en la app (para las métricas de la semana).
const LOG_TAB = 'Registro de visitas';
const LOG_HEADERS = ['ID', 'Fecha', 'Hora', 'Tipo', 'Negocio', 'Clave', 'Quién atendió', 'Útil',
  'Recibo visto', 'Etapa antes', 'Etapa después', 'Nuevo', 'Zona'];
const LOG_KEYS = ['id', 'fecha', 'hora', 'tipo', 'negocio', 'key', 'quien', 'util', 'reciboVisto',
  'etapaAntes', 'etapaDespues', 'nuevo', 'zona'];
const LOG_DAYS = 200;   // días de historia que se mandan a la app

function doGet() {
  return out_({ ok: true, msg: 'Ruta de visitas: script activo' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return out_({ ok: false, error: 'Código incorrecto' });
    if (body.action === 'ping') {
      const t = table_();
      return out_({ ok: true, tab: TAB, rows: t.rows.filter(function (r) { return r.key; }).length });
    }
    if (body.action === 'pull') return out_(pull_());
    if (body.action === 'push') {
      const lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try { return out_(push_(body.items || [])); }
      finally { lock.releaseLock(); }
    }
    return out_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------------- utilidades ---------------- */
function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function keyOf_(name) { return norm_(name); }
function tz_() { return Session.getScriptTimeZone() || 'America/Mexico_City'; }
function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function toDate_(isoStr) {
  const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : '';
}
function dmy_(isoStr) {
  const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}
function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function money_(n) {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' MXN';
}
function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/* ---------------- lectura de "Prospectos" ---------------- */
function table_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB);
  if (!sh) throw new Error('No encontré la pestaña «' + TAB + '»');
  const range = sh.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas();
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(12, values.length); i++) {
    const heads = values[i].map(norm_);
    const m = {};
    Object.keys(COLS).forEach(function (k) {
      for (let c = 0; c < heads.length; c++) {
        if (COLS[k].indexOf(heads[c]) !== -1) { m[k] = c; return; }
      }
    });
    if (m.negocio !== undefined && m.etapa !== undefined) { hi = i; map = m; break; }
  }
  if (hi < 0) throw new Error('No reconocí los encabezados de «' + TAB + '» (necesito Negocio y Etapa)');
  const rows = [];
  for (let i = hi + 1; i < values.length; i++) {
    const name = text_(values[i][map.negocio]);
    rows.push({ r: i + 1, key: name ? keyOf_(name) : '', v: values[i], f: formulas[i] });
  }
  return { sh: sh, map: map, header: hi + 1, rows: rows, width: values[0].length };
}

function extras_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EXTRA_TAB);
  if (!sh) {
    sh = ss.insertSheet(EXTRA_TAB);
    sh.getRange(1, 1, sh.getMaxRows(), EXTRA_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, EXTRA_HEADERS.length).setValues([EXTRA_HEADERS])
      .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  const idx = {};
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, EXTRA_HEADERS.length).getValues().forEach(function (r, i) {
      if (r[0]) idx[String(r[0])] = { row: i + 2, v: r };
    });
  }
  return { sh: sh, idx: idx };
}

function pull_() {
  const t = table_();
  const ex = extras_();
  const m = t.map;
  const get = function (row, k) { return m[k] === undefined ? '' : row.v[m[k]]; };
  const items = [];
  t.rows.forEach(function (row) {
    if (!row.key) return;
    const e = ex.idx[row.key];
    const extra = {};
    EXTRA_KEYS.forEach(function (k, i) { extra[k] = e ? text_(e.v[i + 2]) : ''; });
    items.push({
      key: row.key,
      negocio: text_(get(row, 'negocio')),
      encargado: text_(get(row, 'encargado')),
      contacto: text_(get(row, 'contacto')),
      zona: text_(get(row, 'zona')),
      ubicacion: text_(get(row, 'ubicacion')),
      tipo: text_(get(row, 'tipo')),
      origen: text_(get(row, 'origen')),
      etapa: text_(get(row, 'etapa')) || 'Sin contactar',
      fechaInicio: iso_(get(row, 'fechaInicio')),
      ultimoContacto: iso_(get(row, 'ultimoContacto')),
      sigPaso: text_(get(row, 'sigPaso')),
      fechaSig: iso_(get(row, 'fechaSig')),
      recibo: num_(get(row, 'recibo')),
      kw: num_(get(row, 'kw')),
      objecion: text_(get(row, 'objecion')),
      fechaCierre: iso_(get(row, 'fechaCierre')),
      comentarios: text_(get(row, 'comentarios')),
      comision: num_(get(row, 'comision')),
      comPond: num_(get(row, 'comPond')),
      prob: num_(get(row, 'prob')),
      extra: extra
    });
  });
  const res = { ok: true, items: items, log: readLog_(), at: new Date().toISOString() };
  try { Object.assign(res, metas_()); } catch (e) { res.semanas = []; }
  return res;
}

/* ---------------- escritura ---------------- */
// Escribe una celda solo si NO tiene fórmula. Devuelve true si cambió algo.
function setCell_(t, rowObj, field, value) {
  const c = t.map[field];
  if (c === undefined) return false;
  if (rowObj.f && rowObj.f[c]) return false;            // tiene fórmula: no se toca
  const cur = rowObj.v ? rowObj.v[c] : '';
  let val = value;
  if (DATE_FIELDS[field]) {
    if (iso_(cur) === String(value || '')) return false;
    val = value ? toDate_(value) : '';
  } else if (field === 'recibo') {
    const n = num_(value);
    if (num_(cur) === n) return false;
    val = n === null ? '' : money_(n);
  } else {
    if (text_(cur) === text_(value)) return false;
    val = value === null || value === undefined ? '' : value;
  }
  t.sh.getRange(rowObj.r, c + 1).setValue(val);
  if (rowObj.v) rowObj.v[c] = val;
  return true;
}

// Primera fila vacía (sin negocio) después de la última fila con datos; copia fórmulas si hace falta.
function newRow_(t) {
  let lastUsed = t.header;
  t.rows.forEach(function (row) { if (row.key) lastUsed = row.r; });
  let target = null;
  for (let i = 0; i < t.rows.length; i++) {
    if (t.rows[i].r > lastUsed && !t.rows[i].key) { target = t.rows[i]; break; }
  }
  if (!target) {
    const r = t.sh.getLastRow() + 1;
    // Copiar las fórmulas de la fila anterior para que la nueva calcule igual.
    const prev = t.sh.getRange(r - 1, 1, 1, t.width).getFormulasR1C1()[0];
    prev.forEach(function (fx, c) { if (fx) t.sh.getRange(r, c + 1).setFormulaR1C1(fx); });
    target = { r: r, key: '', v: new Array(t.width).fill(''), f: prev };
    t.rows.push(target);
  }
  return target;
}

function push_(items) {
  const t = table_();
  const ex = extras_();
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const byKey = {};
  t.rows.forEach(function (row) { if (row.key && !byKey[row.key]) byKey[row.key] = row; });
  const results = [];

  items.forEach(function (it) {
    if (!it || !it.negocio) return;
    const ch = it.changes || {};
    let key = it.key || keyOf_(it.negocio);
    let row = byKey[key] || byKey[keyOf_(it.negocio)];
    let created = false;
    if (!row) {
      row = newRow_(t);
      created = true;
      setCell_(t, row, 'negocio', String(it.negocio).trim().toUpperCase());
      setCell_(t, row, 'tipo', ch.tipo || 'Comercial');
      setCell_(t, row, 'origen', ch.origen || 'Frío');
      setCell_(t, row, 'etapa', ch.etapa || 'Sin contactar');
      row.key = keyOf_(row.v[t.map.negocio]);
      byKey[row.key] = row;
    } else if (ch.negocio !== undefined && keyOf_(ch.negocio) !== row.key) {
      setCell_(t, row, 'negocio', ch.negocio);
      row.key = keyOf_(ch.negocio);
      byKey[row.key] = row;
    }

    ['encargado', 'contacto', 'zona', 'ubicacion', 'tipo', 'etapa', 'sigPaso', 'fechaSig', 'recibo', 'objecion']
      .forEach(function (f) { if (ch[f] !== undefined) setCell_(t, row, f, ch[f]); });

    // Contacto registrado (visita, llamada o WhatsApp): último contacto y, si falta, fecha de inicio.
    if (it.contactoFecha) {
      setCell_(t, row, 'ultimoContacto', it.contactoFecha);
      if (!iso_(row.v[t.map.fechaInicio])) setCell_(t, row, 'fechaInicio', it.contactoFecha);
    }
    // Ganado o perdido: fecha de cierre si no tiene.
    const etapa = text_(row.v[t.map.etapa]);
    if ((etapa === 'Perdido' || etapa === 'Ganado') && t.map.fechaCierre !== undefined && !iso_(row.v[t.map.fechaCierre])) {
      setCell_(t, row, 'fechaCierre', it.contactoFecha || today);
    }
    // Nota de la visita: se agrega fechada al final de Comentarios (nunca se borra lo anterior).
    const nota = text_(it.nota);
    if (nota && t.map.comentarios !== undefined) {
      const cur = text_(row.v[t.map.comentarios]);
      const line = dmy_(it.notaFecha || today) + ': ' + nota;
      if (cur.indexOf(line) === -1) setCell_(t, row, 'comentarios', cur ? cur + '\n' + line : line);
    }

    // Datos que solo usa la app (pestaña "App rutas").
    const extra = it.extra || {};
    const e = ex.idx[row.key] || (it.key && ex.idx[it.key]);
    const vals = [row.key, text_(row.v[t.map.negocio])].concat(EXTRA_KEYS.map(function (k) {
      return extra[k] === undefined || extra[k] === null ? (e ? e.v[EXTRA_KEYS.indexOf(k) + 2] : '') : String(extra[k]);
    })).concat([new Date().toISOString()]);
    if (e) { ex.sh.getRange(e.row, 1, 1, vals.length).setValues([vals]); e.v = vals; }
    else {
      const r = ex.sh.getLastRow() + 1;
      ex.sh.getRange(r, 1, 1, vals.length).setValues([vals]);
      ex.idx[row.key] = { row: r, v: vals };
    }
    results.push({ id: it.id, key: row.key, fila: row.r, nuevo: created });
  });
  const logged = appendLog_(items);
  SpreadsheetApp.flush();
  return { ok: true, results: results, logged: logged };
}

/* ---------------- bitácora y metas ---------------- */
function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, sh.getMaxRows(), LOG_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
      .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendLog_(items) {
  const entries = [];
  items.forEach(function (it) { (it && it.log || []).forEach(function (l) { if (l && l.id && l.fecha) entries.push(l); }); });
  if (!entries.length) return 0;
  const sh = logSheet_();
  const last = sh.getLastRow();
  const have = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { if (r[0]) have[String(r[0])] = 1; });
  const rows = entries.filter(function (l) { return !have[l.id]; }).map(function (l) {
    if (!l.key) l.key = keyOf_(l.negocio);
    return LOG_KEYS.map(function (k) {
      const v = l[k];
      if (v === true) return 'sí';
      if (v === false) return 'no';
      return v === null || v === undefined ? '' : String(v);
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  return rows.length;
}

function readLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const desde = Utilities.formatDate(new Date(Date.now() - LOG_DAYS * 864e5), tz_(), 'yyyy-MM-dd');
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEADERS.length).getValues().forEach(function (r) {
    const o = {};
    LOG_KEYS.forEach(function (k, i) { o[k] = text_(r[i]); });
    o.fecha = iso_(r[1]) || o.fecha;
    if (!o.id || !o.fecha || o.fecha < desde) return;
    o.util = o.util === 'sí'; o.nuevo = o.nuevo === 'sí';
    out.push(o);
  });
  return out;
}

// Metas por semana (pestaña "Actividad semanal") y meta mensual de comisión (Listas!B8).
const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11 };
function metas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { semanas: [], metaMensual: null };
  const li = ss.getSheetByName('Listas');
  if (li) out.metaMensual = num_(li.getRange('B8').getValue());
  const ac = ss.getSheetByName('Actividad semanal');
  if (!ac) return out;
  const d = ac.getDataRange().getValues();
  let hi = -1;
  for (let i = 0; i < Math.min(12, d.length); i++) if (norm_(d[i][0]) === 'semana') { hi = i; break; }
  if (hi < 0) return out;
  let base = null;
  for (let i = hi + 1; i < d.length; i++) {
    if (!/^\s*\d+\s*$/.test(String(d[i][0]))) break;
    const n = Number(d[i][0]);
    const txt = norm_(d[i][1]);
    let inicio = '';
    const m = txt.match(/^(\d{1,2})(?:\s+([a-z]{3}))?/);
    const mm = txt.match(/([a-z]{3})\s*$/);
    if (m) {
      const mes = m[2] && MESES[m[2]] !== undefined ? MESES[m[2]] : (mm ? MESES[mm[1]] : undefined);
      if (mes !== undefined) {
        let y = new Date().getFullYear();
        if (base && mes < base.getMonth() - 6) y = base.getFullYear() + 1;
        else if (base) y = base.getFullYear();
        const dt = new Date(y, mes, Number(m[1]), 12);
        if (!base) base = dt;
        inicio = Utilities.formatDate(dt, tz_(), 'yyyy-MM-dd');
      }
    }
    out.semanas.push({ n: n, fechas: text_(d[i][1]), inicio: inicio, vMeta: num_(d[i][2]), vReal: num_(d[i][3]),
      eMeta: num_(d[i][5]), eReal: num_(d[i][6]) });
  }
  return out;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
