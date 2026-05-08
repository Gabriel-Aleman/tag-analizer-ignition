// ──────────────────────────────────────────────
// Core tag parsing
// ──────────────────────────────────────────────

function getTagsFromJSON(full_json, head = "") {
  let miJson = full_json;

  if (miJson.tagType === "Provider") {
    miJson = miJson.tags.filter(item => item.name !== '_types_');
    head = "[tagProvider]";
  }

  let tags = [];

  for (const item of miJson) {
    const fp = (head === "[tagProvider]") ? head + item.name : head + "/" + item.name;

    if (item.tagType === "AtomicTag") {
      item.fullPath = fp;
      tags.push(item);
    } else {
      const mjs = getTagsFromJSON(item.tags || [], fp);
      tags = tags.concat(mjs);
    }
  }

  return tags;
}

function getFilteredTags(tagList, filt) {
  return tagList.filter(item => item.valueSource === filt);
}

function translateDtype(dtype) {
  switch (dtype) {
    case "Int1":
    case "Boolean": return "boolean";
    case "Int2":
    case "Int4":
    case "Int8": return "int32";
    case "Float4": return "float";
    case "Float8": return "double";
    case "String":
    case "Text": return "string";
    case "DateTime": return "datetime";
    default: return dtype || "unknown";
  }
}

function getOPCData(allTags) {
  const opcTags = allTags.filter(item => item.valueSource === "opc");
  const Devices = {};

  for (const item of opcTags) {
    const opcPath = String(item.opcItemPath || "");
    if (opcPath.includes("[Diagnostics]")) {
      continue;
    }
    
    const parts = opcPath.split(']');
    const opcTag = parts[parts.length - 1] || opcPath;
    const ctrl = (parts[0] || "").split('[')[1] || "unknown";

    if (!(ctrl in Devices)) Devices[ctrl] = [];

    const dtype = translateDtype(item.dataType);
    let defaultVS;
    if (dtype === "boolean") {
      defaultVS = { tp: "random", min: 0, max: 1, repeat: 0 };
    } else if (dtype === "string") {
      defaultVS = { tp: "random", min: 0, max: 100, repeat: 0 };
    } else {
      defaultVS = { tp: "ramp", min: 0, max: 100, period: 100, repeat: 0 };
    }

    Devices[ctrl].push({
      timeInterval: 0,
      vs: defaultVS,
      browsePath: opcTag,
      dataType: dtype
    });
  }

  return Devices;
}

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────
let loadedJSON = null;
let allTags = [];
let activeFilter = 'ALL';
let devicesData = {};   // { controlador: [ {timeInterval, vs, browsePath, dataType} ] }
let activeDevice = null;

// ──────────────────────────────────────────────
// Tab switches
// ──────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

function switchView(view, btn) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-tags').style.display = view === 'tags' ? 'block' : 'none';
  document.getElementById('view-opc').style.display = view === 'opc' ? 'block' : 'none';
}

// ──────────────────────────────────────────────
// File upload
// ──────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file || !file.name.endsWith('.json')) {
    showError('Por favor seleccioná un archivo .json válido.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      loadedJSON = JSON.parse(e.target.result);
      document.getElementById('uploadedFileName').innerHTML =
        `<div class="file-loaded-name">${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>`;
      clearError();
    } catch {
      showError('El archivo no es un JSON válido.');
      loadedJSON = null;
    }
  };
  reader.readAsText(file);
}

// ──────────────────────────────────────────────
// Path load
// ──────────────────────────────────────────────
function loadFromPath() {
  const path = document.getElementById('pathInput').value.trim();
  document.getElementById('pathError').innerHTML = '';

  fetch(path)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      loadedJSON = data;
      const preview = JSON.stringify(data).slice(0, 300);
      document.getElementById('pathPreview').innerHTML =
        `<div class="file-loaded-name">Cargado: ${path}</div>
         <div class="json-preview">${escapeHtml(preview)}…</div>`;
      clearError();
    })
    .catch(() => {
      document.getElementById('pathError').innerHTML =
        `<div class="error-msg">No se pudo cargar "${path}".<br>
         En el browser, esta opción requiere que el archivo sea accesible por HTTP.<br>
         Usá la opción <strong>Subir archivo</strong> en su lugar.</div>`;
    });
}

// ──────────────────────────────────────────────
// Process & render
// ──────────────────────────────────────────────
function processData() {
  if (!loadedJSON) { showError('Primero cargá un archivo JSON.'); return; }
  clearError();

  try {
    allTags = getTagsFromJSON(loadedJSON);
    devicesData = getOPCData(allTags);
  } catch (e) {
    showError('Error procesando el JSON: ' + e.message);
    return;
  }

  activeFilter = 'ALL';
  activeDevice = Object.keys(devicesData)[0] || null;

  renderResults(allTags);
  buildFilterChips(allTags);
  renderStats(allTags, allTags);
  renderDeviceTabs();
  renderOPCTable();

  document.getElementById('results').style.display = 'block';
  document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ──────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────
function renderStats(filtered, all) {
  const sources = {};
  all.forEach(t => { const k = t.valueSource || 'undefined'; sources[k] = (sources[k] || 0) + 1; });

  const topSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const opcCount = (all.filter(t => t.valueSource === 'opc')).length;
  const devCount = Object.keys(devicesData).length;

  document.getElementById('statsBar').innerHTML = `
    <div class="stat-item">
      <span class="stat-num">${all.length}</span>
      <span class="stat-desc">tags totales</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-num">${filtered.length}</span>
      <span class="stat-desc">mostrando</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-num" style="color:var(--warn)">${opcCount}</span>
      <span class="stat-desc">OPC tags</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-num" style="color:var(--accent2)">${devCount}</span>
      <span class="stat-desc">dispositivos</span>
    </div>
    <div class="stat-divider"></div>
    ${topSources.map(([k, v]) => `
      <div class="stat-item">
        <span class="stat-num" style="font-size:1rem">${v}</span>
        <span class="stat-desc">${k}</span>
      </div>
    `).join('<div class="stat-divider"></div>')}
  `;
}

// ──────────────────────────────────────────────
// Tag view
// ──────────────────────────────────────────────
function buildFilterChips(tags) {
  const sources = [...new Set(tags.map(t => t.valueSource || 'undefined'))].sort();
  const row = document.getElementById('filterRow');
  row.innerHTML = `<span class="filter-label">valueSource:</span>`;

  const allChip = document.createElement('button');
  allChip.className = 'filter-chip active';
  allChip.textContent = `ALL (${tags.length})`;
  allChip.onclick = () => applyFilter('ALL', allChip);
  row.appendChild(allChip);

  sources.forEach(src => {
    const count = tags.filter(t => (t.valueSource || 'undefined') === src).length;
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.textContent = `${src} (${count})`;
    chip.onclick = () => applyFilter(src, chip);
    row.appendChild(chip);
  });
}

function applyFilter(value, chipEl) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chipEl.classList.add('active');
  activeFilter = value;
  const filtered = value === 'ALL' ? allTags : getFilteredTags(allTags, value);
  renderResults(filtered);
  renderStats(filtered, allTags);
}

function renderResults(tags) {
  const tbody = document.getElementById('tagTableBody');

  if (!tags.length) {
    tbody.innerHTML = `<tr><td colspan="5">
      <div class="empty-state">
        <div class="icon">🔍</div>
        <p>No se encontraron tags con este filtro.</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = tags.map((t, i) => {
    const pathParts = (t.fullPath || '').split('/');
    const lastName = pathParts.pop();
    const pathHead = pathParts.join('/') + (pathParts.length ? '/' : '');
    return `<tr>
      <td style="color:var(--muted);width:40px">${i + 1}</td>
      <td class="path-cell"><span class="provider">${escapeHtml(pathHead)}</span>${escapeHtml(lastName)}</td>
      <td>${badgeFor(t.valueSource)}</td>
      <td class="data-type">${escapeHtml(t.dataType || '—')}</td>
      <td style="color:var(--muted)">${escapeHtml(t.name || '—')}</td>
    </tr>`;
  }).join('');
}

function badgeFor(src) {
  const classes = { memory: 'badge-mem', opc: 'badge-opc', expression: 'badge-expr', query: 'badge-query', reference: 'badge-ref' };
  const s = (src || 'undefined').toLowerCase();
  return `<span class="badge ${classes[s] || 'badge-default'}">${escapeHtml(src || 'undefined')}</span>`;
}

// ──────────────────────────────────────────────
// OPC view
// ──────────────────────────────────────────────
function renderDeviceTabs() {
  const devs = Object.keys(devicesData);
  document.getElementById('deviceTabs').innerHTML = devs.map(d => `
    <button class="dev-chip${d === activeDevice ? ' active' : ''}" onclick="switchDevice('${d}', this)">
      ${escapeHtml(d)} <span style="opacity:.55">(${devicesData[d].length})</span>
    </button>
  `).join('');
}

function switchDevice(dev, btn) {
  activeDevice = dev;
  document.querySelectorAll('.dev-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderOPCTable();
}

function renderOPCTable() {
  const tbody = document.getElementById('opcTableBody');
  const items = devicesData[activeDevice] || [];

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4">
      <div class="empty-state"><div class="icon">📭</div><p>Sin tags OPC para este dispositivo.</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((item, idx) => `
    <tr>
      <td style="color:var(--muted)">${item.timeInterval}</td>
      <td class="path-cell" style="font-size:0.75rem">${escapeHtml(item.browsePath)}</td>
      <td>${buildVSEditor(idx, item.vs, item.dataType)}</td>
      <td><span class="dtype-badge">${escapeHtml(item.dataType)}</span></td>
    </tr>
  `).join('');
}

function buildVSEditor(idx, vs, dataType) {
  // boolean and string use a fixed default — no customization allowed
  if (dataType === 'boolean' || dataType === 'string') {
    const preview = formatVS(vs);
    return `<div class="vs-row">
              <span class="vs-fixed-badge">default</span>
            </div>
            <div class="vs-preview">${escapeHtml(preview)}</div>`;
  }

  const isRamp = vs.tp === 'ramp';

  const selectHtml = `
    <select class="vs-select" onchange="updateVSType(${idx}, this.value)">
      <option value="ramp"${isRamp ? ' selected' : ''}>ramp</option>
      <option value="random"${!isRamp ? ' selected' : ''}>random</option>
    </select>`;

  const paramHtml = isRamp
    ? `<div class="vs-params">
        ${paramGroup('min', vs.min, idx, 'min')}
        ${paramGroup('max', vs.max, idx, 'max')}
        ${paramGroup('period', vs.period, idx, 'period')}
        ${paramGroup('repeat', vs.repeat, idx, 'repeat')}
       </div>`
    : `<div class="vs-params">
        ${paramGroup('min', vs.min, idx, 'min')}
        ${paramGroup('max', vs.max, idx, 'max')}
        ${paramGroup('repeat', vs.repeat, idx, 'repeat')}
       </div>`;

  const preview = formatVS(vs);

  return `<div class="vs-row">${selectHtml}${paramHtml}</div>
          <div class="vs-preview">${escapeHtml(preview)}</div>`;
}

function paramGroup(label, value, idx, key) {
  return `<div class="vs-param-group">
    <span class="vs-param-label">${label}</span>
    <input class="vs-input" type="number" value="${value}"
      onchange="updateVSParam(${idx}, '${key}', this.value)"
      oninput="updateVSParam(${idx}, '${key}', this.value)">
  </div>`;
}

function updateVSType(idx, tp) {
  devicesData[activeDevice][idx].vs.tp = tp;
  renderOPCTable();   // re-render to swap param fields
}

function updateVSParam(idx, key, val) {
  devicesData[activeDevice][idx].vs[key] = parseFloat(val) || 0;
  // Update preview inline without full re-render
  const rows = document.getElementById('opcTableBody').querySelectorAll('tr');
  const preview = rows[idx] ? rows[idx].querySelector('.vs-preview') : null;
  if (preview) preview.textContent = formatVS(devicesData[activeDevice][idx].vs);
}

function formatVS(vs) {
  if (vs.tp === 'ramp') return `ramp(${vs.min}, ${vs.max}, ${vs.period}, ${vs.repeat})`;
  if (vs.tp === 'random') return `random(${vs.min}, ${vs.max}, ${vs.repeat})`;
  return vs.tp;
}

// ──────────────────────────────────────────────
// CSV download
// ──────────────────────────────────────────────
function buildCSV(items) {
  const header = `Time Interval,Browse Path,Value Source,Data Type\n`;
  const rows = items.map(item =>
    `"${item.timeInterval}","${item.browsePath}","${formatVS(item.vs)}","${item.dataType}"`
  ).join('\n');
  return header + rows;
}

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCurrentCSV() {
  if (!activeDevice || !devicesData[activeDevice]) return;
  triggerDownload(`${activeDevice}.csv`, buildCSV(devicesData[activeDevice]));
}

function downloadAllCSV() {
  Object.entries(devicesData).forEach(([dev, items]) => {
    triggerDownload(`${dev}.csv`, buildCSV(items));
  });
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.style.display = 'block';
  el.innerHTML = `<div class="error-msg">⚠ ${msg}</div>`;
}

function clearError() {
  const el = document.getElementById('errorMsg');
  el.style.display = 'none';
  el.innerHTML = '';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}