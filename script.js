(() => {
  'use strict';

  const STORAGE_KEY = 'forum-stacker-rules-v3';
  const DAY_WORD = 'дн.';
  const PUNISHES = ['ajail', 'warn', 'ban', 'hardban', 'gunban', 'mute'];
  const PUNISH_LABEL = {
    ajail: 'demorgan / ajail', warn: 'warn', ban: 'ban', hardban: 'hardban', gunban: 'gunban', mute: 'mute'
  };

  const DEFAULT_CONFIG = {
    globals: {
      demorganAlias: 'ajail',
      gunbanAjailSplit: 60,
      demorganWarnThreshold: 140,
      demorganBanThreshold: 180,
      baseBanDays: 2,
      demorganHighBanDays: 2,
      muteExtraThreshold: 120,
      muteExtraDays: 1,
      ajailCap: 720,
      muteCap: 720
    },
    builtin: [
      { id:'gunban-ajail-low', enabled:true, title:'Gunban + demorgan до порога → warn', kind:'pairThreshold', a:'gunban', b:'ajail', metric:'sum', operator:'lt', thresholdKey:'gunbanAjailSplit', result:'warn', resultTime:null, priority:90 },
      { id:'gunban-ajail-high', enabled:true, title:'Gunban + demorgan от порога → ban', kind:'pairThreshold', a:'gunban', b:'ajail', metric:'sum', operator:'gte', thresholdKey:'gunbanAjailSplit', result:'ban', resultTimeKey:'baseBanDays', priority:100 },
      { id:'warn-ajail', enabled:true, title:'Warn + demorgan → ban', kind:'pair', a:'warn', b:'ajail', result:'ban', resultTimeKey:'baseBanDays', priority:80 },
      { id:'ban-ajail', enabled:true, title:'Ban + demorgan → дополнительные дни', kind:'addPerCount', base:'ban', extra:'ajail', daysPer:1, priority:70 },
      { id:'ban-gunban', enabled:true, title:'Ban + gunban → дополнительные дни', kind:'addPerCount', base:'ban', extra:'gunban', daysPer:1, priority:69 },
      { id:'sum-bans', enabled:true, title:'Ban / hardban суммируются по дням', kind:'sumBanTypes', types:['ban','hardban'], priority:60 },
      { id:'ajail-over-180', enabled:true, title:'2+ demorgan и сумма выше порога → ban', kind:'countAndSum', punish:'ajail', minCount:2, operator:'gt', thresholdKey:'demorganBanThreshold', result:'ban', resultTimeKey:'demorganHighBanDays', priority:85 },
      { id:'ajail-over-140', enabled:true, title:'2+ demorgan и сумма выше порога → warn', kind:'countAndSum', punish:'ajail', minCount:2, operator:'gt', thresholdKey:'demorganWarnThreshold', result:'warn', resultTime:null, priority:75 },
      { id:'ban-mute-extra', enabled:true, title:'При ban большой mute добавляет день', kind:'muteExtraOnBan', thresholdKey:'muteExtraThreshold', extraDaysKey:'muteExtraDays', priority:10 }
    ],
    custom: []
  };

  const demoData = String.raw`| ID:89057;PUNISH\:ajail;TIME:120;NAME:мира-0046; |
| ID:89057;PUNISH\:ajail;TIME:120;NAME:Ангел-0085; |
| ID:69255;PUNISH\:ajail;TIME:35;NAME:Алан-0036; |
| ID:69255;PUNISH\:warn;TIME:;NAME:самтайм-0010; |
| ID:98542;PUNISH\:mute;TIME:20;NAME:Ангел-0098; |
| ID:98542;PUNISH\:mute;TIME:110;NAME:Ангел-0098; |
| ID:51074;PUNISH\:ban;TIME:2;NAME:мира-0047; |
| ID:51074;PUNISH\:ajail;TIME:120;NAME:мира-0047; |`;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  let config = loadConfig();
  let lastOutput = [];
  let autoTimer = 0;

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function nullableNumber(v){ if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

  function loadConfig(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mergeConfig(JSON.parse(raw)) : clone(DEFAULT_CONFIG);
    } catch { return clone(DEFAULT_CONFIG); }
  }
  function mergeConfig(incoming){
    const base = clone(DEFAULT_CONFIG);
    base.globals = { ...base.globals, ...(incoming?.globals || {}) };
    if (Array.isArray(incoming?.builtin)) {
      base.builtin = base.builtin.map(def => ({ ...def, ...(incoming.builtin.find(x => x.id === def.id) || {}) }));
    }
    base.custom = Array.isArray(incoming?.custom) ? incoming.custom : [];
    return base;
  }
  function saveConfig(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setHeaderStatus('Сохранено');
    clearTimeout(saveConfig.statusTimer);
    saveConfig.statusTimer = setTimeout(() => setHeaderStatus('Готов'), 1000);
  }

  function setHeaderStatus(text, busy=false){
    const el = $('#headerStatus');
    el.classList.toggle('busy', busy);
    el.innerHTML = `<span class="status-dot"></span>${escapeHtml(text)}`;
  }
  function toast(text, error=false){
    const el = $('#toast');
    el.textContent = text;
    el.style.display = 'block';
    if (error) { el.style.background = '#2b171c'; el.style.borderColor = '#70303f'; el.style.color = '#ffc0ca'; }
    else { el.style.background = '#18251e'; el.style.borderColor = '#387954'; el.style.color = '#d9f2e4'; }
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.style.display = 'none'; }, 1800);
  }

  function normalizePunish(value){
    return String(value || '').trim().replace(/^\//,'').toLowerCase().replace(/^demorgan$/,'ajail');
  }

  function parseInput(text, strict=false){
    const cleaned = String(text || '').replace(/PUNISH\\:/gi, 'PUNISH:');
    const lines = cleaned.split(/\r?\n/);
    const recordRe = /ID\s*:\s*([^;|]+)\s*;\s*PUNISH\s*:\s*([^;|]+)\s*;\s*TIME\s*:\s*([^;|]*)\s*;\s*NAME\s*:\s*([^;|]+)\s*;?/i;
    const records = [];
    const errors = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || /^\|?\s*:?-{2,}/.test(trimmed) || /^\|?\s*-\s*\|?$/.test(trimmed)) return;
      if (!/ID\s*:/i.test(trimmed)) return;
      const m = recordRe.exec(trimmed);
      if (!m) { invalidLines.push(index + 1); return; }
      const id = m[1].trim();
      const punish = normalizePunish(m[2]);
      const timeRaw = m[3].trim();
      const name = m[4].trim();
      const time = timeRaw === '' ? null : Number.parseInt(timeRaw, 10);
      if (!id || !punish || !name) { invalidLines.push(index + 1); return; }
      if (!PUNISHES.includes(punish)) {
        if (strict) errors.push(`Строка ${index + 1}: неизвестное наказание «${punish}»`);
        else invalidLines.push(index + 1);
        return;
      }
      if (punish !== 'warn' && (time === null || Number.isNaN(time))) {
        errors.push(`Строка ${index + 1}: нет корректного TIME для ${punish}`);
        return;
      }
      records.push({ id, punish, time: Number.isNaN(time) ? null : time, name, line:index + 1 });
    });

    if (!records.length && cleaned.trim() && !errors.length) errors.push('Не найдено ни одной записи формата ID:...;PUNISH:...;TIME:...;NAME:...;');
    return { records, errors, invalidLines, lineCount: cleaned.trim() ? lines.length : 0 };
  }

  function groupById(records){
    const map = new Map();
    for (const r of records) {
      if (!map.has(r.id)) map.set(r.id, { id:r.id, records:[], names:[] });
      const group = map.get(r.id);
      group.records.push(r);
      if (!group.names.includes(r.name)) group.names.push(r.name);
    }
    return [...map.values()];
  }

  function summarize(group){
    const stats = {};
    for (const p of PUNISHES) stats[p] = { count:0, sum:0, records:[] };
    for (const r of group.records) {
      if (!stats[r.punish]) stats[r.punish] = { count:0, sum:0, records:[] };
      const s = stats[r.punish];
      s.count++;
      s.records.push(r);
      s.sum += r.time || 0;
    }
    stats.ajail.sum = Math.min(stats.ajail.sum, Number(config.globals.ajailCap) || 720);
    stats.mute.sum = Math.min(stats.mute.sum, Number(config.globals.muteCap) || 720);
    return stats;
  }

  function compare(value, operator, threshold){
    if (operator === 'lt') return value < threshold;
    if (operator === 'lte') return value <= threshold;
    if (operator === 'gte') return value >= threshold;
    if (operator === 'gt') return value > threshold;
    if (operator === 'eq') return value === threshold;
    return false;
  }
  function makeResult(punish, time, reason, ruleId, changed=true){ return { punish, time, reason, ruleId, changed }; }
  function dedupeOutputs(outputs){
    const seen = new Set();
    return outputs.filter(o => { const key = `${o.punish}:${o.time ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }

  function evaluateGroup(group){
    const stats = summarize(group);
    const globals = config.globals;
    const rules = [...config.builtin].filter(r => r.enabled).sort((a,b) => (b.priority||0)-(a.priority||0));
    const reasons = [];
    let primary = null;

    const custom = [...config.custom].filter(r => r.enabled !== false).sort((a,b)=>(b.priority||110)-(a.priority||110));
    for (const r of custom) {
      const sa = stats[normalizePunish(r.a)] || {count:0,sum:0};
      const sb = stats[normalizePunish(r.b)] || {count:0,sum:0};
      if (!sa.count || !sb.count) continue;
      const metric = r.metric === 'count' ? sb.count : sb.sum;
      if (r.operator && !compare(metric, r.operator, Number(r.threshold)||0)) continue;
      primary = makeResult(normalizePunish(r.result), nullableNumber(r.resultTime), `Пользовательское правило: ${r.title || `${r.a} + ${r.b}`}`, r.id || 'custom');
      break;
    }

    const hasExistingBan = Boolean(stats.ban?.count || stats.hardban?.count);
    if (!primary && !hasExistingBan) {
      for (const r of rules) {
        if (r.kind === 'pairThreshold') {
          if (!stats[r.a]?.count || !stats[r.b]?.count) continue;
          const value = r.metric === 'count' ? stats[r.b].count : stats[r.b].sum;
          if (compare(value, r.operator, Number(globals[r.thresholdKey]))) {
            primary = makeResult(r.result, r.resultTimeKey ? Number(globals[r.resultTimeKey]) : r.resultTime, r.title, r.id);
            break;
          }
        }
        if (r.kind === 'pair' && stats[r.a]?.count && stats[r.b]?.count) {
          primary = makeResult(r.result, r.resultTimeKey ? Number(globals[r.resultTimeKey]) : r.resultTime, r.title, r.id);
          break;
        }
        if (r.kind === 'countAndSum') {
          const s = stats[r.punish];
          if (s?.count >= Number(r.minCount || 2) && compare(s.sum, r.operator, Number(globals[r.thresholdKey]))) {
            primary = makeResult(r.result, r.resultTimeKey ? Number(globals[r.resultTimeKey]) : r.resultTime, r.title, r.id);
            break;
          }
        }
      }
    }

    let outputs = [];
    if (primary) {
      outputs.push(primary);
    } else {
      const banRule = rules.find(r => r.id === 'sum-bans');
      const banTypes = ['ban','hardban'];
      const banCount = banTypes.reduce((n,p)=>n+(stats[p]?.count||0),0);
      if (banRule?.enabled && banCount) {
        const total = banTypes.reduce((n,p)=>n+(stats[p]?.sum||0),0);
        const strongest = stats.hardban?.count ? 'hardban' : 'ban';
        outputs.push(makeResult(strongest, total, banCount > 1 ? banRule.title : `Базовое наказание ${strongest}`, banCount > 1 ? banRule.id : 'base', banCount > 1));
      } else {
        for (const p of banTypes) if (stats[p]?.count) outputs.push(makeResult(p, stats[p].sum, 'Базовое суммирование одинаковых наказаний', 'base', stats[p].count > 1));
      }
      if (stats.gunban.count) outputs.push(makeResult('gunban', null, 'Базовое наказание gunban', 'base', stats.gunban.count > 1));
      if (stats.ajail.count) outputs.push(makeResult('ajail', stats.ajail.sum, 'Суммирование demorgan/ajail по ID', 'base', stats.ajail.count > 1));
      if (stats.mute.count) outputs.push(makeResult('mute', stats.mute.sum, 'Суммирование mute по ID', 'base', stats.mute.count > 1));
      if (stats.warn.count) outputs.push(makeResult('warn', null, stats.warn.count > 1 ? 'Несколько warn для одного ID' : 'Базовое наказание warn', 'base', stats.warn.count > 1));
    }

    const ban = outputs.find(o => o.punish === 'ban');
    const absorbed = new Set();
    if (ban) {
      for (const r of rules) {
        if (r.kind === 'addPerCount' && stats[r.base]?.count && stats[r.extra]?.count) {
          const add = stats[r.extra].count * Number(r.daysPer || 1);
          ban.time = (Number(ban.time)||0) + add;
          reasons.push(`${r.title}: +${add} ${DAY_WORD}`);
          ban.changed = true;
          absorbed.add(r.extra);
        }
      }
      const muteRule = rules.find(r => r.kind === 'muteExtraOnBan');
      if (muteRule && stats.mute.sum >= Number(globals[muteRule.thresholdKey])) {
        const add = Number(globals[muteRule.extraDaysKey]) || 1;
        ban.time = (Number(ban.time)||0) + add;
        reasons.push(`${muteRule.title}: mute ${stats.mute.sum} мин. → +${add} ${DAY_WORD}`);
        ban.changed = true;
      }
      absorbed.add('mute');
      outputs = outputs.filter(o => o === ban || !absorbed.has(o.punish));
    }

    if (primary?.punish !== 'ban' && primary && stats.mute.count) {
      outputs.push(makeResult('mute', stats.mute.sum, 'Mute не конфликтует с итоговым наказанием и оставлен отдельно', 'base', stats.mute.count > 1));
    }

    outputs = dedupeOutputs(outputs);
    if (reasons.length && ban) ban.reason = `${ban.reason} · ${reasons.join(' · ')}`;
    return { group, stats, outputs };
  }

  function commandFor(item, group){
    const plural = group.names.length === 1 ? 'Жалоба' : 'Жалобы';
    const names = group.names.join(', ');
    if (item.punish === 'warn') return `/warn ${group.id} ${plural} ${names}`;
    if (item.punish === 'gunban') return `/gunban ${group.id} бесконечно ${plural} ${names}`;
    return `/${item.punish} ${group.id} ${item.time ?? ''} ${plural} ${names}`.replace(/\s+/g,' ').trim();
  }

  function process({silent=false}={}){
    const input = $('#input').value;
    const parsed = parseInput(input, $('#strictMode').checked);
    renderMessages(parsed);

    if (!parsed.records.length) {
      lastOutput = [];
      renderResults([]);
      updateProcessStats(parsed.records, [], []);
      $('#resultSummary').textContent = input.trim() ? 'Не удалось сформировать команды' : 'Команд пока нет';
      $('#copyResult').disabled = true;
      if (!silent) setHeaderStatus('Готов');
      return;
    }

    const groups = groupById(parsed.records);
    const evaluated = groups.map(evaluateGroup);
    const flat = [];
    for (const e of evaluated) {
      for (const o of e.outputs) flat.push({ ...o, group:e.group, stats:e.stats, command:commandFor(o,e.group) });
    }
    const order = {ban:0,hardban:1,gunban:2,warn:3,ajail:4,mute:5};
    flat.sort((a,b)=>(order[a.punish]??99)-(order[b.punish]??99) || (Number(b.time)||0)-(Number(a.time)||0));
    lastOutput = flat;
    renderResults(flat);
    updateProcessStats(parsed.records, groups, flat);
    $('#resultSummary').textContent = `${parsed.records.length} записей → ${groups.length} ID → ${flat.length} команд`;
    $('#copyResult').disabled = !flat.length;
    if (!silent) setHeaderStatus('Готов');
  }

  function renderMessages(parsed){
    const box = $('#messages');
    const chunks = [];
    if (parsed.errors.length) chunks.push(`<div class="message error">${parsed.errors.map(escapeHtml).join('<br>')}</div>`);
    if (parsed.invalidLines.length) chunks.push(`<div class="message warn">Не распознано строк: ${parsed.invalidLines.length} · ${parsed.invalidLines.slice(0,12).join(', ')}${parsed.invalidLines.length>12?'…':''}</div>`);
    box.innerHTML = chunks.join('');
  }

  function renderResults(items){
    const root = $('#results');
    if (!items.length) {
      root.className = 'results empty-state';
      root.innerHTML = `<div><svg class="empty-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg><strong>Здесь появятся готовые команды</strong><span>Вставьте список наказаний слева.</span></div>`;
      return;
    }
    root.className = 'results';
    root.innerHTML = items.map(item => {
      const sources = item.group.records.map(r => `<li>стр. ${r.line}: ${escapeHtml(r.punish)}${r.time !== null ? ` · ${r.time}` : ''} · ${escapeHtml(r.name)}</li>`).join('');
      return `<details class="result-row">
        <summary>
          <span class="result-id">ID ${escapeHtml(item.group.id)}</span>
          <span class="result-command" title="${escapeHtml(item.command)}">${escapeHtml(item.command)}</span>
          <span class="result-badges"><span class="badge">${escapeHtml(item.punish)}</span>${item.ruleId!=='base'?'<span class="badge rule">правило</span>':''}${item.changed?'<span class="badge changed">stack</span>':''}</span>
        </summary>
        <div class="result-detail">
          <div class="detail-grid">
            <div class="detail-block"><span>Применено</span><p>${escapeHtml(item.reason || 'Базовое суммирование')}</p></div>
            <div class="detail-block"><span>Исходные записи</span><ul class="source-list">${sources}</ul></div>
          </div>
        </div>
      </details>`;
    }).join('');
  }

  function updateProcessStats(records, groups, commands){
    $('#statRecords').textContent = records.length;
    $('#statPlayers').textContent = groups.length;
    $('#statMerged').textContent = groups.reduce((n,g)=>n + Math.max(0, g.records.length - 1), 0);
    $('#statCommands').textContent = commands.length;
  }

  function updateInputStats(){
    const text = $('#input').value;
    const parsed = parseInput(text, false);
    $('#inputStats').textContent = `${parsed.lineCount} строк · ${parsed.records.length} записей`;
  }

  function scheduleAutoProcess(){
    clearTimeout(autoTimer);
    updateInputStats();
    const indicator = $('#autoIndicator');
    indicator.classList.add('busy');
    indicator.innerHTML = '<span class="status-dot"></span>Ожидание';
    setHeaderStatus('Обработка…', true);
    autoTimer = setTimeout(() => {
      process({silent:true});
      indicator.classList.remove('busy');
      indicator.innerHTML = '<span class="status-dot"></span>Авто';
      setHeaderStatus('Готов');
    }, 280);
  }

  async function copyText(text, button){
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      }
    } catch { ok = false; }
    toast(ok ? 'Скопировано' : 'Не удалось скопировать', !ok);
    if (button) {
      const old = button.dataset.originalText || button.textContent.trim();
      button.dataset.originalText = old;
    }
  }

  function switchPage(page){
    $$('[data-page-panel]').forEach(panel => {
      const active = panel.dataset.pagePanel === page;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    $$('.nav-item').forEach(btn => {
      const active = btn.dataset.page === page;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
    });
    if (page === 'rules') renderRuleEditor();
    history.replaceState(null, '', `#${page}`);
  }

  function globalField(key, label, suffix=''){
    return `<label class="field"><span>${escapeHtml(label)}</span><input data-global="${key}" type="number" min="0" value="${escapeHtml(config.globals[key])}" aria-label="${escapeHtml(label)}">${suffix ? `<small>${escapeHtml(suffix)}</small>` : ''}</label>`;
  }
  function ruleToggle(r){ return `<label class="rule-toggle"><input data-builtin-enabled="${r.id}" type="checkbox" ${r.enabled?'checked':''}>Вкл.</label>`; }

  function builtinCard(r){
    const g = config.globals;
    let desc = '';
    let fields = '';
    if (r.id === 'ajail-over-140') {
      desc = 'При двух и более demorgan итоговая сумма выше указанного порога превращается в warn.';
      fields = globalField('demorganWarnThreshold','Порог, минут');
    } else if (r.id === 'ajail-over-180') {
      desc = 'Более высокий порог имеет приоритет над warn и превращает сумму в ban.';
      fields = globalField('demorganBanThreshold','Порог, минут') + globalField('demorganHighBanDays','Ban, дней');
    } else if (r.id === 'gunban-ajail-low') {
      desc = `Если сумма demorgan меньше ${g.gunbanAjailSplit} минут — итог warn.`;
      fields = globalField('gunbanAjailSplit','Граница, минут');
    } else if (r.id === 'gunban-ajail-high') {
      desc = `Если сумма demorgan от ${g.gunbanAjailSplit} минут — итог ban.`;
      fields = globalField('gunbanAjailSplit','Граница, минут') + globalField('baseBanDays','Ban, дней');
    } else if (r.id === 'warn-ajail') {
      desc = 'Warn вместе с demorgan заменяется на ban.';
      fields = globalField('baseBanDays','Ban, дней');
    } else if (r.id === 'ban-ajail') {
      desc = 'Каждый demorgan добавляет дни к уже существующему ban и отдельно больше не выводится.';
      fields = `<label class="field"><span>Дней за demorgan</span><input data-daysper="${r.id}" type="number" min="0" value="${r.daysPer}"></label>`;
    } else if (r.id === 'ban-gunban') {
      desc = 'Каждый gunban добавляет дни к ban и отдельно больше не выводится.';
      fields = `<label class="field"><span>Дней за gunban</span><input data-daysper="${r.id}" type="number" min="0" value="${r.daysPer}"></label>`;
    } else if (r.id === 'sum-bans') {
      desc = 'Дни ban и hardban складываются; если есть hardban, он остаётся итоговым типом.';
    } else if (r.id === 'ban-mute-extra') {
      desc = 'При наличии итогового ban mute не выводится отдельно. Большая сумма mute добавляет дни.';
      fields = globalField('muteExtraThreshold','Порог mute, минут') + globalField('muteExtraDays','Добавить дней');
    }
    return `<article class="rule-item">
      <div class="rule-item-top"><div><div class="rule-title">${escapeHtml(r.title)}</div><div class="rule-desc">${escapeHtml(desc)}</div></div>${ruleToggle(r)}</div>
      ${fields ? `<div class="rule-fields">${fields}</div>` : ''}
    </article>`;
  }

  function punishOptions(selected){
    return PUNISHES.map(p => `<option value="${p}" ${p===selected?'selected':''}>${escapeHtml(PUNISH_LABEL[p])}</option>`).join('');
  }
  function operatorOptions(selected){
    const opts = [['','Без порога'],['lt','Меньше'],['lte','Не больше'],['gte','Не меньше'],['gt','Больше'],['eq','Равно']];
    return opts.map(([v,label]) => `<option value="${v}" ${v===selected?'selected':''}>${label}</option>`).join('');
  }
  function metricOptions(selected){
    return `<option value="sum" ${selected!=='count'?'selected':''}>Сумма времени B</option><option value="count" ${selected==='count'?'selected':''}>Количество B</option>`;
  }
  function customCard(r){
    return `<article class="custom-rule-card">
      <div class="custom-title-row">
        <input type="text" data-custom-field="${r.id}|title" value="${escapeHtml(r.title || 'Пользовательское правило')}" aria-label="Название правила">
        <div class="custom-actions">${`<label class="rule-toggle"><input data-custom-enabled="${r.id}" type="checkbox" ${r.enabled!==false?'checked':''}>Вкл.</label>`}<button class="mini-danger" data-remove-custom="${r.id}" type="button">Удалить</button></div>
      </div>
      <div class="custom-fields">
        <label class="field"><span>Наказание A</span><select data-custom-field="${r.id}|a">${punishOptions(r.a)}</select></label>
        <label class="field"><span>Наказание B</span><select data-custom-field="${r.id}|b">${punishOptions(r.b)}</select></label>
        <label class="field"><span>Проверять</span><select data-custom-field="${r.id}|metric">${metricOptions(r.metric)}</select></label>
        <label class="field"><span>Условие</span><select data-custom-field="${r.id}|operator">${operatorOptions(r.operator)}</select></label>
        <label class="field"><span>Порог</span><input data-custom-field="${r.id}|threshold" type="number" min="0" value="${r.threshold ?? ''}" placeholder="—"></label>
        <label class="field"><span>Итог</span><select data-custom-field="${r.id}|result">${punishOptions(r.result)}</select></label>
        <label class="field"><span>Время / дни итога</span><input data-custom-field="${r.id}|resultTime" type="number" min="0" value="${r.resultTime ?? ''}" placeholder="—"></label>
      </div>
    </article>`;
  }

  function renderRuleEditor(){
    const byId = id => config.builtin.find(r => r.id === id);
    $('#demorganRules').innerHTML = ['ajail-over-140','ajail-over-180'].map(id => builtinCard(byId(id))).join('');
    $('#combinationRules').innerHTML = ['gunban-ajail-low','gunban-ajail-high','warn-ajail'].map(id => builtinCard(byId(id))).join('');
    $('#additiveRules').innerHTML = ['ban-ajail','ban-gunban','sum-bans','ban-mute-extra'].map(id => builtinCard(byId(id))).join('');
    $('#globalSettings').innerHTML = [
      globalField('baseBanDays','Базовый ban, дней'),
      globalField('ajailCap','Максимум ajail, минут'),
      globalField('muteCap','Максимум mute, минут')
    ].join('');
    $('#customRules').innerHTML = config.custom.length ? config.custom.map(customCard).join('') : '<div class="custom-empty">Своих правил пока нет. Нажмите «Добавить правило».</div>';
    wireRuleEditor();
  }

  function wireRuleEditor(){
    $$('[data-global]').forEach(el => el.addEventListener('change', () => {
      config.globals[el.dataset.global] = Number(el.value);
      saveConfig(); renderRuleEditor(); process({silent:true});
    }));
    $$('[data-builtin-enabled]').forEach(el => el.addEventListener('change', () => {
      const r = config.builtin.find(x => x.id === el.dataset.builtinEnabled);
      if (r) r.enabled = el.checked;
      saveConfig(); process({silent:true});
    }));
    $$('[data-daysper]').forEach(el => el.addEventListener('change', () => {
      const r = config.builtin.find(x => x.id === el.dataset.daysper);
      if (r) r.daysPer = Number(el.value);
      saveConfig(); process({silent:true});
    }));
    $$('[data-custom-field]').forEach(el => el.addEventListener('change', () => {
      const [id,key] = el.dataset.customField.split('|');
      const r = config.custom.find(x => x.id === id);
      if (!r) return;
      r[key] = ['threshold','resultTime','priority'].includes(key) ? nullableNumber(el.value) : el.value;
      saveConfig(); process({silent:true});
    }));
    $$('[data-custom-enabled]').forEach(el => el.addEventListener('change', () => {
      const r = config.custom.find(x => x.id === el.dataset.customEnabled);
      if (r) r.enabled = el.checked;
      saveConfig(); process({silent:true});
    }));
    $$('[data-remove-custom]').forEach(el => el.addEventListener('click', () => {
      config.custom = config.custom.filter(x => x.id !== el.dataset.removeCustom);
      saveConfig(); renderRuleEditor(); process({silent:true});
    }));
  }

  function addCustom(){
    const id = 'custom-' + Date.now().toString(36);
    config.custom.unshift({ id, enabled:true, title:'Новое правило', a:'ajail', b:'mute', metric:'sum', operator:'', threshold:null, result:'warn', resultTime:null, priority:110 });
    saveConfig(); renderRuleEditor();
    $('#customRules input[type=text]')?.focus();
  }

  function exportRules(){
    const blob = new Blob([JSON.stringify(config,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'admin-prospekt-stacker-rules.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
    toast('Правила экспортированы');
  }
  async function importRules(file){
    try {
      config = mergeConfig(JSON.parse(await file.text()));
      saveConfig(); renderRuleEditor(); process({silent:true}); toast('Правила импортированы');
    } catch { toast('Не удалось импортировать JSON', true); }
  }

  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
  $('#processBtn').addEventListener('click', () => { setHeaderStatus('Обработка…', true); process(); });
  $('#input').addEventListener('input', scheduleAutoProcess);
  $('#input').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); process(); } });
  $('#strictMode').addEventListener('change', () => process({silent:true}));
  $('#clearInput').addEventListener('click', () => {
    $('#input').value = ''; lastOutput = []; updateInputStats(); renderMessages({errors:[],invalidLines:[]}); renderResults([]); updateProcessStats([],[],[]); $('#resultSummary').textContent='Команд пока нет'; $('#copyResult').disabled=true; toast('Поле очищено');
  });
  $('#copyInput').addEventListener('click', e => copyText($('#input').value, e.currentTarget));
  $('#copyResult').addEventListener('click', e => copyText(lastOutput.map(x=>x.command).join('\n'), e.currentTarget));
  $('#loadDemo').addEventListener('click', () => { $('#input').value = demoData; updateInputStats(); process(); toast('Пример загружен'); });
  $('#addCustomRule').addEventListener('click', addCustom);
  $('#resetRules').addEventListener('click', () => {
    if (!confirm('Сбросить все правила к значениям по умолчанию?')) return;
    config = clone(DEFAULT_CONFIG); saveConfig(); renderRuleEditor(); process({silent:true}); toast('Правила сброшены');
  });
  $('#exportRules').addEventListener('click', exportRules);
  $('#importRules').addEventListener('change', e => { if (e.target.files[0]) importRules(e.target.files[0]); e.target.value=''; });

  updateInputStats();
  updateProcessStats([],[],[]);
  switchPage(location.hash === '#rules' ? 'rules' : 'stacker');
})();
