'use strict';

/* --------------------------------------------------------------------------
   tasklove. — umumiy state, yordamchilar va kichik UI komponentlari
   -------------------------------------------------------------------------- */

const app = {
  data: null,
  route: { name: 'board' },
  filter: 'active',
  authMode: 'login',
  events: null,
  streamOnline: false,
  refreshing: false,
  queuedRefresh: false,
  refreshTimer: null,
  reconnectTimer: null,
  modal: null,
  booted: false,
  createTargetId: null,
  createMode: null,
};

const CATEGORY_META = Object.freeze({
  date: { label: 'Uchrashuv', emoji: '💞' },
  care: { label: 'G‘amxo‘rlik', emoji: '🫶' },
  home: { label: 'Uy', emoji: '🏡' },
  adventure: { label: 'Sarguzasht', emoji: '🌿' },
  surprise: { label: 'Syurpriz', emoji: '🎁' },
  other: { label: 'Boshqa', emoji: '✦' },
});

const MODE_META = Object.freeze({
  solo: {
    label: 'Shaxsiy',
    icon: 'lock',
    description: 'Faqat tanlangan yurak bajaradi.',
    tag: '1 kishi · 1 ball',
  },
  shared: {
    label: 'Birgalikda',
    icon: 'users',
    description: 'Tanlangan do‘stlar orasida poyga.',
    tag: 'Birinchi bo‘lgan +1',
  },
  open: {
    label: 'Hamma uchun',
    icon: 'globe',
    description: 'Saytdagi hamma bajarishi mumkin.',
    tag: 'Ochiq poyga',
  },
});

const AVATAR_EMOJIS = [
  '🌷', '🌹', '💌', '🦋', '🍒', '🌙', '🔥', '🐚', '🧸', '🍓',
  '🪐', '🕊️', '💋', '🐈‍⬛', '🌻', '🍷', '🎈', '🌵',
];

const AVATAR_COLORS = [
  '#b84a5f', '#d5684d', '#b7792e', '#4d846e',
  '#6968a8', '#975481', '#466b8a', '#b64d78',
];

const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

const UZ_MONTHS_SHORT = [
  'YAN', 'FEV', 'MAR', 'APR', 'MAY', 'IYN',
  'IYL', 'AVG', 'SEN', 'OKT', 'NOY', 'DEK',
];

const UZ_WEEKDAYS = [
  'yakshanba', 'dushanba', 'seshanba', 'chorshanba',
  'payshanba', 'juma', 'shanba',
];

const dom = {
  body: document.body,
  bootScreen: document.getElementById('bootScreen'),
  authScreen: document.getElementById('authScreen'),
  appScreen: document.getElementById('appScreen'),
  viewRoot: document.getElementById('viewRoot'),
  modalRoot: document.getElementById('modalRoot'),
  toastRoot: document.getElementById('toastRoot'),
  burstRoot: document.getElementById('burstRoot'),
  authForm: document.getElementById('authForm'),
  authName: document.getElementById('authName'),
  authUsername: document.getElementById('authUsername'),
  authPassword: document.getElementById('authPassword'),
  authError: document.getElementById('authError'),
  authSubmit: document.getElementById('authSubmit'),
  nameField: document.getElementById('nameField'),
  authEyebrow: document.getElementById('authEyebrow'),
  authTitle: document.getElementById('authTitle'),
  authIntro: document.getElementById('authIntro'),
  authSwitchText: document.getElementById('authSwitchText'),
  authSwitchButton: document.getElementById('authSwitchButton'),
};

/* --------------------------------------------------------------------------
   Xavfsiz matn va formatlash
   -------------------------------------------------------------------------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function safeAccent(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#b84a5f';
}

function safeEmoji(value) {
  return typeof value === 'string' && value.trim() ? value : '🌷';
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function capitalize(text) {
  const value = String(text || '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function getFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'yurak';
}

function modeMeta(mode) {
  return MODE_META[mode] || MODE_META.other || {
    label: 'Vazifa',
    icon: 'heart-line',
    description: '',
    tag: '',
  };
}

function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.other;
}

function taskSerial(taskId) {
  return `№ ${String(taskId || '').slice(0, 4).toUpperCase()}`;
}

function parseIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function fullDate(value) {
  const date = parseIso(value);
  if (!date) return '';
  return `${date.getDate()} ${UZ_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function todayLabel(date = new Date()) {
  return `${capitalize(UZ_WEEKDAYS[date.getDay()])}, ${date.getDate()} ${UZ_MONTHS[date.getMonth()]}`;
}

function timeAgo(value) {
  const date = parseIso(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 45) return 'hozir';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'kecha';
  if (days < 7) return `${days} kun oldin`;
  return `${date.getDate()} ${UZ_MONTHS[date.getMonth()]}`;
}

function dueLabel(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const now = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target - now) / 86400000);
  if (diff < 0) return 'Muddat o‘tgan';
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Ertaga';
  return `${date.getDate()} ${UZ_MONTHS[date.getMonth()]}`;
}

function dateStamp(value) {
  const date = parseIso(value);
  if (!date) return { day: '—', month: '' };
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: UZ_MONTHS_SHORT[date.getMonth()],
  };
}

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function initial(value) {
  return String(value || '?').trim().charAt(0).toUpperCase() || '?';
}

/* --------------------------------------------------------------------------
   Avatar va odam komponentlari
   -------------------------------------------------------------------------- */

function avatarHtml(user, size = 'md') {
  const person = user || {};
  const hasImage = person.avatar_url;
  return hasImage
    ? `
      <span class="avatar avatar--${esc(size)}" style="--accent:${safeAccent(person.accent)}" aria-hidden="true">
        <img class="avatar-image" src="${esc(person.avatar_url)}" alt="">
      </span>`
    : `
      <span class="avatar avatar--${esc(size)}" style="--accent:${safeAccent(person.accent)}" aria-hidden="true">
        <span class="avatar-emoji">${esc(safeEmoji(person.emoji))}</span>
      </span>`;
}

function avatarWrapHtml(user, size = 'md', online = false) {
  return `
    <span class="avatar-wrap">
      ${avatarHtml(user, size)}
      ${online ? '<span class="avatar-online" title="Onlayn"></span>' : ''}
    </span>`;
}

function avatarStackHtml(users, max = 4) {
  const unique = [];
  const seen = new Set();
  for (const user of users || []) {
    if (!user || seen.has(user.id)) continue;
    seen.add(user.id);
    unique.push(user);
  }
  const visible = unique.slice(0, max);
  const extra = unique.length - visible.length;
  return `
    <span class="avatar-stack">
      ${visible.map((user) => `<span class="avatar-wrap">${avatarHtml(user, 'sm')}</span>`).join('')}
      ${extra > 0 ? `<span class="avatar-more">+${extra}</span>` : ''}
    </span>`;
}

function onlineLabelHtml(userId) {
  const online = Boolean(app.data && app.data.onlineUserIds.includes(userId));
  return `<span class="online-state ${online ? 'is-online' : ''}" data-user-online="${esc(userId)}"><span data-online-word>${online ? 'onlayn' : 'oflayn'}</span></span>`;
}

function isUserOnline(userId) {
  return Boolean(app.data && app.data.onlineUserIds.includes(userId));
}

function currentUser() {
  return app.data ? app.data.me : null;
}

function findUser(userId) {
  if (!app.data) return null;
  return app.data.users.find((user) => user.id === userId) || null;
}

function profileHref(userId) {
  return app.data && app.data.me.id === userId ? '#/me' : `#/profile/${encodeURIComponent(userId)}`;
}

function userRank(userId) {
  if (!app.data) return 0;
  return app.data.users.findIndex((user) => user.id === userId) + 1;
}

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json' };
  const init = {
    method,
    headers,
    credentials: 'same-origin',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.', 0);
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && options.allow401) return null;
    throw new ApiError(
      payload?.error || `So‘rov bajarilmadi (${response.status}).`,
      response.status,
    );
  }

  return payload;
}

/* --------------------------------------------------------------------------
   Tugma holati va formalar
   -------------------------------------------------------------------------- */

function setButtonBusy(button, busy, label = 'Kuting…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function showFormError(element, message) {
  if (!element) return;
  if (message) {
    element.textContent = message;
    element.hidden = false;
  } else {
    element.textContent = '';
    element.hidden = true;
  }
}

function clearAuthError() {
  showFormError(dom.authError, '');
}

function setAuthMode(mode) {
  const nextMode = mode === 'register' ? 'register' : 'login';
  app.authMode = nextMode;
  const isRegister = nextMode === 'register';

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    const active = tab.dataset.authMode === nextMode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  dom.nameField.hidden = !isRegister;
  dom.authName.required = isRegister;
  dom.authName.disabled = !isRegister;
  dom.authUsername.autocomplete = isRegister ? 'username' : 'username';
  dom.authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';

  if (isRegister) {
    dom.authEyebrow.textContent = 'Yangi yurak';
    dom.authTitle.innerHTML = 'Orangizda joy bor<span class="rose-dot">.</span>';
    dom.authIntro.textContent = 'Bir necha soniyada o‘z hisobingizni oching. Keyin esa — kichik vazifalar va katta kutilmagan sovg‘alar.';
    dom.authSubmit.querySelector('[data-auth-submit-label]').textContent = 'Boshlash';
    dom.authSwitchText.textContent = 'Allaqachon hisobingiz bormi?';
    dom.authSwitchButton.textContent = 'Kirish';
    dom.authSwitchButton.dataset.authMode = 'login';
  } else {
    dom.authEyebrow.textContent = 'Yana uchrashdik';
    dom.authTitle.innerHTML = 'Xush kelibsiz<span class="rose-dot">.</span>';
    dom.authIntro.textContent = 'Profilingizga kirib, bugungi kichik sarguzashtlarni ko‘ring.';
    dom.authSubmit.querySelector('[data-auth-submit-label]').textContent = 'Kirish';
    dom.authSwitchText.textContent = 'Hali hisobingiz yo‘qmi?';
    dom.authSwitchButton.textContent = 'Ro‘yxatdan o‘ting';
    dom.authSwitchButton.dataset.authMode = 'register';
  }

  clearAuthError();
}

/* --------------------------------------------------------------------------
   Toast
   -------------------------------------------------------------------------- */

function toast(title, message = '', type = 'success') {
  if (!dom.toastRoot) return;
  while (dom.toastRoot.children.length >= 3) {
    dom.toastRoot.firstElementChild?.remove();
  }

  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'sparkle' : 'check';
  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.innerHTML = `
    <span class="toast-icon">${icon(iconName)}</span>
    <div class="toast-copy">
      <strong>${esc(title)}</strong>
      ${message ? `<p>${esc(message)}</p>` : ''}
    </div>
    <button class="toast-close" type="button" aria-label="Yopish">${icon('close')}</button>
  `;

  const close = () => {
    if (!element.isConnected) return;
    element.classList.add('is-leaving');
    setTimeout(() => element.remove(), 280);
  };

  element.querySelector('.toast-close').addEventListener('click', close);
  dom.toastRoot.append(element);
  const timer = setTimeout(close, type === 'error' ? 6500 : 4600);
  element.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
}

/* --------------------------------------------------------------------------
   Yurak portlashi
   -------------------------------------------------------------------------- */

function heartBurst() {
  if (!dom.burstRoot) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const symbols = ['♥', '♡', '♥', '✦', '♡'];
  for (let index = 0; index < 18; index += 1) {
    const heart = document.createElement('span');
    heart.className = 'burst-heart';
    heart.textContent = symbols[index % symbols.length];
    heart.style.setProperty('--x', `${(Math.random() * 440) - 220}px`);
    heart.style.setProperty('--y', `${-90 - Math.random() * 240}px`);
    heart.style.setProperty('--r', `${(Math.random() * 100) - 50}deg`);
    heart.style.setProperty('--scale', `${0.7 + Math.random() * 0.9}`);
    heart.style.fontSize = `${15 + Math.random() * 18}px`;
    heart.style.animationDelay = `${Math.random() * 180}ms`;
    heart.style.color = index % 3 === 0 ? '#b84a5f' : index % 3 === 1 ? '#ce5e6d' : '#b7792e';
    dom.burstRoot.append(heart);
    setTimeout(() => heart.remove(), 1500);
  }
}

/* --------------------------------------------------------------------------
   Clipboard
   -------------------------------------------------------------------------- */

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy failed');
}

async function copyInvite() {
  const text = `tasklove.ga qo‘shiling — kichik vazifalar, katta hislar: ${location.origin}`;
  try {
    await copyText(text);
    toast('Havola tayyor', 'Uni do‘stingizga yuboring — birgalikda o‘ynash qiziqroq.', 'success');
  } catch {
    toast('Havolani nusxalab bo‘lmadi', 'Manzilni qo‘lda nusxalang: ' + location.origin, 'error');
  }
}

/* --------------------------------------------------------------------------
   Rasm yuklash yordamchilari
   -------------------------------------------------------------------------- */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Fayl o‘qilmadi'));
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file, { maxBytes, acceptTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = {}) {
  if (!file) return { ok: false, error: 'Fayl tanlanmagan.' };
  if (!acceptTypes.includes(file.type)) return { ok: false, error: 'Ruxsat etilgan formatlar: JPEG, PNG, WebP, GIF.' };
  if (file.size > maxBytes) return { ok: false, error: `Hajm ${maxBytes / 1024 / 1024} MB dan oshmasligi kerak.` };
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Modal asosi
   -------------------------------------------------------------------------- */

function closeModal(options = {}) {
  const current = app.modal;
  if (!current) return;
  current.layer.remove();
  document.removeEventListener('keydown', current.keyHandler);
  app.modal = null;
  if (!document.querySelector('.modal-layer')) {
    dom.body.classList.remove('modal-open');
  }
  if (options.restoreFocus !== false && current.previousFocus?.isConnected) {
    try {
      current.previousFocus.focus({ preventScroll: true });
    } catch {
      // may be hidden
    }
  }
}

function openModal({
  title,
  eyebrow = '',
  intro = '',
  body = '',
  footer = '',
  size = '',
  footerClass = '',
  onMount = null,
}) {
  closeModal({ restoreFocus: false });

  const previousFocus = document.activeElement;
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML = `
    <div class="modal-scrim" data-close-modal></div>
    <section class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1">
      <button class="modal-close" type="button" data-close-modal aria-label="Oynani yopish">${icon('close')}</button>
      <span class="modal-back-heart" aria-hidden="true">♥</span>
      <header class="modal-header">
        ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
        <h2 id="modalTitle">${esc(title)}</h2>
        ${intro ? `<p>${esc(intro)}</p>` : ''}
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer ${footerClass}">${footer}</div>` : ''}
    </section>
  `;

  dom.modalRoot.append(layer);
  dom.body.classList.add('modal-open');

  const getFocusable = () => [...layer.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.hidden && node.offsetParent !== null);

  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) {
      event.preventDefault();
      layer.querySelector('.modal')?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  layer.querySelectorAll('[data-close-modal]').forEach((node) => {
    node.addEventListener('click', () => closeModal());
  });
  document.addEventListener('keydown', keyHandler);
  app.modal = { layer, previousFocus, keyHandler };

  if (typeof onMount === 'function') {
    try {
      onMount(layer, () => closeModal());
    } catch (error) {
      console.error('Modal mount xatosi:', error);
    }
  }

  requestAnimationFrame(() => {
    const preferred = layer.querySelector('[autofocus]');
    const first = preferred || getFocusable()[0];
    first?.focus({ preventScroll: false });
  });

  return layer;
}
