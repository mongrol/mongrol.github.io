(function () {
  'use strict';

  const CSV_URL = 'vudata/VuSitu_Snapshot_2026-03-27.csv';

  const METRICS = [
    { key: 'rdo_mg_l', title: 'RDO concentration', unit: 'mg/L' },
    { key: 'rdo_sat', title: 'RDO saturation', unit: '% Sat' },
    { key: 'turbidity', title: 'Turbidity', unit: 'NTU' },
    { key: 'ph', title: 'pH', unit: 'pH' },
    { key: 'orp', title: 'ORP', unit: 'mV' },
    { key: 'conductivity_us_cm', title: 'Specific conductivity', unit: 'µS/cm' },
    { key: 'salinity', title: 'Salinity', unit: 'PSU / ppt' },
    { key: 'tds', title: 'Total dissolved solids', unit: 'ppt' },
    { key: 'temperature', title: 'Temperature', unit: '°C' },
  ];

  const LOCATION_COLORS = [
    '#2563eb',
    '#16a34a',
    '#ca8a04',
    '#dc2626',
    '#9333ea',
    '#0891b2',
    '#c026d3',
    '#ea580c',
  ];

  /** @param {string} raw */
  function describeColumn(raw) {
    const h = (raw || '').trim();
    if (h === 'Date Time') return { kind: 'datetime', key: 'datetime' };
    if (h === 'Location Name') return { kind: 'location', key: 'location' };
    if (h === 'Latitude (°)') return { kind: 'meta', key: 'lat' };
    if (h === 'Longitude (°)') return { kind: 'meta', key: 'lon' };
    if (h === 'Device SN') return { kind: 'meta', key: 'device_sn' };
    if (h.startsWith('RDO Concentration')) return { kind: 'numeric', key: 'rdo_mg_l', scale: 1 };
    if (h.startsWith('RDO Saturation')) return { kind: 'numeric', key: 'rdo_sat', scale: 1 };
    if (h.startsWith('Turbidity')) return { kind: 'numeric', key: 'turbidity', scale: 1 };
    if (h.startsWith('pH')) return { kind: 'numeric', key: 'ph', scale: 1 };
    if (h.startsWith('ORP')) return { kind: 'numeric', key: 'orp', scale: 1 };
    if (h.includes('Specific Conductivity')) {
      const mS = h.includes('mS/cm');
      return { kind: 'numeric', key: 'conductivity_us_cm', scale: mS ? 1000 : 1 };
    }
    if (h.startsWith('Salinity')) return { kind: 'numeric', key: 'salinity', scale: 1 };
    if (h.startsWith('Total Dissolved Solids')) return { kind: 'numeric', key: 'tds', scale: 1 };
    if (h.startsWith('Temperature')) return { kind: 'numeric', key: 'temperature', scale: 1 };
    return { kind: 'skip', key: null };
  }

  /** @param {string} cell */
  function parseDateTime(cell) {
    if (!cell) return null;
    const iso = cell.includes('T') ? cell : cell.replace(' ', 'T');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * @param {string[]} cells
   * @param {ReturnType<describeColumn>[]} descriptors
   */
  function parseDataRow(cells, descriptors) {
    const row = {
      datetimeRaw: '',
      datetime: null,
      location: '',
      lat: null,
      lon: null,
      device_sn: '',
      rdo_mg_l: null,
      rdo_sat: null,
      turbidity: null,
      ph: null,
      orp: null,
      conductivity_us_cm: null,
      salinity: null,
      tds: null,
      temperature: null,
    };

    const n = Math.min(cells.length, descriptors.length);
    for (let i = 0; i < n; i++) {
      const d = descriptors[i];
      if (!d || d.kind === 'skip') continue;
      const cell = (cells[i] != null ? String(cells[i]) : '').trim();

      switch (d.kind) {
        case 'datetime':
          row.datetimeRaw = cell;
          row.datetime = parseDateTime(cell);
          break;
        case 'location':
          row.location = cell;
          break;
        case 'meta':
          if (d.key === 'lat' || d.key === 'lon') {
            row[d.key] = cell === '' ? null : parseFloat(cell);
          } else {
            row[d.key] = cell;
          }
          break;
        case 'numeric': {
          if (cell === '') {
            row[d.key] = null;
          } else {
            const v = parseFloat(cell);
            const scale = d.scale ?? 1;
            row[d.key] = Number.isFinite(v) ? v * scale : null;
          }
          break;
        }
        default:
          break;
      }
    }

    return row;
  }

  /** @param {string} text */
  function parseVuSituCsv(text) {
    const lines = text.split(/\r?\n/);
    /** @type {ReturnType<describeColumn>[] | null} */
    let descriptors = null;
    const rows = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const parsed = Papa.parse(line, {
        header: false,
        skipEmptyLines: false,
      });
      const cells = parsed.data[0];
      if (!Array.isArray(cells) || cells.length === 0) continue;

      const first = (cells[0] != null ? String(cells[0]) : '').trim();
      if (first === 'Date Time') {
        descriptors = cells.map((c) => describeColumn(String(c)));
        continue;
      }

      if (!descriptors) continue;

      const row = parseDataRow(cells.map((c) => (c == null ? '' : String(c))), descriptors);
      if (!row.datetimeRaw && !row.location) continue;

      rows.push(row);
    }

    rows.sort((a, b) => {
      const ta = a.datetime ? a.datetime.getTime() : 0;
      const tb = b.datetime ? b.datetime.getTime() : 0;
      return ta - tb;
    });

    return rows;
  }

  /** @param {ReturnType<typeof parseDataRow>[]} rows */
  function uniqueLocations(rows) {
    const set = new Set();
    for (const r of rows) {
      if (r.location) set.add(r.location);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  /** @param {HTMLElement} el */
  function show(el, visible) {
    el.classList.toggle('hidden', !visible);
  }

  let chartInstances = [];

  function destroyCharts() {
    for (const ch of chartInstances) {
      ch.destroy();
    }
    chartInstances = [];
  }

  /**
   * @param {string} selected
   * @param {ReturnType<parseDataRow>[]} allRows
   * @param {string[]} locations
   */
  function renderCharts(selected, allRows, locations) {
    destroyCharts();
    const grid = document.getElementById('charts-grid');
    grid.innerHTML = '';

    const activeLocations =
      selected === '__all__' ? locations : [selected];

    for (const m of METRICS) {
      /** @type {string[][]} */
      const tooltipTitles = [];
      const series = activeLocations.map((loc, idx) => {
        const subset = allRows.filter((r) => r.location === loc);
        const points = subset
          .map((r) => ({
            x: r.datetime ? r.datetime.getTime() : null,
            y: r[m.key],
            label: r.datetimeRaw,
          }))
          .filter((p) => p.x != null && p.y != null && Number.isFinite(p.y));

        tooltipTitles.push(points.map((p) => p.label));

        return {
          label: loc,
          data: points.map((p) => ({ x: p.x, y: p.y })),
          borderColor: LOCATION_COLORS[idx % LOCATION_COLORS.length],
          backgroundColor: 'transparent',
          tension: 0.15,
          pointRadius: 4,
          pointHoverRadius: 6,
        };
      });

      const hasData = series.some((s) => s.data.length > 0);
      if (!hasData) continue;

      const card = document.createElement('div');
      card.className = 'chart-card';
      const title = document.createElement('h3');
      title.textContent = `${m.title} (${m.unit})`;
      const wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      card.appendChild(title);
      card.appendChild(wrap);
      grid.appendChild(card);

      const chart = new Chart(canvas, {
        type: 'line',
        data: { datasets: series },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: activeLocations.length > 1, position: 'bottom' },
            tooltip: {
              callbacks: {
                title(items) {
                  const item = items[0];
                  const ds = item.datasetIndex;
                  const i = item.dataIndex;
                  const row = tooltipTitles[ds];
                  return row && row[i] ? row[i] : '';
                },
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'Time' },
              ticks: {
                callback(value) {
                  const d = new Date(value);
                  return d.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                },
              },
            },
            y: {
              title: { display: true, text: m.unit },
            },
          },
        },
      });
      chartInstances.push(chart);
    }

    show(document.getElementById('charts-section'), grid.children.length > 0);
  }

  /**
   * @param {string} selected
   * @param {ReturnType<parseDataRow>[]} allRows
   */
  function renderTable(selected, allRows) {
    const thead = document.getElementById('readings-thead');
    const tbody = document.getElementById('readings-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const filtered =
      selected === '__all__'
        ? allRows.slice()
        : allRows.filter((r) => r.location === selected);

    if (filtered.length === 0) {
      show(document.getElementById('table-section'), false);
      return;
    }

    const headers = [
      'Date Time',
      'Location',
      'Latitude',
      'Longitude',
      'Device',
      ...METRICS.map((m) => `${m.title} (${m.unit})`),
    ];

    const trh = document.createElement('tr');
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    for (const r of filtered) {
      const tr = document.createElement('tr');
      const cells = [
        r.datetimeRaw,
        r.location,
        r.lat != null ? String(r.lat) : '',
        r.lon != null ? String(r.lon) : '',
        r.device_sn,
        ...METRICS.map((m) => {
          const v = r[m.key];
          return v == null || v === '' ? '' : String(v);
        }),
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    show(document.getElementById('table-section'), true);
  }

  /**
   * @param {string} selected
   * @param {ReturnType<parseDataRow>[]} allRows
   */
  function renderSummary(selected, allRows) {
    const el = document.getElementById('summary');
    const subset =
      selected === '__all__'
        ? allRows
        : allRows.filter((r) => r.location === selected);

    if (subset.length === 0) {
      show(el, false);
      return;
    }

    if (selected === '__all__') {
      el.innerHTML =
        '<dl><dt>View</dt><dd>All locations</dd><dt>Readings</dt><dd>' +
        subset.length +
        '</dd></dl>';
      show(el, true);
      return;
    }

    const first = subset[0];
    const lat = first.lat;
    const lon = first.lon;
    const device = first.device_sn || '—';

    el.innerHTML =
      '<dl>' +
      '<dt>Location</dt><dd>' +
      escapeHtml(selected) +
      '</dd>' +
      '<dt>Coordinates</dt><dd>' +
      (lat != null && lon != null ? escapeHtml(String(lat)) + ', ' + escapeHtml(String(lon)) : '—') +
      '</dd>' +
      '<dt>Device</dt><dd>' +
      escapeHtml(device) +
      '</dd>' +
      '<dt>Readings</dt><dd>' +
      subset.length +
      '</dd></dl>';
    show(el, true);
  }

  /** @param {string} s */
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function main() {
    const select = document.getElementById('location-select');
    const errEl = document.getElementById('load-error');

    fetch(CSV_URL)
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' loading CSV');
        return res.text();
      })
      .then((text) => {
        const rows = parseVuSituCsv(text);
        const locations = uniqueLocations(rows);

        if (locations.length === 0) {
          throw new Error('No data rows found. Check CSV format.');
        }

        select.innerHTML = '';
        const optAll = document.createElement('option');
        optAll.value = '__all__';
        optAll.textContent = 'All locations';
        select.appendChild(optAll);
        for (const loc of locations) {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          select.appendChild(opt);
        }

        function refresh() {
          const v = select.value;
          renderSummary(v, rows);
          renderCharts(v, rows, locations);
          renderTable(v, rows);
        }

        select.addEventListener('change', refresh);
        refresh();
        show(errEl, false);
      })
      .catch((e) => {
        errEl.textContent =
          'Could not load data: ' + (e && e.message ? e.message : String(e));
        show(errEl, true);
        show(document.getElementById('summary'), false);
        show(document.getElementById('charts-section'), false);
        show(document.getElementById('table-section'), false);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
