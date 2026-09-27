(() => {
  'use strict';

  const PUNISHES = ['ajail', 'warn', 'ban', 'hardban', 'gunban', 'mute', 'speedlimit'];
  const TIMED_STACKABLE = ['ajail', 'ban', 'hardban', 'mute'];
  const SINGLE_COMMAND = ['warn', 'gunban'];

  const demoData = String.raw`| ID:89057;PUNISH\:ajail;TIME:120;NAME:мира-0046; |
| ID:89057;PUNISH\:ajail;TIME:120;NAME:Ангел-0085; |
| ID:69255;PUNISH\:ajail;TIME:35;NAME:Алан-0036; |
| ID:69255;PUNISH\:warn;TIME:;NAME:самтайм-0010; |
| ID:98542;PUNISH\:mute;TIME:20;NAME:Ангел-0098; |
| ID:98542;PUNISH\:mute;TIME:110;NAME:Ангел-0098; |
| ID:51074;PUNISH\:ban;TIME:2;NAME:мира-0047; |
| ID:51074;PUNISH\:ajail;TIME:120;NAME:мира-0047; |
| ID:94465;PUNISH\:speedlimit;SPEED:60;TIME:120;NAME:мира-0077; |`;

  const $ = (sel) => document.querySelector(sel);
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

  function parseInteger(value){
    const raw = String(value ?? '').trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }

  function fieldsFromLine(line){
    const normalized = String(line || '').replace(/\\:/g, ':');
    const fields = {};
    const fieldRe = /(?:^|[|;\s])(ID|PUNISH|SPEED|TIME|NAME)\s*:\s*([^;|]*)/gi;
    let match;
    while ((match = fieldRe.exec(normalized))) {
      fields[match[1].toUpperCase()] = match[2].trim();
    }
    return fields;
  }

  function parseInput(text, strict=false){
    const cleaned = String(text || '');
    const lines = cleaned.split(/\r?\n/);
    const records = [];
    const errors = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || /^\|?\s*:?-{2,}/.test(trimmed) || /^\|?\s*-\s*\|?$/.test(trimmed)) return;
      if (!/ID\s*:/i.test(trimmed)) return;

      const fields = fieldsFromLine(trimmed);
      const id = fields.ID || '';
      const punish = normalizePunish(fields.PUNISH);
      const name = fields.NAME || '';

      if (!id || !punish || !name) {
        invalidLines.push(index + 1);
        return;
      }

      if (!PUNISHES.includes(punish)) {
        if (strict) errors.push(`Строка ${index + 1}: неизвестное наказание «${punish}»`);
        else invalidLines.push(index + 1);
        return;
      }

      if (punish === 'speedlimit') {
        const speed = parseInteger(fields.SPEED);
        const time = parseInteger(fields.TIME);
        if (speed === null || speed <= 0) {
          errors.push(`Строка ${index + 1}: нет корректного SPEED для speedlimit`);
          return;
        }
        if (time === null || time <= 0) {
          errors.push(`Строка ${index + 1}: нет корректного TIME для speedlimit`);
          return;
        }
        records.push({ id, punish, speed, time, name, line:index + 1 });
        return;
      }

      const time = fields.TIME === undefined || fields.TIME === '' ? null : parseInteger(fields.TIME);
      if (!['warn', 'gunban'].includes(punish) && time === null) {
        errors.push(`Строка ${index + 1}: нет корректного TIME для ${punish}`);
        return;
      }

      records.push({ id, punish, speed:null, time, name, line:index + 1 });
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

  function sumLabel(records, punish, total){
    if (records.length <= 1) return 'Без изменений';
    const parts = records.map(r => r.time ?? 0).join(' + ');
    return `${records.length} записи ${punish} объединены: ${parts} = ${total}`;
  }

  function evaluateGroup(group){
    const outputs = [];

    for (const punish of TIMED_STACKABLE) {
      const records = group.records.filter(r => r.punish === punish);
      if (!records.length) continue;
      const total = records.reduce((sum, r) => sum + (Number(r.time) || 0), 0);
      outputs.push({
        punish,
        time: total,
        speed: null,
        changed: records.length > 1,
        reason: sumLabel(records, punish, total),
        sourceRecords: records
      });
    }

    for (const punish of SINGLE_COMMAND) {
      const records = group.records.filter(r => r.punish === punish);
      if (!records.length) continue;
      outputs.push({
        punish,
        time: null,
        speed: null,
        changed: records.length > 1,
        reason: records.length > 1 ? `${records.length} записи ${punish} объединены в одну команду` : 'Без изменений',
        sourceRecords: records
      });
    }

    for (const record of group.records.filter(r => r.punish === 'speedlimit')) {
      outputs.push({
        punish: 'speedlimit',
        speed: record.speed,
        time: record.time,
        changed: false,
        reason: `Ограничение ${record.speed} км/ч на ${record.time} мин.`,
        sourceRecords: [record]
      });
    }

    return { group, outputs };
  }

  function commandFor(item, group){
    const plural = group.names.length === 1 ? 'Жалоба' : 'Жалобы';
    const names = group.names.join(', ');
    if (item.punish === 'warn') return `/warn ${group.id} ${plural} ${names}`;
    if (item.punish === 'gunban') return `/gunban ${group.id} бесконечно ${plural} ${names}`;
    if (item.punish === 'speedlimit') return `/speedlimit ${group.id} ${item.speed} ${item.time} ${plural} ${names}`;
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
        flat.push({ ...o, group:e.group, command:commandFor(o,e.group) });
      }
    }

    const order = {ban:0,hardban:1,gunban:2,warn:3,speedlimit:4,ajail:5,mute:6};
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
      const sources = item.sourceRecords.map(r => {
        const speed = r.punish === 'speedlimit' ? ` · ${r.speed} км/ч` : '';
        const time = r.time !== null ? ` · ${r.time}` : '';
        return `<li>стр. ${r.line}: ${escapeHtml(r.punish)}${speed}${time} · ${escapeHtml(r.name)}</li>`;
      }).join('');
      return `<details class="result-row">
        <summary>
          <span class="result-id">ID ${escapeHtml(item.group.id)}</span>
          <span class="result-command" title="${escapeHtml(item.command)}">${escapeHtml(item.command)}</span>
          <span class="result-badges"><span class="badge">${escapeHtml(item.punish)}</span>${item.changed?'<span class="badge changed">stack</span>':''}</span>
        </summary>
        <div class="result-detail">
          <div class="detail-grid">
            <div class="detail-block"><span>Обработка</span><p>${escapeHtml(item.reason)}</p></div>
            <div class="detail-block"><span>Исходные записи</span><ul class="source-list">${sources}</ul></div>
          </div>
        </div>
      </details>`;
    }).join('');
  }

  function mergedCount(groups){
    let total = 0;
    for (const group of groups) {
      for (const punish of [...TIMED_STACKABLE, ...SINGLE_COMMAND]) {
        const count = group.records.filter(r => r.punish === punish).length;
        total += Math.max(0, count - 1);
      }
    }
    return total;
  }

  function updateProcessStats(records, groups, commands){
    $('#statRecords').textContent = records.length;
    $('#statPlayers').textContent = groups.length;
    $('#statMerged').textContent = mergedCount(groups);
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
