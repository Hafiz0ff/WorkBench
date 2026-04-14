const app = document.getElementById('app');

const state = {
  loading: true,
  live: false,
  activeSection: location.hash.replace('#', '') || 'overview',
  project: null,
  memory: null,
  tasks: [],
  patch: null,
  patchHistory: [],
  testsHistory: [],
  stats: null,
  hooks: [],
  hookHistory: [],
  providers: [],
  roles: [],
  workspaces: [],
  taskDetail: null,
  selectedTaskId: null,
  selectedTestRunId: null,
  selectedWorkspaceId: null,
  selectedProviderName: null,
  selectedRoleName: null,
  currentWorkspace: null,
  error: null,
  statusMessage: '',
};

const sectionMeta = {
  overview: { label: 'Обзор', icon: '⌂', subtitle: 'проект и состояние' },
  tasks: { label: 'Задачи', icon: '☰', subtitle: 'история и план' },
  patches: { label: 'Патчи', icon: '≡', subtitle: 'pending diff' },
  tests: { label: 'Тесты', icon: '✓', subtitle: 'прогоны и логи' },
  stats: { label: 'Статистика', icon: '✦', subtitle: 'аналитика использования' },
  hooks: { label: 'Хуки', icon: '⚑', subtitle: 'уведомления и алерты' },
  memory: { label: 'Память', icon: '◫', subtitle: 'project context' },
  providers: { label: 'Провайдеры', icon: '◌', subtitle: 'LLM routing' },
  roles: { label: 'Роли', icon: '◎', subtitle: 'profiles' },
  workspaces: { label: 'Воркспейсы', icon: '▣', subtitle: 'global registry' },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status) {
  const map = {
    draft: 'черновик',
    planned: 'спланирована',
    in_progress: 'в работе',
    blocked: 'заблокирована',
    done: 'выполнена',
    archived: 'архивирована',
    pending: 'ожидает',
    applied: 'применён',
    rejected: 'отклонён',
    conflict: 'конфликт',
    passed: 'passed',
    failed: 'failed',
    error: 'error',
    timeout: 'timeout',
    skipped: 'skipped',
  };
  return map[status] || status || '—';
}

function classForStatus(status) {
  if (['done', 'applied', 'passed'].includes(status)) return 'ok';
  if (['blocked', 'failed', 'error', 'timeout', 'rejected', 'conflict'].includes(status)) return 'danger';
  if (['planned', 'draft', 'skipped'].includes(status)) return 'warn';
  return '';
}

function renderInline(text) {
  const source = escapeHtml(text);
  return source
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(input) {
  const lines = String(input || '').replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let listType = null;
  let inCode = false;
  let codeBuffer = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };

  const flushCode = () => {
    output.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    codeBuffer = [];
    inCode = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      const level = trimmed.match(/^#+/)[0].length;
      output.push(`<h${level}>${renderInline(trimmed.replace(/^#{1,3}\s+/, ''))}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      output.push('<hr />');
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+/);
    const ordered = trimmed.match(/^\d+\.\s+/);
    if (unordered || ordered) {
      flushParagraph();
      if (!listType) {
        listType = unordered ? 'ul' : 'ol';
        output.push(`<${listType}>`);
      }
      output.push(`<li>${renderInline(trimmed.replace(/^([-*]|\d+\.)\s+/, ''))}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) {
    flushCode();
  }
  flushParagraph();
  flushList();

  return output.join('\n');
}

function renderDiff(diffText) {
  const lines = String(diffText || '').replaceAll('\r\n', '\n').split('\n');
  return lines.map((line, index) => {
    const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : line.startsWith('@@') ? 'hunk' : 'context';
    return `
      <div class="diff-line ${cls}">
        <div class="line-no">${index + 1}</div>
        <div class="content">${escapeHtml(line)}</div>
      </div>
    `;
  }).join('');
}

function renderSparkline(runs) {
  if (!runs.length) {
    return '<div class="sparkline"></div>';
  }
  return `<div class="sparkline">${
    runs.slice(-20).map((run) => {
      const cls = run.status === 'passed' ? 'pass' : run.status === 'skipped' ? 'skip' : 'fail';
      const height = run.status === 'passed' ? 16 : run.status === 'skipped' ? 10 : 24;
      return `<span class="${cls}" style="height:${height}px" title="${escapeHtml(run.runId)}"></span>`;
    }).join('')
  }</div>`;
}

function renderBarChart(data, options = {}) {
  const items = Array.isArray(data) ? data : [];
  const width = Number(options.width) || 640;
  const height = Number(options.height) || 180;
  const maxBars = Number.isFinite(Number(options.maxBars)) ? Math.max(1, Number(options.maxBars)) : 14;
  const color = options.color || 'var(--accent)';
  const slice = items.slice(-maxBars);
  const maxValue = Math.max(1, ...slice.map((item) => Number(item.count) || 0));
  const barWidth = slice.length ? width / slice.length : width;
  const bars = slice.map((item, index) => {
    const value = Number(item.count) || 0;
    const barHeight = Math.max(2, Math.round((value / maxValue) * (height - 28)));
    const x = Math.round(index * barWidth);
    const y = height - barHeight - 20;
    return `
      <g>
        <rect x="${x + 6}" y="${y}" width="${Math.max(4, barWidth - 12)}" height="${barHeight}" rx="6" fill="${color}"></rect>
        <title>${escapeHtml(`${item.date || ''}: ${value}`)}</title>
        <text x="${x + (barWidth / 2)}" y="${height - 6}" text-anchor="middle">${escapeHtml(String(item.date || '').slice(-5))}</text>
      </g>
    `;
  }).join('');
  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="${height}">
      <line x1="0" y1="${height - 20}" x2="${width}" y2="${height - 20}" stroke="var(--line-strong)" />
      ${bars}
    </svg>
  `;
}

function renderLineChart(data, options = {}) {
  const items = Array.isArray(data) ? data : [];
  const width = Number(options.width) || 640;
  const height = Number(options.height) || 180;
  const color = options.color || 'var(--accent)';
  const fill = options.fill || 'rgba(79, 152, 163, 0.12)';
  const slice = items.slice(-14);
  const maxValue = Math.max(1, ...slice.map((item) => Number(item.count ?? item.value) || 0));
  const stepX = slice.length > 1 ? width / (slice.length - 1) : width;
  const points = slice.map((item, index) => {
    const value = Number(item.count ?? item.value) || 0;
    const x = Math.round(index * stepX);
    const y = Math.round(height - 24 - ((value / maxValue) * (height - 40)));
    return { x, y, value, item };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = points.length
    ? `${line} L ${points[points.length - 1].x} ${height - 18} L ${points[0].x} ${height - 18} Z`
    : '';
  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="${height}">
      <path d="${area}" fill="${fill}"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
      ${points.map((point, index) => `
        <g>
          <circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}"></circle>
          <title>${escapeHtml(`${point.item.date || ''}: ${point.value}`)}</title>
          ${index === 0 || index === points.length - 1 ? `<text x="${point.x}" y="${height - 4}" text-anchor="${index === 0 ? 'start' : 'end'}">${escapeHtml(String(point.item.date || '').slice(-5))}</text>` : ''}
        </g>
      `).join('')}
    </svg>
  `;
}

function renderProgressBar(value, max, options = {}) {
  const safeMax = Number(max) > 0 ? Number(max) : 1;
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0));
  const percent = (safeValue / safeMax) * 100;
  const label = options.label || '';
  return `
    <div class="progress-row">
      <div class="progress-label">${escapeHtml(label)}</div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${percent}%; background:${options.color || 'var(--accent)'}"></div>
      </div>
      <div class="progress-value">${escapeHtml(options.showPercent === false ? String(safeValue) : `${percent.toFixed(0)}%`)}</div>
    </div>
  `;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' ? body.message || body.error || response.statusText : response.statusText;
    throw new Error(message || response.statusText);
  }
  return body;
}

async function apiGet(path) {
  return request(path, { method: 'GET' });
}

async function apiPost(path, body = {}) {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function sectionClass(name) {
  return state.activeSection === name ? 'nav-item active' : 'nav-item';
}

function navMarkup() {
  const counts = {
    overview: 1,
    tasks: state.tasks.length,
    patches: state.patchHistory.length,
    tests: state.testsHistory.length,
    stats: state.stats ? 1 : 0,
    hooks: state.hooks.length,
    memory: state.memory?.summaries?.length || 0,
    providers: state.providers.length,
    roles: state.roles.length,
    workspaces: state.workspaces.length,
  };
  return Object.entries(sectionMeta).map(([name, meta]) => `
    <button class="${sectionClass(name)}" data-action="section" data-section="${name}">
      <span class="nav-icon">${meta.icon}</span>
      <span class="nav-copy">
        <span class="nav-title">${meta.label}</span>
        <span class="nav-subtitle">${meta.subtitle}</span>
      </span>
      <span class="nav-badge">${counts[name] ?? 0}</span>
    </button>
  `).join('');
}

function headerMarkup() {
  const provider = state.project?.provider || '—';
  const model = state.project?.model || '—';
  const currentTask = state.project?.task?.title || state.project?.currentTaskId || '—';
  const currentWorkspace = state.currentWorkspace?.alias || state.project?.name || '—';
  return `
    <header class="header">
      <div class="header-title">
        <div class="app-title">Workbench</div>
        <div class="project-title">${escapeHtml(state.project?.name || 'Локальный дашборд')}</div>
      </div>
      <div class="header-meta">
        <span class="pill muted">${escapeHtml(provider)} / ${escapeHtml(model)}</span>
        <span class="pill muted">Воркспейс: ${escapeHtml(currentWorkspace)}</span>
        <span class="pill muted">Задача: ${escapeHtml(currentTask)}</span>
        <span class="badge ${state.live ? 'ok' : 'danger'}">${state.live ? '● SSE' : '○ offline'}</span>
      </div>
    </header>
  `;
}

function metricCard(label, value, sub = '') {
  const hasValue = value !== null && value !== undefined && value !== '';
  return `
    <div class="card compact">
      <div class="metric">
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${hasValue ? escapeHtml(value) : '—'}</div>
        ${sub ? `<div class="metric-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>
  `;
}

function sectionWrapper(title, subtitle, actions = '', content = '') {
  return `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h1 class="panel-title">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="panel-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div class="actions">${actions}</div>
      </div>
      ${content}
    </div>
  `;
}

function buttonMarkup(label, action, attrs = '', variant = '') {
  return `<button class="button ${variant}" data-action="${action}" ${attrs}>${label}</button>`;
}

function emptyState(title, text, action = '') {
  return `
    <div class="card">
      <div class="empty-state">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        ${action}
      </div>
    </div>
  `;
}

function renderOverview() {
  const cards = [
    ['Проект', state.project?.name || '—', state.project?.root || ''],
    ['Провайдер', state.project?.provider || '—', state.project?.model || ''],
    ['Активная роль', state.project?.role || 'не задана', state.selectedRoleName || ''],
    ['Текущая задача', state.project?.task?.title || 'не задана', state.project?.currentTaskId || ''],
  ];
  return sectionWrapper(
    'Обзор',
    'Быстрый срез состояния проекта, задач, провайдеров и тестов.',
    [
      buttonMarkup('Обновить память', 'refresh-memory', '', ''),
      buttonMarkup('Обновить всё', 'refresh-all', '', 'primary'),
    ].join(''),
    `
      <div class="grid cards">
        ${cards.map(([label, value, sub]) => metricCard(label, value, sub)).join('')}
      </div>
      <div class="grid two-up">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Состояние проекта</h2></div>
          <div class="card-body markdown">
            ${renderMarkdown(state.memory?.overview || 'Память проекта пока не загружена.')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2 class="card-title">Последние тесты</h2></div>
          <div class="card-body">
            ${renderSparkline(state.testsHistory)}
            <div class="list" style="margin-top: 14px;">
              ${(state.testsHistory.slice(0, 5).map((run) => `
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">${escapeHtml(run.runId)}</div>
                    <div class="list-subtitle">${escapeHtml(formatDate(run.startedAt))} · ${escapeHtml(run.command || '—')}</div>
                  </div>
                  <div class="list-meta">
                    <span class="tiny-badge ${classForStatus(run.status)}">${escapeHtml(statusLabel(run.status))}</span>
                  </div>
                </div>
              `).join('') || `<div class="footer-note">Тестов пока нет.</div>`)}
            </div>
          </div>
        </div>
      </div>
    `,
  );
}

function renderTasks() {
  const tasks = state.tasks;
  const task = state.taskDetail?.task || tasks.find((item) => item.id === state.selectedTaskId) || null;
  return sectionWrapper(
    'Задачи',
    'История, план и разговор по каждой задаче доступны без лишней навигации.',
    [
      buttonMarkup('Использовать текущую', 'use-current-task', '', ''),
      buttonMarkup('Обновить список', 'refresh-all', '', 'primary'),
    ].join(''),
    `
      <div class="grid split">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Список задач</h2></div>
          <div class="card-body">
            ${tasks.length ? `
              <div class="list">
                ${tasks.map((item) => `
                  <button class="list-item ${item.id === state.selectedTaskId ? 'selected' : ''}" data-action="select-task" data-task-id="${escapeHtml(item.id)}">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(item.title)}</div>
                      <div class="list-subtitle">${escapeHtml(item.id)} · ${escapeHtml(formatDate(item.updatedAt))}</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge ${classForStatus(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
                      <span class="tiny-badge">${escapeHtml(item.role || 'роль не задана')}</span>
                    </div>
                  </button>
                `).join('')}
              </div>
            ` : emptyState('Задачи пока не созданы', 'Откройте проект, создайте первую задачу или начните работу через composer.')}
          </div>
        </div>
        <div class="section-stack">
          ${task ? `
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">${escapeHtml(task.title)}</h2>
                <div class="actions">
                  <button class="button" data-action="use-task" data-task-id="${escapeHtml(task.id)}">Использовать</button>
                </div>
              </div>
              <div class="card-body">
                <div class="grid two-up">
                  ${metricCard('Статус', statusLabel(task.status), task.id)}
                  ${metricCard('Роль / модель', `${task.role || '—'} / ${task.model || '—'}`)}
                </div>
                <div class="card compact" style="margin-top: 12px;">
                  <div class="metric">
                    <div class="metric-label">План</div>
                    <div class="markdown">${renderMarkdown(state.taskDetail?.plan || 'План пока не подготовлен.')}</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid two-up">
              <div class="card">
                <div class="card-header"><h2 class="card-title">История диалога</h2></div>
                <div class="card-body">
                  ${state.taskDetail?.history?.length ? `
                    <div class="message-list">
                      ${state.taskDetail.history.map(renderMessage).join('')}
                    </div>
                  ` : emptyState('История пуста', 'Пока нет сообщений для этой задачи.')}
                </div>
              </div>
              <div class="card">
                <div class="card-header"><h2 class="card-title">Auto runs</h2></div>
                <div class="card-body">
                  ${state.taskDetail?.runs?.length ? `
                    <div class="list">
                      ${state.taskDetail.runs.map((run) => `
                        <button class="list-item ${run.runId === state.selectedRunId ? 'selected' : ''}" data-action="select-run" data-run-id="${escapeHtml(run.runId)}">
                          <div class="list-main">
                            <div class="list-title">${escapeHtml(run.runId)}</div>
                            <div class="list-subtitle">${escapeHtml(formatDate(run.startedAt))} · ${escapeHtml(run.request || '')}</div>
                          </div>
                          <div class="list-meta">
                            <span class="tiny-badge ${classForStatus(run.status)}">${escapeHtml(statusLabel(run.status))}</span>
                          </div>
                        </button>
                      `).join('')}
                    </div>
                  ` : emptyState('Auto runs отсутствуют', 'После запуска auto режима здесь появятся итерации и шаги.')}
                </div>
              </div>
            </div>
          ` : emptyState('Выберите задачу', 'Задача будет показана здесь, когда вы кликнете по ней в списке.')}
        </div>
      </div>
    `,
  );
}

function renderMessage(message) {
  return `
    <div class="message ${escapeHtml(message.role || 'user')}">
      <div class="message-head">
        <span class="message-role">${message.role === 'assistant' ? '🤖' : message.role === 'system' ? '🛠' : '👤'}</span>
        <span>${escapeHtml(message.role || 'user')}</span>
        <span>${escapeHtml(formatDate(message.timestamp))}</span>
        ${message.provider ? `<span class="tiny-badge">${escapeHtml(message.provider)}</span>` : ''}
        ${message.model ? `<span class="tiny-badge">${escapeHtml(message.model)}</span>` : ''}
        ${message.sessionId ? `<span class="tiny-badge">${escapeHtml(message.sessionId)}</span>` : ''}
      </div>
      <div class="message-content">${escapeHtml(message.content || '')}</div>
    </div>
  `;
}

function renderPatches() {
  const pending = state.patch;
  return sectionWrapper(
    'Патчи',
    'Ожидающий diff можно применить или отклонить без перехода в терминал.',
    [
      buttonMarkup('Применить', 'apply-patch', '', 'primary'),
      buttonMarkup('Отклонить', 'reject-patch', '', 'danger'),
    ].join(''),
    `
      <div class="grid split">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Pending patch</h2></div>
          <div class="card-body">
            ${pending ? `
              <div class="grid two-up">
                ${metricCard('Статус', statusLabel(pending.status), pending.approvalStatus || '')}
                ${metricCard('Проверка', pending.validationStatus || '—', pending.summary || '')}
              </div>
              <div style="margin-top: 14px;" class="diff">${renderDiff(pending.diffText || '')}</div>
            ` : emptyState('Pending patch отсутствует', 'Сейчас изменений, ожидающих применения, нет.')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2 class="card-title">История патчей</h2></div>
          <div class="card-body">
            ${state.patchHistory.length ? `
              <div class="list">
                ${state.patchHistory.map((item) => `
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(item.patchId || 'patch')}</div>
                      <div class="list-subtitle">${escapeHtml(item.taskId || '—')} · ${escapeHtml(formatDate(item.updatedAt || item.appliedAt || item.createdAt))}</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge ${classForStatus(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : emptyState('История пуста', 'Применённые и отклонённые патчи появятся здесь.')}
          </div>
        </div>
      </div>
    `,
  );
}

function renderTests() {
  const currentRun = state.selectedTestRunId ? state.testsHistory.find((run) => run.runId === state.selectedTestRunId) : state.testsHistory[0];
  return sectionWrapper(
    'Тесты',
    'Последние прогоны, полный лог и быстрый запуск тест-раннера.',
    [
      buttonMarkup('Запустить тесты', 'run-tests', '', 'primary'),
    ].join(''),
    `
      <div class="grid split">
        <div class="card">
          <div class="card-header"><h2 class="card-title">История прогонов</h2></div>
          <div class="card-body">
            ${state.testsHistory.length ? `
              <div class="list">
                ${state.testsHistory.map((run) => `
                  <button class="list-item ${run.runId === state.selectedTestRunId ? 'selected' : ''}" data-action="select-test-run" data-run-id="${escapeHtml(run.runId)}">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(run.runId)}</div>
                      <div class="list-subtitle">${escapeHtml(formatDate(run.startedAt))} · ${escapeHtml(run.command || '—')}</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge ${classForStatus(run.status)}">${escapeHtml(statusLabel(run.status))}</span>
                    </div>
                  </button>
                `).join('')}
              </div>
              <div style="margin-top: 12px;">${renderSparkline(state.testsHistory)}</div>
            ` : emptyState('История тестов пуста', 'После запуска тестов здесь появятся прогоны и логи.')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2 class="card-title">Лог прогона</h2></div>
          <div class="card-body markdown">
            ${currentRun ? `
              <div class="grid two-up">
                ${metricCard('Статус', statusLabel(currentRun.status), currentRun.command || '')}
                ${metricCard('Время', Number.isFinite(currentRun.duration) ? `${(currentRun.duration / 1000).toFixed(1)}s` : '—', currentRun.runner || '')}
              </div>
              <div style="margin-top: 14px;" class="card compact">
                <div class="card-body"><pre class="markdown" style="white-space: pre-wrap; margin: 0;">${escapeHtml(state.selectedTestRunLog || '')}</pre></div>
              </div>
            ` : emptyState('Выберите прогон', 'Кликните по строке слева, чтобы увидеть полный лог.')}
          </div>
        </div>
      </div>
    `,
  );
}

function renderStats() {
  const stats = state.stats;
  const topFiles = Array.isArray(stats?.tasks?.topFiles) ? stats.tasks.topFiles : [];
  const providerUsage = Array.isArray(stats?.providers?.usage) ? stats.providers.usage : [];
  const providerTotal = providerUsage.reduce((sum, entry) => sum + (Number(entry.requests) || 0), 0) || 1;
  const doneRate = stats?.tasks?.total ? Math.round(((stats?.tasks?.byStatus?.done || 0) / stats.tasks.total) * 100) : 0;
  const acceptRate = Math.round((stats?.patches?.acceptRate || 0) * 100);
  const passRate = Math.round((stats?.tests?.passRate || 0) * 100);
  const autoRate = stats?.autoRuns?.total ? Math.round(((stats?.autoRuns?.completed || 0) / stats.autoRuns.total) * 100) : 0;

  return sectionWrapper(
    'Статистика',
    'Локальная аналитика по задачам, патчам, тестам, авто-рунам, провайдерам и ролям.',
    buttonMarkup('Обновить статистику', 'refresh-stats', '', 'primary'),
    `
      <div class="grid cards">
        ${[
          ['Задачи', stats?.tasks?.total || 0, `${doneRate}% done`],
          ['Патчи', stats?.patches?.total || 0, `${acceptRate}% accept`],
          ['Тесты', stats?.tests?.total || 0, `${passRate}% pass`],
          ['Auto runs', stats?.autoRuns?.total || 0, `${autoRate}% success`],
        ].map(([label, value, sub]) => metricCard(label, value, sub)).join('')}
      </div>
      <div class="grid two-up">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Патчи по дням</h2></div>
          <div class="card-body">
            ${renderBarChart(stats?.patches?.appliedByDay || [], { color: 'var(--accent)' })}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2 class="card-title">Тесты по дням</h2></div>
          <div class="card-body">
            ${renderLineChart(stats?.tests?.runsByDay || [], { color: 'var(--ok)', fill: 'rgba(57, 201, 138, 0.12)' })}
          </div>
        </div>
      </div>
      <div class="grid two-up">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Провайдеры</h2></div>
          <div class="card-body">
            <div class="section-stack">
              ${providerUsage.length ? providerUsage.map((entry) => renderProgressBar(entry.requests || 0, providerTotal, {
                label: `${entry.provider}/${entry.model}`,
                color: 'var(--accent)',
                showPercent: true,
              })).join('') : emptyState('Пока нет данных', 'Запускайте агентные сессии и тесты, чтобы собрать статистику.')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2 class="card-title">Топ файлов</h2></div>
          <div class="card-body">
            ${topFiles.length ? `
              <div class="list">
                ${topFiles.map((file, index) => `
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${index + 1}. ${escapeHtml(file.path)}</div>
                      <div class="list-subtitle">Изменено в ${escapeHtml(String(file.taskCount || 0))} задачах</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge">${escapeHtml(String(file.taskCount || 0))}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : emptyState('Нет данных по файлам', 'После работы с проектом здесь появятся самые активные файлы.')}
          </div>
        </div>
      </div>
    `,
  );
}

function renderMemory() {
  const entries = [
    ['Обзор проекта', state.memory?.overview],
    ['Архитектура', state.memory?.architecture],
    ['Решения', state.memory?.decisions],
  ];
  return sectionWrapper(
    'Память',
    'Markdown-обзор ключевых файлов памяти проекта.',
    buttonMarkup('Обновить память', 'refresh-memory', '', 'primary'),
    `
      <div class="section-stack">
        ${entries.map(([title, body]) => `
          <div class="card">
            <div class="card-header"><h2 class="card-title">${escapeHtml(title)}</h2></div>
            <div class="card-body markdown">
              ${renderMarkdown(body || 'Раздел пуст.')}
            </div>
          </div>
        `).join('')}
      </div>
    `,
  );
}

function renderProviders() {
  const activeProvider = state.providers.find((provider) => provider.selected)
    || state.providers[0]
    || null;
  const activeModels = activeProvider?.models || [];
  return sectionWrapper(
    'Провайдеры',
    'Переключение между Ollama, OpenAI, Anthropic и Gemini без редактирования файлов вручную.',
    buttonMarkup('Проверить health', 'refresh-all', '', 'primary'),
    `
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><h2 class="card-title">Активный провайдер</h2></div>
        <div class="card-body">
          <div class="grid two-up">
            <label class="field">
              <span class="field-label">Провайдер</span>
              <select data-action="set-active-provider">
                ${state.providers.map((provider) => `
                  <option value="${escapeHtml(provider.name)}" ${provider.selected ? 'selected' : ''}>
                    ${escapeHtml(provider.name)}${provider.fallback ? ' · fallback' : ''}${provider.enabled ? '' : ' · disabled'}
                  </option>
                `).join('')}
              </select>
            </label>
            <label class="field">
              <span class="field-label">Модель</span>
              <select data-action="set-provider-model" data-provider="${escapeHtml(activeProvider?.name || '')}">
                ${(activeModels.length ? activeModels : [{ id: activeProvider?.model || activeProvider?.defaultModel || '—', name: activeProvider?.model || activeProvider?.defaultModel || '—' }]).map((model) => {
                  const id = model?.id || model;
                  const label = model?.name && model?.name !== id ? `${id} — ${model.name}` : id;
                  const selected = id === (activeProvider?.model || activeProvider?.defaultModel);
                  return `<option value="${escapeHtml(id)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                }).join('')}
              </select>
            </label>
          </div>
        </div>
      </div>
      <div class="grid two-up">
        ${state.providers.map((provider) => `
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">${escapeHtml(provider.name)}</h2>
              <div class="actions">
                <button class="button ${provider.selected ? 'primary' : ''}" data-action="use-provider" data-provider="${escapeHtml(provider.name)}">Использовать</button>
              </div>
            </div>
            <div class="card-body">
              <div class="list">
                ${[
                  ['Статус', provider.enabled ? 'активен' : 'выключен'],
                  ['Модель', provider.model || provider.defaultModel || '—'],
                  ['Base URL', provider.baseUrl || '—'],
                  ['Health', provider.health?.error || provider.health?.message || (provider.health?.ok ? 'available' : '—')],
                ].map(([label, value]) => `
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(label)}</div>
                      <div class="list-subtitle">${escapeHtml(value)}</div>
                    </div>
                    <div class="list-meta">
                      ${provider.selected ? '<span class="tiny-badge status-ok">active</span>' : ''}
                      ${provider.fallback ? '<span class="tiny-badge">fallback</span>' : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `,
  );
}

function renderHooks() {
  const selectedHook = state.hooks.find((hook) => hook.id === state.selectedHookId) || state.hooks[0] || null;
  return sectionWrapper(
    'Хуки',
    'Event hooks для Telegram, shell-команд и HTTP webhook без показа секретов.',
    buttonMarkup('Обновить хуки', 'refresh-hooks', '', 'primary'),
    `
      <div class="grid split">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Список хуков</h2></div>
          <div class="card-body">
            ${state.hooks.length ? `
              <div class="list">
                ${state.hooks.map((hook) => `
                  <button class="list-item ${hook.id === selectedHook?.id ? 'selected' : ''}" data-action="select-hook" data-hook-id="${escapeHtml(hook.id)}">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(hook.name || hook.id)}</div>
                      <div class="list-subtitle">${escapeHtml(hook.channel)} · ${escapeHtml((hook.on || []).join(', '))}${hook.conditions ? ` · ${escapeHtml(hook.conditions)}` : ''}</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge ${hook.enabled ? 'ok' : 'warn'}">${hook.enabled ? 'вкл' : 'выкл'}</span>
                    </div>
                  </button>
                `).join('')}
              </div>
            ` : emptyState('Хуки не настроены', 'Добавьте правила через `app hooks add` или настройте Telegram через CLI.')}
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${escapeHtml(selectedHook?.name || 'Выберите хук')}</h2>
            <div class="actions">
              ${selectedHook ? `
                <button class="button" data-action="${selectedHook.enabled ? 'disable-hook' : 'enable-hook'}" data-hook-id="${escapeHtml(selectedHook.id)}">${selectedHook.enabled ? 'Выключить' : 'Включить'}</button>
                <button class="button primary" data-action="test-hook" data-hook-id="${escapeHtml(selectedHook.id)}">Тест</button>
              ` : ''}
            </div>
          </div>
          <div class="card-body">
            ${selectedHook ? `
              <div class="grid two-up">
                ${metricCard('Канал', selectedHook.channel || '—', selectedHook.enabled ? 'активен' : 'выключен')}
                ${metricCard('События', (selectedHook.on || []).join(', ') || '—', selectedHook.conditions || 'без фильтров')}
              </div>
              <div class="card compact" style="margin-top: 12px;">
                <div class="metric">
                  <div class="metric-label">Сообщение</div>
                  <div class="metric-sub" style="white-space: pre-wrap;">${escapeHtml(selectedHook.message || '—')}</div>
                </div>
              </div>
              <div class="card compact" style="margin-top: 12px;">
                <div class="metric">
                  <div class="metric-label">Telegram</div>
                  <div class="metric-value">${selectedHook.telegramConfigured ? 'настроен' : 'не настроен'}</div>
                  <div class="metric-sub">Токен не показывается в UI</div>
                </div>
              </div>
            ` : emptyState('Выберите хук', 'Тут появятся настройки, тест и последние диспатчи.')}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top: 16px;">
        <div class="card-header"><h2 class="card-title">История диспатчей</h2></div>
        <div class="card-body">
          ${state.hookHistory.length ? `
            <div class="list">
              ${state.hookHistory.map((entry) => `
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">${escapeHtml(formatDate(entry.ts))} · ${escapeHtml(entry.hookId)}</div>
                    <div class="list-subtitle">${escapeHtml(entry.channel)} · ${escapeHtml(entry.event)}${entry.error ? ` · ${escapeHtml(entry.error)}` : ''}</div>
                  </div>
                  <div class="list-meta">
                    <span class="tiny-badge ${entry.status === 'sent' ? 'ok' : 'danger'}">${escapeHtml(entry.status)}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : emptyState('История пуста', 'После срабатывания хуков здесь появятся последние диспатчи.')}
        </div>
      </div>
    `,
  );
}

function renderRoles() {
  return sectionWrapper(
    'Роли',
    'Профили мышления можно активировать сразу из браузера.',
    buttonMarkup('Обновить список', 'refresh-all', '', 'primary'),
    `
      <div class="grid two-up">
        ${state.roles.map((role) => `
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">${escapeHtml(role.name)}</h2>
              <div class="actions">
                <button class="button ${role.name === state.selectedRoleName ? 'primary' : ''}" data-action="use-role" data-role="${escapeHtml(role.name)}">Использовать</button>
              </div>
            </div>
            <div class="card-body">
              <div class="list">
                ${[
                  ['Описание', role.description || '—'],
                  ['Файл', role.filePath || '—'],
                  ['Источник', role.builtin ? 'builtin' : role.sourceExtensionId || '—'],
                ].map(([label, value]) => `
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(label)}</div>
                      <div class="list-subtitle">${escapeHtml(value)}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `,
  );
}

function renderWorkspaces() {
  const workspace = state.workspaces.find((item) => item.id === state.selectedWorkspaceId)
    || state.workspaces.find((item) => item.current)
    || state.workspaces[0]
    || null;
  return sectionWrapper(
    'Воркспейсы',
    'Глобальный реестр проектов с быстрым переключением и snapshot состояния.',
    buttonMarkup('Обновить реестр', 'refresh-workspaces', '', 'primary'),
    `
      <div class="grid split">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Все проекты</h2></div>
          <div class="card-body">
            ${state.workspaces.length ? `
              <div class="list">
                ${state.workspaces.map((item) => `
                  <button class="list-item ${item.id === workspace?.id ? 'selected' : ''}" data-action="select-workspace" data-workspace-id="${escapeHtml(item.id)}">
                    <div class="list-main">
                      <div class="list-title">${escapeHtml(item.alias)}${item.current ? ' · текущий' : ''}${item.pinned ? ' · 📌' : ''}</div>
                      <div class="list-subtitle">${escapeHtml(item.path)}</div>
                    </div>
                    <div class="list-meta">
                      <span class="tiny-badge ${item.available === false ? 'danger' : 'ok'}">${item.available === false ? 'нет доступа' : 'ok'}</span>
                    </div>
                  </button>
                `).join('')}
              </div>
            ` : emptyState('Воркспейсы не найдены', 'Добавьте первый проект через `workbench add` или откройте его из CLI/GUI.')}
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${escapeHtml(workspace?.alias || 'Выберите проект')}</h2>
            <div class="actions">
              ${workspace ? `<button class="button primary" data-action="switch-workspace" data-workspace-id="${escapeHtml(workspace.id)}">Сделать активным</button>` : ''}
            </div>
          </div>
          <div class="card-body">
            ${workspace ? `
              <div class="grid two-up">
                ${metricCard('Имя', workspace.name || workspace.alias, workspace.path)}
                ${metricCard('Статус', workspace.current ? 'текущий' : 'доступен', workspace.available === false ? 'Недоступен' : 'В реестре')}
              </div>
              <div class="grid two-up" style="margin-top: 12px;">
                ${metricCard('Провайдер / модель', `${workspace.snapshot?.provider || '—'} / ${workspace.snapshot?.model || '—'}`)}
                ${metricCard('Роль / задача', `${workspace.snapshot?.role || '—'} / ${workspace.snapshot?.activeTask || '—'}`)}
              </div>
              <div class="card compact" style="margin-top: 12px;">
                <div class="metric">
                  <div class="metric-label">Теги</div>
                  <div class="workspace-tags">${workspace.tags?.length ? workspace.tags.map((tag) => `<span class="tiny-badge">${escapeHtml(tag)}</span>`).join(' ') : '—'}</div>
                  <div class="metric-sub">Обновлено: ${escapeHtml(formatDate(workspace.lastOpenedAt))}</div>
                </div>
              </div>
              <div class="card compact" style="margin-top: 12px;">
                <div class="metric">
                  <div class="metric-label">Snapshot</div>
                  <div class="metric-value">${escapeHtml(workspace.snapshot?.taskCount != null ? String(workspace.snapshot.taskCount) : '0')} задач</div>
                  <div class="metric-sub">Последнее обновление: ${escapeHtml(formatDate(workspace.snapshot?.lastRefreshedAt))}</div>
                </div>
              </div>
            ` : emptyState('Выберите воркспейс', 'Здесь появится кэшированное состояние проекта и быстрый переход.')}
          </div>
        </div>
      </div>
    `,
  );
}

function renderMain() {
  const view = state.activeSection;
  if (state.error) {
    return `
      <div class="panel">
        <div class="card">
          <div class="empty-state">
            <h3>Не удалось загрузить dashboard</h3>
            <p>${escapeHtml(state.error)}</p>
            ${buttonMarkup('Обновить', 'refresh-all', '', 'primary')}
          </div>
        </div>
      </div>
    `;
  }
  switch (view) {
    case 'tasks':
      return renderTasks();
    case 'patches':
      return renderPatches();
    case 'tests':
      return renderTests();
    case 'stats':
      return renderStats();
    case 'memory':
      return renderMemory();
    case 'providers':
      return renderProviders();
    case 'hooks':
      return renderHooks();
    case 'roles':
      return renderRoles();
    case 'workspaces':
      return renderWorkspaces();
    case 'overview':
    default:
      return renderOverview();
  }
}

function shellMarkup() {
  return `
    <div class="dashboard">
      ${headerMarkup()}
      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-label">Рабочая область</div>
          <div class="nav-list">
            ${navMarkup()}
          </div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-label">Live</div>
          <div class="card compact">
            <div class="metric">
              <div class="metric-label">Соединение</div>
              <div class="metric-value">${state.live ? 'SSE подключен' : 'Отключено'}</div>
              <div class="metric-sub">${state.project?.root || '—'}</div>
            </div>
          </div>
        </div>
      </aside>
      <main class="main">
        ${renderMain()}
      </main>
    </div>
    <div id="toast" class="toast ${state.statusMessage ? '' : 'hidden'}">${escapeHtml(state.statusMessage || '')}</div>
  `;
}

function render() {
  app.innerHTML = shellMarkup();
}

async function loadProjectData() {
  const [project, memory, tasks, patch, patchHistory, testsHistory, stats, providers, hooks, hookHistory, roles, workspaces] = await Promise.all([
    apiGet('/api/v1/project/status'),
    apiGet('/api/v1/project/memory'),
    apiGet('/api/v1/tasks'),
    apiGet('/api/v1/patches/pending'),
    apiGet('/api/v1/patches/history?limit=20'),
    apiGet('/api/v1/tests/history?limit=20'),
    apiGet('/api/v1/stats'),
    apiGet('/api/v1/providers'),
    apiGet('/api/v1/hooks'),
    apiGet('/api/v1/hooks/history?limit=10'),
    apiGet('/api/v1/roles'),
    apiGet('/api/v1/workspaces'),
  ]);

  state.project = project;
  state.memory = memory;
  state.tasks = tasks.tasks || [];
  state.patch = patch || null;
  state.patchHistory = patchHistory.patches || [];
  state.testsHistory = testsHistory.runs || [];
  state.stats = stats || null;
  state.providers = providers.providers || [];
  state.hooks = hooks.hooks || [];
  state.hookHistory = hookHistory.history || [];
  state.roles = roles.roles || [];
  state.workspaces = workspaces.workspaces || [];

  if (!state.selectedTaskId) {
    state.selectedTaskId = project.currentTaskId || state.tasks[0]?.id || null;
  }
  state.selectedProviderName = project.provider || null;
  state.selectedRoleName = project.role || null;
  if (!state.selectedWorkspaceId) {
    state.selectedWorkspaceId = state.workspaces.find((item) => item.current)?.id || state.workspaces[0]?.id || null;
  }
  if (!state.selectedTestRunId && state.testsHistory.length) {
    state.selectedTestRunId = state.testsHistory[0].runId;
  }
  if (!state.selectedHookId && state.hooks.length) {
    state.selectedHookId = state.hooks[0].id;
  }
  state.currentWorkspace = state.workspaces.find((item) => item.current) || null;

  if (state.selectedTaskId) {
    await loadTaskDetail(state.selectedTaskId);
  } else {
    state.taskDetail = null;
  }

  if (state.selectedTestRunId) {
    const testLog = await apiGet(`/api/v1/tests/${encodeURIComponent(state.selectedTestRunId)}/log`).catch(() => ({ output: '' }));
    state.selectedTestRunLog = testLog.output || '';
  } else {
    state.selectedTestRunLog = '';
  }

  state.error = null;
  state.loading = false;
}

async function loadTaskDetail(taskId) {
  if (!taskId) {
    state.taskDetail = null;
    return;
  }
  const [taskResponse, historyResponse, runsResponse, planResponse] = await Promise.all([
    apiGet(`/api/v1/tasks/${encodeURIComponent(taskId)}`),
    apiGet(`/api/v1/tasks/${encodeURIComponent(taskId)}/history?limit=20`),
    apiGet(`/api/v1/tasks/${encodeURIComponent(taskId)}/runs`),
    apiGet(`/api/v1/tasks/${encodeURIComponent(taskId)}/plan`),
  ]);
  state.taskDetail = {
    task: taskResponse.task,
    history: historyResponse.messages || [],
    runs: runsResponse.runs || [],
    plan: planResponse.content || '',
  };
}

async function reloadView(message = '') {
  try {
    state.statusMessage = message;
    await loadProjectData();
    render();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  } finally {
    if (message) {
      window.setTimeout(() => {
        state.statusMessage = '';
        render();
      }, 2500);
    }
  }
}

async function handleAction(action, target) {
  switch (action) {
    case 'section':
      state.activeSection = target.dataset.section || 'overview';
      location.hash = state.activeSection;
      render();
      return;
    case 'set-active-provider':
      await apiPost(`/api/v1/providers/${encodeURIComponent(target.value)}/use`);
      state.statusMessage = 'Провайдер переключён.';
      await reloadView();
      return;
    case 'set-provider-model':
      await apiPost(`/api/v1/providers/${encodeURIComponent(target.dataset.provider)}/model`, {
        model: target.value,
      });
      state.statusMessage = 'Модель обновлена.';
      await reloadView();
      return;
    case 'select-task':
      state.selectedTaskId = target.dataset.taskId;
      await loadTaskDetail(state.selectedTaskId);
      render();
      return;
    case 'use-task':
      await apiPost(`/api/v1/tasks/${encodeURIComponent(target.dataset.taskId)}/use`);
      state.statusMessage = 'Задача сделана активной.';
      await reloadView();
      return;
    case 'select-test-run':
      state.selectedTestRunId = target.dataset.runId;
      const log = await apiGet(`/api/v1/tests/${encodeURIComponent(state.selectedTestRunId)}/log`).catch(() => ({ output: '' }));
      state.selectedTestRunLog = log.output || '';
      render();
      return;
    case 'use-provider':
      await apiPost(`/api/v1/providers/${encodeURIComponent(target.dataset.provider)}/use`);
      state.statusMessage = 'Провайдер переключён.';
      await reloadView();
      return;
    case 'select-hook':
      state.selectedHookId = target.dataset.hookId;
      render();
      return;
    case 'enable-hook':
      await apiPost(`/api/v1/hooks/${encodeURIComponent(target.dataset.hookId)}/enable`, {});
      state.statusMessage = 'Хук включён.';
      await reloadView();
      return;
    case 'disable-hook':
      await apiPost(`/api/v1/hooks/${encodeURIComponent(target.dataset.hookId)}/disable`, {});
      state.statusMessage = 'Хук выключен.';
      await reloadView();
      return;
    case 'test-hook':
      await apiPost(`/api/v1/hooks/${encodeURIComponent(target.dataset.hookId)}/test`, {});
      state.statusMessage = 'Тест хука отправлен.';
      await reloadView();
      return;
    case 'use-role':
      await apiPost(`/api/v1/roles/${encodeURIComponent(target.dataset.role)}/use`);
      state.statusMessage = 'Роль активирована.';
      await reloadView();
      return;
    case 'select-workspace':
      state.selectedWorkspaceId = target.dataset.workspaceId;
      render();
      return;
    case 'switch-workspace':
      await apiPost(`/api/v1/workspaces/${encodeURIComponent(target.dataset.workspaceId)}/switch`);
      state.statusMessage = 'Воркспейс переключён в реестре.';
      await reloadView();
      return;
    case 'refresh-workspaces':
      await apiPost('/api/v1/workspaces/refresh');
      state.statusMessage = 'Реестр воркспейсов обновлён.';
      await reloadView();
      return;
    case 'apply-patch':
      await apiPost('/api/v1/patches/apply', {});
      state.statusMessage = 'Патч применён.';
      await reloadView();
      return;
    case 'reject-patch':
      await apiPost('/api/v1/patches/reject', {});
      state.statusMessage = 'Патч отклонён.';
      await reloadView();
      return;
    case 'run-tests':
      await apiPost('/api/v1/tests/run', {});
      state.statusMessage = 'Тесты запущены.';
      await reloadView();
      return;
    case 'refresh-memory':
      await apiPost('/api/v1/project/refresh', {});
      state.statusMessage = 'Память проекта обновлена.';
      await reloadView();
      return;
    case 'refresh-stats':
      await apiPost('/api/v1/stats/refresh', {});
      state.statusMessage = 'Статистика обновлена.';
      await reloadView();
      return;
    case 'refresh-hooks':
      await reloadView('Хуки обновлены.');
      return;
    case 'refresh-all':
      await reloadView('Данные обновлены.');
      return;
    case 'use-current-task':
      if (state.project?.currentTaskId) {
        await apiPost(`/api/v1/tasks/${encodeURIComponent(state.project.currentTaskId)}/use`);
        await reloadView();
      }
      return;
    default:
      return;
  }
}

function connectEvents() {
  const source = new EventSource('/api/v1/events');
  source.addEventListener('open', () => {
    state.live = true;
    render();
  });
  source.addEventListener('error', () => {
    state.live = false;
    render();
  });
  const refresh = () => {
    reloadView();
  };
  source.addEventListener('task:updated', refresh);
  source.addEventListener('patch:new', refresh);
  source.addEventListener('patch.applied', refresh);
  source.addEventListener('patch.rejected', refresh);
  source.addEventListener('patch.rolledBack', refresh);
  source.addEventListener('test:completed', refresh);
  source.addEventListener('test.completed', refresh);
  source.addEventListener('auto:step', refresh);
  source.addEventListener('auto.completed', refresh);
  source.addEventListener('auto.aborted', refresh);
  source.addEventListener('role.used', refresh);
  source.addEventListener('provider.request', refresh);
  source.addEventListener('project:refreshed', refresh);
  source.addEventListener('workspace:updated', refresh);
  source.addEventListener('stats:updated', refresh);
  source.addEventListener('workbench:event', refresh);
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }
  event.preventDefault();
  try {
    await handleAction(target.dataset.action, target);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }
  if (!['set-active-provider', 'set-provider-model'].includes(target.dataset.action)) {
    return;
  }
  try {
    await handleAction(target.dataset.action, target);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
});

window.addEventListener('hashchange', () => {
  state.activeSection = location.hash.replace('#', '') || 'overview';
  render();
});

(async function boot() {
  try {
    await reloadView();
    connectEvents();
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}());
