/* Full-portfolio grouped analytics. No framework, chart CDN, or API is required. */
(async () => {
  'use strict';
  const root = document.querySelector('.claims-dashboard');
  if (!root) return;
  const dataUrl = new URL('claims-data.json', document.currentScript?.src || document.baseURI);
  const resultLabel = root.querySelector('#claims-results');
  let data;
  try {
    const embedded = document.getElementById('claims-inline-data');
    if (embedded) data = JSON.parse(embedded.textContent);
    else {
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error('Data request failed');
      data = await response.json();
    }
    if (!data || data.version !== 1 || !Array.isArray(data.cells) || !Array.isArray(data.models)) throw new Error('Unsupported data format');
  } catch (_) {
    resultLabel.innerHTML = 'The portfolio data could not load. Refresh the page, or open <a href="insurance-claims-standalone.html">the self-contained HTML version</a> for a local preview.';
    return;
  }

  const dimensionCount = data.dimensions.length;
  const dimensionIndex = Object.fromEntries(data.dimensions.map((key, i) => [key, i]));
  const labels = {
    state: 'State', coverage: 'Coverage', vehicle_class: 'Vehicle class',
    income_band: 'Income band', policy_type: 'Policy type', vehicle_size: 'Vehicle size',
    risk_score: 'Risk score', location: 'Location', claim_severity: 'Severity',
    complaint_risk: 'Complaint risk', employment_status: 'Employment',
    marital_status: 'Marital status', sales_channel: 'Sales channel',
  };
  const views = ['overview', 'risk', 'customers', 'models'];
  const form = root.querySelector('#claims-filters');
  const filterSelects = [...form.querySelectorAll('[data-filter]')];
  const exportButton = root.querySelector('#claims-export');
  const integer = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
  const dollars = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2});
  const wholeDollars = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  const compactNumber = new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 1});
  const filters = {};
  let activeView = 'overview';
  let benchmarkMetric = 'MAE';
  let predictionDimension = 'location';
  let current = null;
  const number = n => integer.format(n);
  const money = n => Number.isFinite(n) ? dollars.format(n) : '—';
  const chartMoney = n => Number.isFinite(n) ? wholeDollars.format(n) : '—';
  const percent = (n, total) => total ? `${(100 * n / total).toFixed(1)}%` : '0.0%';
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const zero = () => [0, 0, 0, 0, 0, 0, 0];
  const average = (stats, index, scale = 1) => stats[0] ? stats[index] / scale / stats[0] : NaN;
  const actual = stats => average(stats, 1, 100);
  const predicted = stats => average(stats, 2);
  const valuesFor = dimension => data.values[dimensionIndex[dimension]];
  const selected = (dimension, index) => filters[dimension] === String(index);
  const filterAttributes = (dimension, index) => `data-claims-filter="${dimension}" data-value="${index}" aria-pressed="${selected(dimension, index)}"`;
  const emptyChart = () => '<p class="claims-card-subtitle">No policies match these filters.</p>';
  const addStats = (target, cell) => {
    for (let m = 0; m < 7; m++) target[m] += cell[dimensionCount + m];
  };

  function aggregate() {
    const total = zero();
    const by = data.values.map(values => values.map(zero));
    const incomeSeverity = valuesFor('income_band').map(() => valuesFor('claim_severity').map(() => 0));
    const conditions = Object.entries(filters).map(([dimension, index]) => [dimensionIndex[dimension], Number(index)]);
    for (const cell of data.cells) {
      if (conditions.some(([index, value]) => cell[index] !== value)) continue;
      addStats(total, cell);
      for (let dimension = 0; dimension < dimensionCount; dimension++) addStats(by[dimension][cell[dimension]], cell);
      incomeSeverity[cell[dimensionIndex.income_band]][cell[dimensionIndex.claim_severity]] += cell[dimensionCount];
    }
    return {total, by, incomeSeverity};
  }

  function groups(dimension) {
    return valuesFor(dimension).map((name, index) => ({name, index, stats: current.by[dimensionIndex[dimension]][index]}));
  }

  function card(title, subtitle, content, badge = '', extraClass = '') {
    return `<section class="claims-card ${extraClass}"><div class="claims-card-header"><div><h3>${escape(title)}</h3><p class="claims-card-subtitle">${escape(subtitle)}</p></div>${badge ? `<span class="claims-card-number">${escape(badge)}</span>` : ''}</div>${content}</section>`;
  }

  const pairLegend = '<div class="claims-legend" aria-label="Chart legend"><span><i></i>Actual claim</span><span><i class="predicted"></i>Predicted claim</span></div>';
  const severityColors = ['var(--claims-low)', 'var(--claims-medium)', 'var(--claims-high)'];
  const severityLegend = () => `<div class="claims-legend">${valuesFor('claim_severity').map((name, i) => `<span><i style="background:${severityColors[i]}"></i>${escape(name)} severity</span>`).join('')}</div>`;

  function pairedChart(dimension, sort = true) {
    let items = groups(dimension).filter(item => item.stats[0]);
    if (sort) items.sort((a, b) => actual(b.stats) - actual(a.stats));
    if (!items.length) return emptyChart();
    const maximum = Math.max(...items.map(item => Math.max(actual(item.stats), predicted(item.stats)))) * 1.05 || 1;
    return pairLegend + `<div class="claims-pair-chart" aria-label="Actual and predicted mean claim by ${escape(labels[dimension].toLowerCase())}">${items.map(item => {
      const mean = actual(item.stats);
      const prediction = predicted(item.stats);
      return `<button type="button" class="claims-chart-row" ${filterAttributes(dimension, item.index)} aria-label="${escape(item.name)}: ${number(item.stats[0])} policies, actual average ${money(mean)}, predicted average ${money(prediction)}. ${selected(dimension, item.index) ? 'Remove filter' : 'Filter to this category'}" title="${escape(item.name)} · Actual ${money(mean)} · Predicted ${money(prediction)}">
        <span class="claims-chart-label">${escape(item.name)}<small>${number(item.stats[0])} policies</small></span>
        <span class="claims-pair-track" aria-hidden="true"><i class="claims-bar" style="width:${mean / maximum * 100}%"></i><i class="claims-bar predicted" style="width:${Math.max(0, prediction) / maximum * 100}%"></i></span>
        <span class="claims-pair-values" aria-hidden="true"><span>${chartMoney(mean)}</span><span>${chartMoney(prediction)}</span></span>
      </button>`;
    }).join('')}</div><div class="claims-chart-axis" aria-hidden="true"><span>$0</span><span>${chartMoney(maximum / 2)}</span><span>${chartMoney(maximum)}</span></div>`;
  }

  function severityDonut() {
    const items = groups('claim_severity');
    const total = current.total[0];
    if (!total) return emptyChart();
    let start = 0;
    const stops = items.map((item, i) => {
      const end = start + item.stats[0] / total * 100;
      const segment = `${severityColors[i]} ${start}% ${end}%`;
      start = end;
      return segment;
    });
    return `<div class="claims-donut-wrap"><div class="claims-donut" style="--claims-donut:conic-gradient(${stops.join(',')})" role="img" aria-label="Claim severity: ${items.map(item => `${item.name} ${percent(item.stats[0], total)}`).join(', ')}"><div class="claims-donut-center"><strong>${compactNumber.format(total)}</strong><span>policy records</span></div></div><div class="claims-severity-list">${items.map((item, i) => `<button type="button" class="claims-severity-button" style="--severity-color:${severityColors[i]}" ${filterAttributes('claim_severity', item.index)}><i aria-hidden="true"></i><span>${escape(item.name)}<small>${number(item.stats[0])} policies</small></span><strong>${percent(item.stats[0], total)}</strong></button>`).join('')}</div></div><p class="claims-chart-footnote">Severity follows the labels in the project’s exported data.</p>`;
  }

  function coverageCards() {
    const items = groups('coverage');
    return `<div class="claims-coverage-grid">${items.map(item => `<button type="button" class="claims-coverage" ${filterAttributes('coverage', item.index)} aria-label="${escape(item.name)} coverage, average claim ${money(actual(item.stats))}, ${number(item.stats[0])} policies. Filter to this category."><span>${escape(item.name)}</span><strong>${chartMoney(actual(item.stats))}</strong><small>${number(item.stats[0])} policies</small><span class="claims-mini-track" aria-hidden="true"><i style="width:${current.total[0] ? item.stats[0] / current.total[0] * 100 : 0}%"></i></span></button>`).join('')}</div><p class="claims-chart-footnote">Mean actual claim · Bar shows share of selected policies.</p>`;
  }

  function stateTable() {
    const items = groups('state').filter(item => item.stats[0]).sort((a, b) => b.stats[0] - a.stats[0]);
    return `<div class="claims-table-wrap"><table class="claims-table"><caption hidden>Selected policy records and mean actual claims by state</caption><thead><tr><th scope="col">State</th><th scope="col">Policies</th><th scope="col">Avg. claim</th></tr></thead><tbody>${items.map(item => `<tr><td><button type="button" ${filterAttributes('state', item.index)}>${escape(item.name)}</button></td><td>${number(item.stats[0])}</td><td>${chartMoney(actual(item.stats))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function overviewView() {
    return `<div class="claims-grid">${card('Claims by vehicle class', 'How observed claims compare with model estimates', pairedChart('vehicle_class'), '01')}${card('The shape of claim severity', 'Policy share by the source severity label', severityDonut(), '02')}${card('A closer look at coverage', 'Different coverage, different claim patterns', coverageCards(), '03')}${card('Across the map', 'The selected portfolio, state by state', stateTable(), '04')}</div>`;
  }

  function riskDistribution() {
    const items = groups('risk_score');
    const maxCount = Math.max(1, ...items.map(item => item.stats[0]));
    const nonzero = items.filter(item => Number(item.name) > 0).reduce((sum, item) => sum + item.stats[0], 0);
    return `<div class="claims-risk-chart" aria-label="Number of policies by source risk score">${items.map(item => `<button type="button" class="claims-risk-column" ${filterAttributes('risk_score', item.index)} aria-label="Risk score ${escape(item.name)}, ${number(item.stats[0])} policies. Filter to this score." title="Score ${escape(item.name)} · ${number(item.stats[0])} policies"><strong>${compactNumber.format(item.stats[0])}</strong><i aria-hidden="true" style="height:${Math.max(0, item.stats[0] / maxCount * 78)}%"></i></button>`).join('')}</div><div class="claims-risk-labels" aria-hidden="true">${items.map(item => `<span>Score ${escape(item.name)}</span>`).join('')}</div><div class="claims-risk-insight"><strong>${percent(nonzero, current.total[0])}</strong><span>of selected policies have a score above zero.</span></div><p class="claims-chart-footnote">Source scores are 0, 2, 3, 4, 5, or 7. This rule-based score includes actual claim amounts.</p>`;
  }

  function severityByIncome() {
    const severities = valuesFor('claim_severity');
    return severityLegend() + groups('income_band').map(item => {
      const row = current.incomeSeverity[item.index];
      return `<div class="claims-stack-row"><button type="button" ${filterAttributes('income_band', item.index)}>${escape(item.name)}</button><div class="claims-stack" role="img" aria-label="${escape(item.name)}: ${row.map((n, i) => `${severities[i]} ${percent(n, item.stats[0])}`).join(', ')}">${row.map((n, i) => `<span title="${escape(severities[i])}: ${number(n)} policies (${percent(n, item.stats[0])})" style="--severity-color:${severityColors[i]};width:${item.stats[0] ? n / item.stats[0] * 100 : 0}%"></span>`).join('')}</div><span class="claims-stack-count">${number(item.stats[0])}</span></div>`;
    }).join('') + '<p class="claims-chart-footnote">Each bar shows the severity mix within one income band; counts appear at right.</p>';
  }

  function riskView() {
    return `<div class="claims-grid">${card('Risk score distribution', 'A descriptive view of the project’s risk rules', riskDistribution(), '01')}${card('Claims & complaints', 'Mean claim by complaint risk category', pairedChart('complaint_risk', false), '02')}${card('Severity across income bands', 'The source claim labels within each segment', severityByIncome(), '03', 'claims-card-wide')}</div>`;
  }

  function shareChart(dimension) {
    const items = groups(dimension).filter(item => item.stats[0]).sort((a, b) => b.stats[0] - a.stats[0]);
    const maxCount = Math.max(1, ...items.map(item => item.stats[0]));
    return `<div class="claims-simple-chart">${items.map(item => `<button type="button" class="claims-chart-row" ${filterAttributes(dimension, item.index)} aria-label="${escape(item.name)}, ${number(item.stats[0])} policies, ${percent(item.stats[0], current.total[0])}. Filter to this category."><span class="claims-chart-label">${escape(item.name)}<small>${number(item.stats[0])} policies</small></span><span class="claims-pair-track" aria-hidden="true"><i class="claims-bar" style="width:${item.stats[0] / maxCount * 100}%"></i></span><span class="claims-pair-values">${percent(item.stats[0], current.total[0])}</span></button>`).join('')}</div>`;
  }

  function customersView() {
    return `<div class="claims-grid claims-grid-equal">${card('Income & claim amounts', 'Mean claims across the project’s income bands', pairedChart('income_band', false), '01')}${card('Where policyholders live', 'Mean claim by rural, suburban, and urban location', pairedChart('location'), '02')}${card('How customers connect', 'Policy share by sales channel', shareChart('sales_channel'), '03')}${card('Employment & claims', 'Mean actual and predicted claims by employment', pairedChart('employment_status'), '04')}</div>`;
  }

  function benchmarkChart() {
    const lowerBetter = benchmarkMetric !== 'R2';
    const models = [...data.models].sort((a, b) => lowerBetter ? a[benchmarkMetric] - b[benchmarkMetric] : b[benchmarkMetric] - a[benchmarkMetric]);
    const maxValue = benchmarkMetric === 'R2' ? 1 : Math.max(...models.map(model => model[benchmarkMetric])) * 1.05;
    return `<div class="claims-model-controls"><label for="claims-model-metric">Compare by <select id="claims-model-metric"><option value="MAE" ${benchmarkMetric === 'MAE' ? 'selected' : ''}>MAE ($)</option><option value="RMSE" ${benchmarkMetric === 'RMSE' ? 'selected' : ''}>RMSE ($)</option><option value="R2" ${benchmarkMetric === 'R2' ? 'selected' : ''}>R²</option></select></label><span>${lowerBetter ? 'Lower is better' : 'Higher is better'}</span></div><div class="claims-simple-chart">${models.map(model => `<div class="claims-chart-row claims-model-row" role="img" aria-label="${escape(model.name)} ${benchmarkMetric === 'R2' ? 'R squared' : benchmarkMetric}: ${model[benchmarkMetric].toFixed(4)}"><span class="claims-chart-label">${escape(model.name)}</span><span class="claims-pair-track" aria-hidden="true"><i class="claims-bar" style="width:${model[benchmarkMetric] / maxValue * 100}%"></i></span><span class="claims-pair-values">${benchmarkMetric === 'R2' ? model.R2.toFixed(4) : money(model[benchmarkMetric])}</span></div>`).join('')}</div><details class="claims-benchmark-table"><summary>See all benchmark values</summary><div class="claims-table-wrap"><table class="claims-table"><thead><tr><th scope="col">Model</th><th scope="col">MAE ($)</th><th scope="col">RMSE ($)</th><th scope="col">R²</th></tr></thead><tbody>${data.models.map(model => `<tr><td>${escape(model.name)}</td><td>${model.MAE.toFixed(2)}</td><td>${model.RMSE.toFixed(2)}</td><td>${model.R2.toFixed(4)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  function featureChart() {
    const names = {
      location_Rural: 'Location: rural', location_Suburban: 'Location: suburban',
      vehicle_class_Luxury_SUV: 'Vehicle: luxury SUV', vehicle_class_Luxury_Car: 'Vehicle: luxury car',
      'vehicle_class_Four-Door_Car': 'Vehicle: four-door car', vehicle_class_SUV: 'Vehicle: SUV',
      coverage_Premium: 'Coverage: premium', coverage_Basic: 'Coverage: basic',
      'vehicle_class_Two-Door_Car': 'Vehicle: two-door car', income: 'Income',
    };
    const features = [...data.features].sort((a, b) => b.importance - a.importance);
    const maxValue = Math.max(...features.map(feature => feature.importance));
    return `<div class="claims-features">${features.map(feature => `<div class="claims-chart-row" role="img" aria-label="${escape(names[feature.name] || feature.name)}: ${(100 * feature.importance).toFixed(2)} percent importance"><span class="claims-chart-label">${escape(names[feature.name] || feature.name)}</span><span class="claims-pair-track" aria-hidden="true"><i class="claims-bar" style="width:${feature.importance / maxValue * 100}%"></i></span><span class="claims-pair-values">${(feature.importance * 100).toFixed(1)}%</span></div>`).join('')}</div><p class="claims-chart-footnote">The ten features in the supplied export. Values show their original share of total model importance and do not sum to 100%.</p>`;
  }

  function modelsView() {
    const best = [...data.models].sort((a, b) => b.R2 - a.R2)[0];
    return `<div class="claims-model-intro"><strong>${escape(best.name)} leads the six-model comparison.</strong><span>Benchmark scores use a fixed held-out test set. Filters affect the portfolio prediction check below.</span></div><div class="claims-grid claims-grid-equal">${card('Comparing the models', 'Fixed test-set results from model_results.csv', `<div class="claims-model-metrics"><div><small>Random Forest · MAE</small><strong>${money(best.MAE)}</strong></div><div><small>RMSE</small><strong>${money(best.RMSE)}</strong></div><div><small>R²</small><strong>${best.R2.toFixed(4)}</strong></div></div>${benchmarkChart()}`, 'TEST SET')}${card('Which features matter?', 'Random Forest feature importance · supplied top 10', featureChart(), 'FIXED')}${card('A portfolio prediction check', 'Actual and predicted means in the current selection', `<div class="claims-model-controls"><label for="claims-prediction-group">Group by <select id="claims-prediction-group"><option value="location" ${predictionDimension === 'location' ? 'selected' : ''}>Location</option><option value="coverage" ${predictionDimension === 'coverage' ? 'selected' : ''}>Coverage</option><option value="vehicle_class" ${predictionDimension === 'vehicle_class' ? 'selected' : ''}>Vehicle class</option></select></label><span>${number(current.total[0])} selected policies</span></div>${pairedChart(predictionDimension)}<p class="claims-chart-footnote">Comparing group averages can hide individual prediction errors. These portfolio averages are separate from the held-out benchmark scores.</p>`, 'FILTERED', 'claims-card-wide')}</div>`;
  }

  function renderKpis() {
    const total = current.total;
    const riskMean = total[0] ? groups('risk_score').reduce((sum, item) => sum + Number(item.name) * item.stats[0], 0) / total[0] : NaN;
    const kpis = [
      ['Policy records', number(total[0]), `${percent(total[0], data.recordCount)} of the full portfolio`],
      ['Average actual claim', money(actual(total)), 'Observed amount per policy'],
      ['Average predicted claim', money(predicted(total)), 'Random Forest estimate'],
      ['Average risk score', Number.isFinite(riskMean) ? `${riskMean.toFixed(2)}<small>/ 7</small>` : '—', 'Source rule-based score'],
    ];
    root.querySelector('#claims-kpis').innerHTML = kpis.map(([label, value, note]) => `<div class="claims-kpi"><p class="claims-kpi-label">${label}</p><p class="claims-kpi-value">${value}</p><p class="claims-kpi-meta">${note}</p></div>`).join('');
  }

  function renderChips() {
    filterSelects.forEach(select => { select.value = filters[select.dataset.filter] ?? ''; });
    root.querySelector('#claims-active-filters').innerHTML = Object.entries(filters).map(([dimension, index]) => `<button type="button" class="claims-filter-chip" data-remove-filter="${dimension}" aria-label="Remove ${escape(labels[dimension])} filter: ${escape(valuesFor(dimension)[Number(index)])}">${escape(labels[dimension])}: ${escape(valuesFor(dimension)[Number(index)])}<span aria-hidden="true">×</span></button>`).join('');
    root.querySelector('#claims-reset').disabled = !Object.keys(filters).length;
  }

  function renderView() {
    const empty = current.total[0] === 0;
    root.querySelector('#claims-empty').hidden = !empty || activeView === 'models';
    const renderers = {overview: overviewView, risk: riskView, customers: customersView, models: modelsView};
    views.forEach(view => {
      const panel = root.querySelector(`#claims-panel-${view}`);
      panel.hidden = view !== activeView || (empty && view !== 'models');
      if (!panel.hidden) panel.innerHTML = renderers[view]();
      const tab = root.querySelector(`#claims-tab-${view}`);
      tab.setAttribute('aria-selected', String(view === activeView));
      tab.tabIndex = view === activeView ? 0 : -1;
    });
  }

  function render() {
    current = aggregate();
    resultLabel.innerHTML = `Showing <strong>${number(current.total[0])}</strong> of ${number(data.recordCount)} policies`;
    renderKpis();
    renderChips();
    renderView();
    exportButton.disabled = !current.total[0];
  }

  function setFilter(dimension, index, toggle = false) {
    if (!(dimension in dimensionIndex)) return;
    if (index === '' || (toggle && filters[dimension] === String(index))) delete filters[dimension];
    else if (valuesFor(dimension)[Number(index)] !== undefined) filters[dimension] = String(index);
    render();
  }

  function reset() {
    Object.keys(filters).forEach(key => delete filters[key]);
    render();
  }

  function selectView(view, focus = false) {
    if (!views.includes(view)) return;
    activeView = view;
    renderView();
    if (focus) root.querySelector(`#claims-tab-${view}`).focus();
  }

  function exportSummary() {
    const total = current.total;
    const selection = Object.entries(filters).map(([dimension, index]) => `${labels[dimension]}: ${valuesFor(dimension)[Number(index)]}`).join(' | ') || 'All policies';
    const rows = [
      ['Insurance claims explorer — grouped portfolio summary'],
      ['Source', 'Full synthetic claims_predictions.csv export'],
      ['Selection', selection], ['Policy records', total[0]],
      ['Actual mean claim USD', actual(total).toFixed(6)],
      ['Predicted mean claim USD', predicted(total).toFixed(6)],
      ['Total actual claims USD', (total[1] / 100).toFixed(2)],
      ['Total predicted claims USD', total[2].toFixed(6)],
      ['Benchmark note', 'Model benchmarks are from the original held-out test set and do not change with portfolio filters.'],
      [], ['Dimension', 'Category', 'Policies', 'Actual mean claim USD', 'Predicted mean claim USD', 'Average risk score'],
    ];
    for (const dimension of ['state', 'coverage', 'vehicle_class', 'income_band', 'location', 'risk_score', 'claim_severity', 'sales_channel', 'employment_status']) {
      for (const item of groups(dimension)) {
        if (!item.stats[0]) continue;
        rows.push([labels[dimension], item.name, item.stats[0], actual(item.stats).toFixed(6), predicted(item.stats).toFixed(6), dimension === 'risk_score' ? item.name : '']);
      }
    }
    rows.push([], ['Fixed model benchmark', 'MAE USD', 'RMSE USD', 'R2']);
    data.models.forEach(model => rows.push([model.name, model.MAE, model.RMSE, model.R2]));
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {type: 'text/csv;charset=utf-8;'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'insurance-claims-summary.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  filterSelects.forEach(select => {
    valuesFor(select.dataset.filter).forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = name;
      select.appendChild(option);
    });
  });
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('reset', event => { event.preventDefault(); reset(); });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-filter]')) setFilter(event.target.dataset.filter, event.target.value);
    if (event.target.id === 'claims-model-metric') {
      benchmarkMetric = event.target.value;
      renderView();
      root.querySelector('#claims-model-metric').focus();
    }
    if (event.target.id === 'claims-prediction-group') {
      predictionDimension = event.target.value;
      renderView();
      root.querySelector('#claims-prediction-group').focus();
    }
  });
  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-view]');
    const filter = event.target.closest('[data-claims-filter]');
    const remove = event.target.closest('[data-remove-filter]');
    if (tab) selectView(tab.dataset.view);
    else if (filter) {
      const dimension = filter.dataset.claimsFilter;
      setFilter(dimension, filter.dataset.value, true);
      const chip = root.querySelector(`[data-remove-filter="${dimension}"]`);
      if (chip) chip.focus({preventScroll: true});
      else root.querySelector(`#claims-tab-${activeView}`).focus({preventScroll: true});
    }
    else if (remove) { setFilter(remove.dataset.removeFilter, ''); root.querySelector('#claims-results').focus({preventScroll: true}); }
    else if (event.target.closest('[data-reset]')) reset();
  });
  root.querySelector('.claims-tabs').addEventListener('keydown', event => {
    if (!event.target.matches('[role="tab"]')) return;
    let index = views.indexOf(activeView);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + views.length) % views.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = views.length - 1;
    else return;
    event.preventDefault();
    selectView(views[index], true);
  });
  exportButton.addEventListener('click', exportSummary);
  render();
})();
