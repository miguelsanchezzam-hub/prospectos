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
 * 5. (Aviso diario) En la app: Ajustes → Aviso diario → elige la hora → Activar.
 *    Al autorizar el script, Google te pide permiso para "enviar correo como tú" y
 *    "ejecutarse cuando no estás presente": son para el correo diario de pendientes.
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
  comentarios: ['comentarios']
};
const DATE_FIELDS = { fechaInicio: 1, ultimoContacto: 1, fechaSig: 1, fechaCierre: 1 };
const EXTRA_HEADERS = ['Clave', 'Negocio', 'Quién atendió', 'Horario', 'Refrigeradores',
  'Aire acondicionado', 'Recibo visto', 'Paso', 'Primera visita', 'Actualizado'];
const EXTRA_KEYS = ['quien', 'horario', 'refris', 'aire', 'reciboVisto', 'paso', 'visitado'];

function doGet() {
  return out_({ ok: true, msg: 'Ruta de visitas: script activo' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return out_({ ok: false, error: 'Código incorrecto' });
    if (body.action === 'ping') {
      const t = table_();
      return out_({ ok: true, tab: TAB, rows: t.rows.filter(function (r) { return r.key; }).length, aviso: avisoEstado_() });
    }
    if (body.action === 'pull') return out_(pull_());
    if (body.action === 'aviso') return out_(aviso_(body));
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
      extra: extra
    });
  });
  return { ok: true, items: items, at: new Date().toISOString() };
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
  SpreadsheetApp.flush();
  return { ok: true, results: results };
}

/* ================= Aviso diario de pendientes =================
 * Todos los días (menos domingo) a la hora que elijas en la app, te manda un correo
 * a tu Gmail con lo que vence hoy y lo atrasado. En el iPhone llega como notificación
 * de la app de Gmail. Se activa y se prueba desde la app: Ajustes → Aviso diario.
 */
const APP_URL = 'https://miguelsanchezzam-hub.github.io/prospectos/rutas/';

function avisoEstado_() {
  const props = PropertiesService.getScriptProperties();
  const activo = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'avisoDiario'; });
  return { activo: activo, hora: Number(props.getProperty('AVISO_HORA') || 7), email: Session.getEffectiveUser().getEmail() };
}

function aviso_(body) {
  const modo = body.modo;
  if (modo === 'probar') {
    const r = enviarAviso_(true);
    return { ok: true, enviados: r.total, email: r.email, aviso: avisoEstado_() };
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'avisoDiario') ScriptApp.deleteTrigger(t);
  });
  if (modo === 'activar') {
    const hora = Math.max(5, Math.min(11, Number(body.hora) || 7));
    PropertiesService.getScriptProperties().setProperty('AVISO_HORA', String(hora));
    ScriptApp.newTrigger('avisoDiario').timeBased().everyDays(1).atHour(hora)
      .inTimezone('America/Mexico_City').create();
  }
  return { ok: true, aviso: avisoEstado_() };
}

// La llama el activador diario (no le cambies el nombre).
function avisoDiario() {
  const dow = Number(Utilities.formatDate(new Date(), 'America/Mexico_City', 'u')); // 1=lunes … 7=domingo
  if (dow === 7) return;
  enviarAviso_(false);
}

function enviarAviso_(prueba) {
  const t = table_();
  const m = t.map;
  const today = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');
  const lista = [];
  t.rows.forEach(function (row) {
    if (!row.key) return;
    const etapa = text_(row.v[m.etapa]);
    if (etapa === 'Perdido' || etapa === 'Ganado') return;
    const f = iso_(m.fechaSig === undefined ? '' : row.v[m.fechaSig]);
    if (!f || f > today) return;
    const g = function (k) { return m[k] === undefined ? '' : text_(row.v[m[k]]); };
    lista.push({ negocio: g('negocio'), etapa: etapa, paso: g('sigPaso'), fecha: f, encargado: g('encargado'),
      contacto: g('contacto'), ubicacion: g('ubicacion'), zona: g('zona') });
  });
  lista.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.zona < b.zona ? -1 : 1; });
  const email = Session.getEffectiveUser().getEmail();
  if (!lista.length && !prueba) return { total: 0, email: email };

  const hoy = lista.filter(function (x) { return x.fecha === today; });
  const atr = lista.filter(function (x) { return x.fecha < today; });
  const e = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const item = function (x) {
    const maps = x.ubicacion ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.negocio + ', ' + x.ubicacion) : '';
    const tel = String(x.contacto).replace(/\D/g, '');
    return '<li style="margin:0 0 12px">' +
      '<b>' + e(x.negocio) + '</b>' + (x.fecha < today ? ' <span style="color:#B0521A">· atrasado desde ' + e(dmy_(x.fecha)) + '</span>' : '') +
      '<br>' + e(x.paso || 'Sin siguiente paso anotado') + ' <span style="color:#6A5D4E">(' + e(x.etapa) + ')</span>' +
      (x.encargado ? '<br><span style="color:#6A5D4E">' + e(x.encargado) + '</span>' : '') +
      (maps || tel.length >= 10 ? '<br>' : '') +
      (maps ? '<a href="' + e(maps) + '">Cómo llegar</a>' : '') +
      (maps && tel.length >= 10 ? ' · ' : '') +
      (tel.length >= 10 ? '<a href="https://wa.me/52' + tel.slice(-10) + '">WhatsApp</a>' : '') +
      '</li>';
  };
  const bloque = function (titulo, arr) {
    return arr.length ? '<h3 style="margin:18px 0 8px;font-size:16px">' + titulo + ' (' + arr.length + ')</h3><ul style="padding-left:18px;margin:0">' + arr.map(item).join('') + '</ul>' : '';
  };
  const html = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#241A12;max-width:560px">' +
    '<div style="height:4px;background:linear-gradient(90deg,#FFD400,#F5781C,#E6361C);border-radius:4px"></div>' +
    '<h2 style="margin:12px 0 4px">Ruta de hoy</h2>' +
    (lista.length ? '' : '<p>No tienes pendientes para hoy ni atrasados. Esto es solo una prueba del aviso.</p>') +
    bloque('Para hoy', hoy) + bloque('Atrasados', atr) +
    '<p style="margin-top:18px"><a href="' + APP_URL + '" style="background:#E0A100;color:#241A12;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700">Abrir Ruta de visitas</a></p></div>';
  const asunto = (prueba ? '[Prueba] ' : '') + 'Ruta de hoy: ' + hoy.length + ' para hoy' + (atr.length ? ', ' + atr.length + ' atrasados' : '');
  const texto = lista.map(function (x) { return '• ' + x.negocio + ' — ' + (x.paso || 'sin paso') + (x.fecha < today ? ' (atrasado)' : ''); }).join('\n') || 'Sin pendientes.';
  MailApp.sendEmail({ to: email, subject: asunto, body: texto + '\n\n' + APP_URL, htmlBody: html, name: 'Ruta de visitas' });
  return { total: lista.length, email: email };
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
