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
| ID:94465;PUNISH\:speedlimit;SPEED:60;TIME:120;NAME:мира-0077; |
| ID:94465;PUNISH\:speedlimit;SPEED:60;TIME:30;NAME:Ангел-0023; |`;

  const $ = (sel) => document.querySelector(sel);
  let lastOutput = [];
  let autoTimer = 0;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function toast(text, error = false) {
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

  function normalizePunish(value) {
    return String(value || '').trim().replace(/^\//, '').toLowerCase().replace(/^demorgan$/, 'ajail');
  }

  function parseInteger(value) {
    const raw = String(value ?? '').trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const number = Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function fieldsFromLine(line) {
    const normalized = String(line || '').replace(/\\:/g, ':');
    const fields = {};
    const fieldRe = /(?:^|[|;\s])(ID|PUNISH|SPEED|TIME|NAME)\s*:\s*([^;|]*)/gi;
    let match;
    while ((match = fieldRe.exec(normalized))) {
      fields[match[1].toUpperCase()] = match[2].trim();
    }
    return fields;
  }

  function parseInput(text) {
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
        invalidLines.push(index + 1);
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
        records.push({ id, punish, speed, time, name, line: index + 1 });
        return;
      }

      const time = fields.TIME === undefined || fields.TIME === '' ? null : parseInteger(fields.TIME);
      if (!['warn', 'gunban'].includes(punish) && time === null) {
        errors.push(`Строка ${index + 1}: нет корректного TIME для ${punish}`);
        return;
      }

      records.push({ id, punish, speed: null, time, name, line: index + 1 });
    });

    if (!records.length && cleaned.trim() && !errors.length) {
      errors.push('Не найдено ни одной записи формата ID:...;PUNISH:...;TIME:...;NAME:...;');
    }

    return { records, errors, invalidLines, lineCount: cleaned.trim() ? lines.length : 0 };
  }

  function groupById(records) {
    const map = new Map();
    for (const record of records) {
      if (!map.has(record.id)) map.set(record.id, { id: record.id, records: [] });
      map.get(record.id).records.push(record);
    }
    return [...map.values()];
  }

  function sumLabel(records, punish, total) {
    if (records.length <= 1) return 'Без изменений';
    const parts = records.map((record) => record.time ?? 0).join(' + ');
    return `${records.length} записи ${punish} объединены: ${parts} = ${total}`;
  }

  function groupSpeedlimitsBySpeed(records) {
    const map = new Map();
    for (const record of records) {
      if (!map.has(record.speed)) map.set(record.speed, []);
      map.get(record.speed).push(record);
    }
    return [...map.entries()].map(([speed, groupedRecords]) => ({ speed, records: groupedRecords }));
  }

  function evaluateGroup(group) {
    const outputs = [];

    for (const punish of TIMED_STACKABLE) {
      const records = group.records.filter((record) => record.punish === punish);
      if (!records.length) continue;
      const total = records.reduce((sum, record) => sum + (Number(record.time) || 0), 0);
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
      const records = group.records.filter((record) => record.punish === punish);
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

    const speedlimitRecords = group.records.filter((record) => record.punish === 'speedlimit');
    for (const speedGroup of groupSpeedlimitsBySpeed(speedlimitRecords)) {
      const total = speedGroup.records.reduce((sum, record) => sum + (Number(record.time) || 0), 0);
      const changed = speedGroup.records.length > 1;
      const parts = speedGroup.records.map((record) => record.time).join(' + ');
      outputs.push({
        punish: 'speedlimit',
        speed: speedGroup.speed,
        time: total,
        changed,
        reason: changed
          ? `${speedGroup.records.length} speedlimit ${speedGroup.speed} км/ч объединены: ${parts} = ${total} мин.`
          : `Ограничение ${speedGroup.speed} км/ч на ${total} мин.`,
        sourceRecords: speedGroup.records
      });
    }

    return { group, outputs };
  }

  function namesForItem(item) {
    return [...new Set(item.sourceRecords.map((record) => record.name).filter(Boolean))];
  }

  function commandFor(item, group) {
    const names = namesForItem(item);
    const plural = names.length === 1 ? 'Жалоба' : 'Жалобы';
    const namesText = names.join(', ');

    if (item.punish === 'warn') return `/warn ${group.id} ${plural} ${namesText}`;
    if (item.punish === 'gunban') return `/gunban ${group.id} бесконечно ${plural} ${namesText}`;
    if (item.punish === 'speedlimit') return `/speedlimit ${group.id} ${item.speed} ${item.time} ${plural} ${namesText}`;
    return `/${item.punish} ${group.id} ${item.time ?? ''} ${plural} ${namesText}`.replace(/\s+/g, ' ').trim();
  }

  function process() {
    const input = $('#input').value;
    const parsed = parseInput(input);
    renderMessages(parsed);

    if (!parsed.records.length) {
      lastOutput = [];
      renderResults([]);
      updateProcessStats(parsed.records, [], []);
      $('#resultSummary').textContent = input.trim() ? 'Не удалось сформировать команды' : 'Команд пока нет';
      $('#copyResult').disabled = true;
      return;
    }

    const groups = groupById(parsed.records);
    const evaluated = groups.map(evaluateGroup);
    const flat = [];

    for (const evaluatedGroup of evaluated) {
      for (const output of evaluatedGroup.outputs) {
        flat.push({
          ...output,
          group: evaluatedGroup.group,
          command: commandFor(output, evaluatedGroup.group)
        });
      }
    }

    const order = { ban: 0, hardban: 1, gunban: 2, warn: 3, speedlimit: 4, ajail: 5, mute: 6 };
    flat.sort((a, b) => (order[a.punish] ?? 99) - (order[b.punish] ?? 99) || (Number(b.time) || 0) - (Number(a.time) || 0));

    lastOutput = flat;
    renderResults(flat);
    updateProcessStats(parsed.records, groups, flat);
    $('#resultSummary').textContent = `${parsed.records.length} записей → ${groups.length} ID → ${flat.length} команд`;
    $('#copyResult').disabled = !flat.length;
  }

  function renderMessages(parsed) {
    const box = $('#messages');
    const chunks = [];
    if (parsed.errors.length) {
      chunks.push(`<div class="message error">${parsed.errors.map(escapeHtml).join('<br>')}</div>`);
    }
    if (parsed.invalidLines.length) {
      chunks.push(`<div class="message warn">Не распознано строк: ${parsed.invalidLines.length} · ${parsed.invalidLines.slice(0, 12).join(', ')}${parsed.invalidLines.length > 12 ? '…' : ''}</div>`);
    }
    box.innerHTML = chunks.join('');
  }

  function renderResults(items) {
    const root = $('#results');

    if (!items.length) {
      root.className = 'results empty-state';
      root.innerHTML = `<div><svg class="empty-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg><strong>Здесь появятся готовые команды</strong><span>Вставьте список наказаний слева.</span></div>`;
      return;
    }

    root.className = 'results';
    root.innerHTML = items.map((item) => {
      const sources = item.sourceRecords.map((record) => {
        const speed = record.punish === 'speedlimit' ? ` · ${record.speed} км/ч` : '';
        const time = record.time !== null ? ` · ${record.time}` : '';
        return `<li>стр. ${record.line}: ${escapeHtml(record.punish)}${speed}${time} · ${escapeHtml(record.name)}</li>`;
      }).join('');

      return `<details class="result-row">
        <summary>
          <span class="result-id">ID ${escapeHtml(item.group.id)}</span>
          <span class="result-command" title="${escapeHtml(item.command)}">${escapeHtml(item.command)}</span>
          <span class="result-badges"><span class="badge">${escapeHtml(item.punish)}</span>${item.changed ? '<span class="badge changed">stack</span>' : ''}</span>
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

  function mergedCount(groups) {
    let total = 0;
    for (const group of groups) {
      for (const punish of [...TIMED_STACKABLE, ...SINGLE_COMMAND]) {
        const count = group.records.filter((record) => record.punish === punish).length;
        total += Math.max(0, count - 1);
      }

      const speedlimitRecords = group.records.filter((record) => record.punish === 'speedlimit');
      for (const speedGroup of groupSpeedlimitsBySpeed(speedlimitRecords)) {
        total += Math.max(0, speedGroup.records.length - 1);
      }
    }
    return total;
  }

  function updateProcessStats(records, groups, commands) {
    $('#statRecords').textContent = records.length;
    $('#statPlayers').textContent = groups.length;
    $('#statMerged').textContent = mergedCount(groups);
    $('#statCommands').textContent = commands.length;
  }

  function updateInputStats() {
    const text = $('#input').value;
    const parsed = parseInput(text);
    $('#inputStats').textContent = `${parsed.lineCount} строк · ${parsed.records.length} записей`;
  }

  function scheduleAutoProcess() {
    clearTimeout(autoTimer);
    updateInputStats();

    const indicator = $('#autoIndicator');
    indicator.classList.add('busy');
    indicator.innerHTML = '<span class="status-dot"></span>Ожидание';

    autoTimer = setTimeout(() => {
      process();
      indicator.classList.remove('busy');
      indicator.innerHTML = '<span class="status-dot"></span>Авто';
    }, 280);
  }

  async function copyText(text) {
    if (!text) return;
    let ok = false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand('copy');
        textarea.remove();
      }
    } catch {
      ok = false;
    }

    toast(ok ? 'Скопировано для выдачи' : 'Не удалось скопировать', !ok);
  }

  $('#input').addEventListener('input', scheduleAutoProcess);

  $('#clearInput').addEventListener('click', () => {
    $('#input').value = '';
    lastOutput = [];
    updateInputStats();
    renderMessages({ errors: [], invalidLines: [] });
    renderResults([]);
    updateProcessStats([], [], []);
    $('#resultSummary').textContent = 'Команд пока нет';
    $('#copyResult').disabled = true;
    toast('Поле очищено');
  });

  $('#copyInput').addEventListener('click', () => copyText($('#input').value));
  $('#copyResult').addEventListener('click', () => copyText(lastOutput.map((item) => item.command).join('\n')));

  $('#loadDemo').addEventListener('click', () => {
    $('#input').value = demoData;
    updateInputStats();
    process();
    toast('Пример загружен');
  });

  updateInputStats();
  updateProcessStats([], [], []);
  history.replaceState(null, '', '#stacker');
})();