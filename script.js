(() => {
  'use strict';

  const DAY_WORD = 'дн.';
  const PUNISHES = ['ajail', 'warn', 'ban', 'hardban', 'gunban', 'mute'];

  const DEFAULT_CONFIG = {
    globals: {
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
    ]
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
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  let lastOutput = [];
  let autoTimer = 0;

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    if (error) {
      el.style.background = '#2b171c';
      el.style.borderColor = '#70303f';
      el.style.color = '#ffc0ca';
    } else {
      el.style.background = '#18251e';
      el.style.borderColor = '#387954';
      el.style.color = '#d9f2e4';
    }
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

    if (!records.length && cleaned.trim() && !errors.length) {
      errors.push('Не найдено ни одной записи формата ID:...;PUNISH:...;TIME:...;NAME:...;');
    }

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

  function makeResult(punish, time, reason, ruleId, changed=true){
    return { punish, time, reason, ruleId, changed };
  }

  function dedupeOutputs(outputs){
    const seen = new Set();
    return outputs.filter(o => {
      const key = `${o.punish}:${o.time ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function evaluateGroup(group){
    const stats = summarize(group);
    const globals = config.globals;
    const rules = [...config.builtin].filter(r => r.enabled).sort((a,b) => (b.priority||0)-(a.priority||0));
    const reasons = [];
    let primary = null;

    const hasExistingBan = Boolean(stats.ban.count || stats.hardban.count);

    if (!hasExistingBan) {
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
        const strongest = stats.hardban.count ? 'hardban' : 'ban';
        outputs.push(makeResult(
          strongest,
          total,
          banCount > 1 ? banRule.title : `Базовое наказание ${strongest}`,
          banCount > 1 ? banRule.id : 'base',
          banCount > 1
        ));
      } else {
        for (const p of banTypes) {
          if (stats[p]?.count) {
            outputs.push(makeResult(p, stats[p].sum, 'Базовое суммирование одинаковых наказаний', 'base', stats[p].count > 1));
          }
        }
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
      for (const o of e.outputs) {
        flat.push({ ...o, group:e.group, stats:e.stats, command:commandFor(o,e.group) });
      }
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

  async function copyText(text){
    if (!text) return;
    let ok = false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      }
    } catch {
      ok = false;
    }

    toast(ok ? 'Скопировано' : 'Не удалось скопировать', !ok);
  }

  $('#processBtn').addEventListener('click', () => {
    setHeaderStatus('Обработка…', true);
    process();
  });

  $('#input').addEventListener('input', scheduleAutoProcess);
  $('#input').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      process();
    }
  });

  $('#strictMode').addEventListener('change', () => process({silent:true}));

  $('#clearInput').addEventListener('click', () => {
    $('#input').value = '';
    lastOutput = [];
    updateInputStats();
    renderMessages({errors:[],invalidLines:[]});
    renderResults([]);
    updateProcessStats([],[],[]);
    $('#resultSummary').textContent = 'Команд пока нет';
    $('#copyResult').disabled = true;
    toast('Поле очищено');
  });

  $('#copyInput').addEventListener('click', () => copyText($('#input').value));
  $('#copyResult').addEventListener('click', () => copyText(lastOutput.map(x=>x.command).join('\n')));
  $('#loadDemo').addEventListener('click', () => {
    $('#input').value = demoData;
    updateInputStats();
    process();
    toast('Пример загружен');
  });

  updateInputStats();
  updateProcessStats([],[],[]);
  history.replaceState(null, '', '#stacker');
})();
