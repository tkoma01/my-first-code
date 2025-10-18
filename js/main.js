const owner = 'tkoma01';
const repo = 'my-first-code';
const ISSUES_ENDPOINT = `https://api.github.com/repos/${owner}/${repo}/issues`;
const LABELS_ENDPOINT = `https://api.github.com/repos/${owner}/${repo}/labels`;
const MAX_ITEMS = 50;

const issueList = document.getElementById('issue-list');
const issueTemplate = document.getElementById('issue-template');
const statusEl = document.getElementById('status');
const labelFilter = document.getElementById('label-filter');
const keywordInput = document.getElementById('keyword');
const refreshBtn = document.querySelector('[data-refresh]');

const ghHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

let cachedIssues = [];
let searchTimer = 0;
let currentRequestId = 0;

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

refreshBtn?.addEventListener('click', () => loadIssues(true));
labelFilter?.addEventListener('change', () => loadIssues());
keywordInput?.addEventListener('input', () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applyFilters, 200);
});

async function loadLabels() {
  try {
    const params = new URLSearchParams({ per_page: '100', sort: 'name', direction: 'asc' });
    const response = await fetch(`${LABELS_ENDPOINT}?${params.toString()}`, {
      headers: ghHeaders,
      cache: 'no-cache'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const labels = await response.json();
    const sorted = labels
      .filter(label => label && label.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    for (const label of sorted) {
      const option = document.createElement('option');
      option.value = label.name;
      option.textContent = label.name;
      labelFilter?.append(option);
    }
  } catch (error) {
    console.error('ラベルの取得に失敗しました', error);
    setStatus('ラベルの取得に失敗しました。');
  }
}

async function loadIssues(force = false) {
  const requestId = ++currentRequestId;
  setStatus('Issueを読み込んでいます…');
  if (force) {
    issueList.innerHTML = '';
    appendPlaceholder('最新のIssueを取得しています…');
  }
  try {
    const params = new URLSearchParams({
      per_page: String(MAX_ITEMS),
      state: 'all',
      sort: 'updated',
      direction: 'desc'
    });
    const label = labelFilter?.value ?? '';
    if (label) params.set('labels', label);
    const response = await fetch(`${ISSUES_ENDPOINT}?${params.toString()}`, {
      headers: ghHeaders,
      cache: 'no-cache'
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }
    const data = await response.json();
    if (requestId !== currentRequestId) return;
    cachedIssues = data.filter(issue => !issue.pull_request);
    applyFilters();
    const count = cachedIssues.length;
    const labelInfo = label ? `（ラベル: ${label}）` : '';
    setStatus(count ? `${count}件を表示中${labelInfo}` : `該当する Issue はありません${labelInfo}`);
  } catch (error) {
    console.error('Issue の読み込みに失敗しました', error);
    cachedIssues = [];
    renderIssues([]);
    setStatus('Issue の読み込みに失敗しました。しばらくしてから再度お試しください。');
  }
}

function applyFilters() {
  const keyword = (keywordInput?.value ?? '').trim().toLowerCase();
  const filtered = keyword
    ? cachedIssues.filter(issue => {
        const haystack = `${issue.title ?? ''}\n${issue.body ?? ''}`.toLowerCase();
        return haystack.includes(keyword);
      })
    : cachedIssues;
  renderIssues(filtered);
  if (!filtered.length) {
    appendPlaceholder(keyword ? '条件に一致する Issue は見つかりませんでした。' : 'Issue がまだありません。最初の投稿をしてみませんか？', 'board-empty');
  }
}

function renderIssues(issues) {
  issueList.innerHTML = '';
  for (const issue of issues) {
    const card = createIssueCard(issue);
    issueList.append(card);
  }
}

function createIssueCard(issue) {
  const fragment = issueTemplate.content.cloneNode(true);
  const article = fragment.querySelector('.issue-card');
  const titleEl = fragment.querySelector('.issue-title');
  const metaEl = fragment.querySelector('.issue-meta');
  const bodyEl = fragment.querySelector('.issue-body');
  const labelsEl = fragment.querySelector('.issue-labels');

  if (article) {
    const hue = (issue.number * 47) % 360;
    const hueSecondary = (hue + 120) % 360;
    const angle = 140 + (issue.number % 4) * 15;
    article.style.setProperty('--card-hue', `${hue}`);
    article.style.setProperty('--card-hue-secondary', `${hueSecondary}`);
    article.style.setProperty('--card-angle', `${angle}deg`);
    const stateColor = issue.state === 'open' ? 'var(--status-open)' : 'var(--status-closed)';
    article.style.setProperty('--state-color', stateColor);
  }

  if (titleEl) {
    titleEl.textContent = issue.title ?? '(タイトルなし)';
    titleEl.href = issue.html_url;
    titleEl.setAttribute('data-issue-number', issue.number);
  }

  if (metaEl) {
    const stateLabel = issue.state === 'open' ? 'オープン' : 'クローズ';
    metaEl.textContent = `#${issue.number} ・ ${stateLabel} ・ ${formatRelativeTime(issue.updated_at)}更新`;
    metaEl.title = `作成: ${timeFormatter.format(new Date(issue.created_at))}\n更新: ${timeFormatter.format(new Date(issue.updated_at))}`;
  }

  if (labelsEl) {
    const labels = Array.isArray(issue.labels) ? issue.labels : [];
    if (labels.length) {
      labelsEl.hidden = false;
      for (const rawLabel of labels) {
        const chip = document.createElement('span');
        chip.className = 'issue-label';
        chip.textContent = rawLabel.name;
        if (rawLabel.color) {
          const color = `#${rawLabel.color}`;
          chip.style.setProperty('--label-base', applyAlpha(color, 0.55));
          chip.style.setProperty('--label-border', applyAlpha(color, 0.48));
          chip.style.color = getReadableTextColor(color);
        }
        labelsEl.append(chip);
      }
    } else {
      labelsEl.hidden = true;
    }
  }

  if (bodyEl) {
    bodyEl.textContent = formatPreview(issue.body);
  }

  return fragment;
}

function formatPreview(body) {
  if (!body) return '本文はありません。';
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*]\(([^)]+)\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain.length) return '本文はありません。';
  return plain.length > 240 ? `${plain.slice(0, 240)}…` : plain;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '日時不明';
  const target = new Date(isoString);
  const now = Date.now();
  const diffSeconds = Math.round((now - target.getTime()) / 1000);

  const thresholds = [
    { limit: 60, divisor: 1, unit: '秒' },
    { limit: 3600, divisor: 60, unit: '分' },
    { limit: 86400, divisor: 3600, unit: '時間' },
    { limit: 604800, divisor: 86400, unit: '日' },
    { limit: 2592000, divisor: 604800, unit: '週' },
    { limit: 31536000, divisor: 2592000, unit: 'ヶ月' }
  ];

  const absSeconds = Math.abs(diffSeconds);
  for (const step of thresholds) {
    if (absSeconds < step.limit) {
      const value = Math.max(1, Math.floor(absSeconds / step.divisor));
      return `${value}${step.unit}前`;
    }
  }
  const years = Math.max(1, Math.floor(absSeconds / 31536000));
  return `${years}年前`;
}

function applyAlpha(hex, alpha) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  if (Number.isNaN(bigint)) return hex;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getReadableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#2f1a45';
  const { r, g, b } = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? '#3a1b4d' : '#fdf7ff';
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  const bigint = Number.parseInt(normalized, 16);
  if (Number.isNaN(bigint)) return null;
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function appendPlaceholder(text, className = 'board-placeholder') {
  issueList.innerHTML = '';
  const message = document.createElement('p');
  message.className = className;
  message.textContent = text;
  issueList.append(message);
}

function setStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
}

loadLabels();
loadIssues(true);
