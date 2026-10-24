'use strict';

/* --------------------------------------------------------------------------
   tasklove. — ilova hayoti, auth, real-vaqt va harakatlar
   -------------------------------------------------------------------------- */

let authSubmitting = false;
let logoutBusy = false;
let eventsBound = false;

// Chat state
app.chat = {
  active: 'general',
  messages: [],
  directs: [],
  general: null,
  loading: false,
  sidebarOpen: false,
};

/* --------------------------------------------------------------------------
   Ekranlar
   -------------------------------------------------------------------------- */

function hideBoot() {
  if (dom.bootScreen) dom.bootScreen.hidden = true;
}

function showAuth() {
  disconnectStream();
  clearTimeout(app.refreshTimer);
  clearTimeout(app.reconnectTimer);
  app.refreshTimer = null;
  app.reconnectTimer = null;
  app.refreshing = false;
  app.queuedRefresh = false;
  app.data = null;
  app.route = { name: 'board' };
  app.filter = 'active';

  if (app.modal) closeModal({ restoreFocus: false });
  hideBoot();
  dom.appScreen.hidden = true;
  dom.authScreen.hidden = false;
  dom.body.classList.remove('modal-open');
  setAuthMode('login');
  dom.authForm.reset();
  clearAuthError();
  if (location.hash !== '#/kirish') {
    history.replaceState(null, '', '#/kirish');
  }
  document.title = 'Kirish — tasklove.';
  window.scrollTo(0, 0);
}

function enterApp() {
  hideBoot();
  dom.authScreen.hidden = true;
  dom.appScreen.hidden = false;
  dom.body.classList.remove('modal-open');
  renderApp();
  connectStream();
}

function handleUnauthorized() {
  if (dom.authScreen.hidden === false) return;
  const hadSession = Boolean(app.data);
  disconnectStream();
  app.data = null;
  showAuth();
  if (hadSession) {
    toast('Sessiya tugadi', 'Xavfsizlik uchun qaytadan kirishingiz kerak.', 'error');
  }
}

/* --------------------------------------------------------------------------
   Marshrutlar
   -------------------------------------------------------------------------- */

function parseRoute() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const path = raw.split('?')[0].replace(/\/+$/, '');

  if (!path || path === 'board' || path === 'kirish') return { name: 'board' };
  if (path === 'people') return { name: 'people' };
  if (path === 'me') return { name: 'profile', self: true, userId: null };
  if (path === 'chat') return { name: 'chat', userId: 'general' };

  const chatMatch = /^chat\/([A-Za-z0-9-]+)$/.exec(path);
  if (chatMatch) {
    return { name: 'chat', userId: chatMatch[1] };
  }

  const match = /^profile\/([A-Za-z0-9-]+)$/.exec(path);
  if (match) {
    return { name: 'profile', self: false, userId: match[1] };
  }

  return { name: 'board' };
}

function handleRouteChange() {
  if (!app.data) return;
  app.route = parseRoute();
  if (app.modal) closeModal({ restoreFocus: false });
  renderApp();
  window.scrollTo(0, 0);
}

function navigate(path, { replace = false } = {}) {
  const normalized = String(path).startsWith('#')
    ? String(path)
    : `#/${String(path).replace(/^\/+/, '')}`;

  if (location.hash === normalized) {
    handleRouteChange();
    return;
  }

  if (replace) {
    history.replaceState(null, '', normalized);
    handleRouteChange();
  } else {
    location.hash = normalized;
  }
}

/* --------------------------------------------------------------------------
   Real-vaqt
   -------------------------------------------------------------------------- */

function setStreamStatus(online, label = null) {
  app.streamOnline = Boolean(online);
  const pill = document.querySelector('[data-live-pill]');
  const word = document.querySelector('[data-live-word]');
  if (pill) pill.classList.toggle('is-reconnecting', !online);
  if (word) word.textContent = label || (online ? 'onlayn' : 'qayta ulanish');
}

function disconnectStream() {
  if (app.events) {
    app.events.close();
    app.events = null;
  }
  clearTimeout(app.reconnectTimer);
  app.reconnectTimer = null;
  setStreamStatus(false, 'ulanmoqda');
}

function connectStream() {
  if (!app.data) return;
  disconnectStream();
  setStreamStatus(false, 'ulanmoqda');

  let source;
  try {
    source = new EventSource('/api/events');
  } catch {
    setStreamStatus(false, 'qayta ulanish');
    return;
  }
  app.events = source;

  source.addEventListener('open', () => {
    clearTimeout(app.reconnectTimer);
    app.reconnectTimer = null;
    setStreamStatus(true);
  });

  source.addEventListener('ready', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (Array.isArray(payload.onlineUserIds) && app.data) {
        app.data.onlineUserIds = [...new Set(payload.onlineUserIds)];
        updatePresenceUI();
      }
    } catch {
      // noto‘g‘ri event — e'tiborsiz qoldiramiz
    }
    setStreamStatus(true);
    // Qayta ulanish paytida o‘tkazib yuborilgan o‘zgarishlarni olamiz.
    scheduleRefresh(null, 120);
  });

  source.addEventListener('presence', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (Array.isArray(payload.onlineUserIds) && app.data) {
        app.data.onlineUserIds = [...new Set(payload.onlineUserIds)];
        updatePresenceUI();
      }
    } catch {
      // ignore
    }
  });

  source.addEventListener('sync', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      payload = null;
    }
    if (payload) handleRealtimeNotification(payload);
    scheduleRefresh(payload, 170);
  });

  source.onerror = () => {
    setStreamStatus(false, 'qayta ulanish');
    clearTimeout(app.reconnectTimer);
    app.reconnectTimer = setTimeout(verifySessionAfterDisconnect, 2600);
  };
}

async function verifySessionAfterDisconnect() {
  if (!app.data) return;
  try {
    const data = await api('/api/state', { allow401: true });
    if (data === null) {
      handleUnauthorized();
      return;
    }
    if (data && app.data) {
      app.data = data;
      renderApp();
    }
  } catch {
    // Hali ham aloqa yo‘q — EventSource o‘zi qayta urinishda davom etadi.
  }
}

function scheduleRefresh(meta, delay = 170) {
  clearTimeout(app.refreshTimer);
  app.refreshTimer = setTimeout(() => {
    app.refreshTimer = null;
    refreshState({ silent: true });
  }, delay);
  if (meta) {
    // notification schedule ichida emas — sync eventda darhol ko'rsatiladi
  }
}

async function refreshState({ silent = true } = {}) {
  if (!app.data) return;
  if (app.refreshing) {
    app.queuedRefresh = true;
    return;
  }

  clearTimeout(app.refreshTimer);
  app.refreshTimer = null;
  app.refreshing = true;
  app.queuedRefresh = false;

  try {
    const data = await api('/api/state');
    if (!app.data) return;
    app.data = data;
    renderApp();
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!silent) {
      toast('Yangilab bo‘lmadi', error.message, 'error');
    }
  } finally {
    app.refreshing = false;
    if (app.queuedRefresh && app.data) {
      app.queuedRefresh = false;
      app.refreshTimer = setTimeout(() => {
        app.refreshTimer = null;
        refreshState({ silent: true });
      }, 60);
    }
  }
}

function handleRealtimeNotification(meta) {
  if (!app.data || !meta || !meta.kind) return;
  const me = app.data.me;
  if (meta.actorId === me.id) return;

  const recipients = Array.isArray(meta.recipients) ? meta.recipients : [];
  const isOpen = meta.mode === 'open';

  if (meta.kind === 'task.created') {
    if (isOpen) {
      toast(
        'Yangi ochiq vazifa',
        `${meta.actorName} tashladi: “${meta.title}”. Birinchi bo‘lish imkoni sizda!`,
        'info',
      );
    } else if (recipients.includes(me.id)) {
      toast(
        'Sizga vazifa tashlandi',
        `${meta.actorName}: “${meta.title}”. Birinchi bo‘lib bajaring!`,
        'info',
      );
    }
  } else if (meta.kind === 'task.completed') {
    if (isOpen || recipients.includes(me.id)) {
      toast(
        'Birinchi bo‘ldi!',
        `${meta.actorName} “${meta.title}” vazifasini birinchi bo‘lib bajardi. +1 ball.`,
        'success',
      );
    }
  } else if (meta.kind === 'task.deleted') {
    if (recipients.includes(me.id)) {
      toast(
        'Vazifa olib tashlandi',
        `${meta.actorName} “${meta.title}” vazifasini bekor qildi.`,
        'info',
      );
    }
  } else if (meta.kind === 'user.deleted') {
    if (app.route.name === 'profile' && app.route.userId === meta.actorId) {
      toast('Profil o‘chirildi', `${meta.actorName} o‘z akkauntini o‘chirdi.`, 'info');
    }
  } else if (meta.kind === 'message.created') {
    const message = meta.message;
    if (!message) return;
    const isGeneral = !message.recipient_id;
    const isDM = message.recipient_id && (message.recipient_id === me.id || message.sender_id === me.id);

    // If we're on chat page and viewing this conversation, refresh messages
    if (app.route.name === 'chat') {
      const activeTarget = app.chat?.active;
      if (isGeneral && activeTarget === 'general') {
        loadChatMessages('general');
        return;
      }
      if (isDM && activeTarget && activeTarget !== 'general') {
        if (message.sender_id === activeTarget || message.recipient_id === activeTarget) {
          loadChatMessages(activeTarget);
          return;
        }
      }
    }

    // Show toast for DMs (not general)
    if (isDM && message.sender_id !== me.id) {
      toast(
        `Xabar: ${message.sender.display_name}`,
        message.body.length > 60 ? message.body.slice(0, 60) + '…' : message.body,
        'info',
      );
    } else if (isGeneral && app.route.name !== 'chat') {
      toast(
        'Umumiy suhbatda yangi xabar',
        `${message.sender.display_name}: ${message.body.length > 50 ? message.body.slice(0, 50) + '…' : message.body}`,
        'info',
      );
    }
  }
}

/* --------------------------------------------------------------------------
   Chat / Suhbatlar
   -------------------------------------------------------------------------- */

function initChat() {
  const route = app.route;
  const target = route.userId || 'general';
  app.chat.active = target;
  app.chatSidebarOpen = false;

  // Load chat list and messages
  loadChatList();
}

async function loadChatList() {
  if (!app.data) return;
  app.chat.loading = true;
  try {
    const data = await api('/api/chat');
    if (!app.data) return;
    app.chat.general = data.general;
    app.chat.directs = data.directs || [];
    app.chat.loading = false;
    renderApp();
    loadChatMessages(app.chat.active);
  } catch (error) {
    app.chat.loading = false;
    if (error.status === 401) handleUnauthorized();
  }
}

async function loadChatMessages(target) {
  if (!app.data) return;
  app.chat.active = target;
  const isGeneral = target === 'general';

  try {
    const data = await api(`/api/messages${isGeneral ? '' : `?with=${encodeURIComponent(target)}`}`);
    if (!app.data) return;
    app.chat.messages = data.messages || [];
    app.chat.general = isGeneral ? { ...app.chat.general, last_message: data.messages?.[data.messages.length - 1] || null } : app.chat.general;
    
    // Update the conversation list with new last message
    if (!isGeneral && data.with) {
      const idx = app.chat.directs.findIndex((c) => c.user.id === target);
      if (idx >= 0 && data.messages.length) {
        const lastMsg = data.messages[data.messages.length - 1];
        app.chat.directs[idx].last_message = {
          body: lastMsg.body,
          created_at: lastMsg.created_at,
          mine: lastMsg.mine,
          sender_id: lastMsg.sender.id,
        };
      }
    }
    
    // Render only the messages area if we're on chat page
    if (app.route.name === 'chat') {
      renderChatMessages();
    }
  } catch (error) {
    if (error.status === 401) handleUnauthorized();
  }
}

function renderChatMessages() {
  const messagesContainer = document.querySelector('[data-chat-messages]');
  if (!messagesContainer) return;
  
  const messages = app.chat.messages || [];
  const me = currentUser();
  
  if (messages.length === 0) {
    const isGeneral = app.chat.active === 'general';
    messagesContainer.innerHTML = `
      <div class="chat-empty-state">
        <span class="icon">${icon(isGeneral ? 'users' : 'chat')}</span>
        <h3>${isGeneral ? 'Hozircha xabarlar yo‘q' : 'Xabarlar yo‘q'}</h3>
        <p>${isGeneral ? 'Birinchi bo‘lib salom bering! Barcha ishtirokchilar ko‘radi.' : 'Birinchi bo‘lib xabar yuboring.'}</p>
      </div>
    `;
    return;
  }

  messagesContainer.innerHTML = messages.map((msg) => renderChatMessage(msg)).join('');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderChatMessage(msg) {
  const time = parseIso(msg.created_at);
  const timeStr = time ? time.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '';
  const isMine = msg.mine;
  const sender = msg.sender;

  let content = '';
  if (msg.image) {
    content = `<a href="${esc(msg.image)}" target="_blank" class="chat-message-image"><img src="${esc(msg.image)}" alt="Dalil rasmi" loading="lazy"></a>`;
  } else {
    content = esc(msg.body);
  }

  return `
    <div class="chat-message ${isMine ? 'mine' : ''}" data-message-id="${esc(msg.id)}">
      ${!isMine ? `
        <div class="chat-message-avatar">
          ${avatarHtml(sender, 'sm')}
        </div>
      ` : ''}
      <div class="chat-message-bubble">
        ${!isMine ? `<span class="chat-message-sender">${esc(sender.display_name)}</span>` : ''}
        ${content}
        <span class="chat-message-time">${timeStr}</span>
      </div>
    </div>
  `;
}

async function handleChatFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector('[data-chat-input]');
  const sendBtn = form.querySelector('.chat-composer-send');
  const text = input.value.trim();
  if (!text) return;

  const target = app.chat.active;
  const isGeneral = target === 'general';

  setButtonBusy(sendBtn, true, '');
  input.disabled = true;

  try {
    await api('/api/messages', {
      method: 'POST',
      body: {
        to: isGeneral ? null : target,
        body: text,
      },
    });
    input.value = '';
    input.style.height = 'auto';
    loadChatMessages(target);
  } catch (error) {
    if (error.status === 401) handleUnauthorized();
    else toast('Yuborilmadi', error.message, 'error');
  } finally {
    setButtonBusy(sendBtn, false);
    input.disabled = false;
  }
}

function handleChatInput(event) {
  const textarea = event.target;
  const sendBtn = textarea.closest('form')?.querySelector('.chat-composer-send');
  if (sendBtn) sendBtn.disabled = !textarea.value.trim();
  
  // Auto-resize
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
}

function handleChatSidebarToggle() {
  app.chatSidebarOpen = !app.chatSidebarOpen;
  renderApp();
}

function handleChatItemClick(event) {
  const link = event.target.closest('[data-chat-target]');
  if (!link) return;
  event.preventDefault();
  
  const target = link.dataset.chatTarget;
  if (target === 'general') {
    navigate('/chat');
  } else {
    navigate(`/chat/${target}`);
  }
  app.chatSidebarOpen = false;
}

// Override handleAction for chat
const originalHandleAction = handleAction;
function handleAction(node) {
  const action = node.dataset.action;
  if (!action) return;

  if (action === 'chat-sidebar-toggle') {
    handleChatSidebarToggle();
    return;
  }

  if (action === 'chat-item') {
    handleChatItemClick(event);
    return;
  }

  originalHandleAction(node);
}

// Update handleRealtimeNotification to include chat events
// Already done above

/* --------------------------------------------------------------------------
   Auth
   -------------------------------------------------------------------------- */

async function handleAuthSubmit(form) {
  if (authSubmitting) return;

  clearAuthError();
  const mode = app.authMode;
  const isRegister = mode === 'register';
  const name = dom.authName.value.trim();
  const username = dom.authUsername.value.trim().toLowerCase();
  const password = dom.authPassword.value;

  if (isRegister && name.length < 2) {
    showFormError(dom.authError, 'Ismingiz kamida 2 ta belgidan iborat bo‘lishi kerak.');
    dom.authName.focus();
    return;
  }
  if (name.length > 40) {
    showFormError(dom.authError, 'Ism juda uzun.');
    dom.authName.focus();
    return;
  }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    showFormError(dom.authError, 'Taxallus 3–20 belgidan iborat bo‘lib, faqat lotin harflari, raqamlar va _ belgisidan tashkil topishi kerak.');
    dom.authUsername.focus();
    return;
  }
  if (password.length < 8) {
    showFormError(dom.authError, 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
    dom.authPassword.focus();
    return;
  }

  authSubmitting = true;
  setButtonBusy(dom.authSubmit, true, isRegister ? 'Hisob ochilmoqda…' : 'Kirilmoqda…');

  try {
    await api(isRegister ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: isRegister ? { name, username, password } : { username, password },
    });

    const data = await api('/api/state');
    app.data = data;
    app.filter = 'active';
    app.route = { name: 'board' };
    history.replaceState(null, '', '#/board');
    dom.authForm.reset();
    enterApp();
    toast(
      isRegister ? 'Xush kelibsiz, yurak!' : 'Yana ko‘rishdik!',
      isRegister
        ? 'Hisobingiz tayyor. Birinchi vazifangizni tashlang yoki do‘stlaringiznikini bajaring.'
        : 'Bugungi kichik sarguzashtlar sizni kutmoqda.',
      'success',
    );
  } catch (error) {
    if (error.status === 401 && !isRegister) {
      showFormError(dom.authError, "Taxallus yoki parol noto‘g‘ri.");
    } else if (error.status === 401) {
      handleUnauthorized();
    } else {
      showFormError(dom.authError, error.message);
    }
  } finally {
    authSubmitting = false;
    setButtonBusy(dom.authSubmit, false);
  }
}

async function handleLogout() {
  if (logoutBusy) return;
  logoutBusy = true;
  const first = app.data;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    if (error.status === 401) {
      // Sessiya allaqachon yo‘q — baribir chiqamiz.
    } else {
      toast('Chiqishda xatolik', error.message, 'error');
    }
  } finally {
    logoutBusy = false;
    if (first) {
      disconnectStream();
      app.data = null;
      showAuth();
      toast('Hisobdan chiqdingiz', 'Yana qaytib keling — sizni sog‘indik.', 'info');
    }
  }
}

/* --------------------------------------------------------------------------
   Vazifa yaratish / tahrirlash / o‘chirish formalari
   -------------------------------------------------------------------------- */

async function handleCreateTaskSubmit(form) {
  const errorElement = form.querySelector('[data-form-error]');
  const submit = document.getElementById('createTaskSubmit');
  showFormError(errorElement, '');

  const title = form.elements.title.value.trim();
  const description = form.elements.description.value.trim();
  const mode = form.querySelector('input[name="mode"]:checked')?.value;
  const category = form.querySelector('input[name="category"]:checked')?.value || 'other';
  const dueDate = form.elements.due_date.value || null;
  const participants = [...form.querySelectorAll('input[name="participant"]:checked')]
    .map((input) => input.value);

  if (title.length < 3) {
    showFormError(errorElement, 'Vazifa nomi kamida 3 ta belgidan iborat bo‘lishi kerak.');
    form.elements.title.focus();
    return;
  }
  if (!['solo', 'shared', 'open'].includes(mode)) {
    showFormError(errorElement, 'Vazifa turini tanlang.');
    return;
  }
  if (mode === 'solo' && participants.length !== 1) {
    showFormError(errorElement, 'Shaxsiy vazifa uchun bitta yurakni tanlang.');
    form.querySelector('input[name="participant"]')?.focus();
    return;
  }
  if (mode === 'shared' && participants.length < 1) {
    showFormError(errorElement, 'Birgalikdagi vazifa uchun kamida bitta yurakni tanlang.');
    form.querySelector('input[name="participant"]')?.focus();
    return;
  }

  setButtonBusy(submit, true, 'Tashlanmoqda…');
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: {
        title,
        description,
        mode,
        category,
        due_date: dueDate,
        participant_ids: mode === 'open' ? [] : participants,
      },
    });
    closeModal({ restoreFocus: false });
    app.filter = 'active';
    toast('Vazifa tashlandi', 'Endi eng shirin qismi — kim birinchi bo‘lishini kutish.', 'success');
    await refreshState({ silent: true });
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    showFormError(errorElement, error.message);
  } finally {
    setButtonBusy(submit, false);
  }
}

async function handleEditProfileSubmit(form) {
  const errorElement = form.querySelector('[data-form-error]');
  const submit = document.getElementById('editProfileSubmit');
  showFormError(errorElement, '');

  const displayName = form.elements.display_name.value.trim();
  const bio = form.elements.bio.value.trim();
  const emoji = form.querySelector('input[name="emoji"]:checked')?.value;
  const accent = form.querySelector('input[name="accent"]:checked')?.value;

  if (displayName.length < 2) {
    showFormError(errorElement, 'Ism kamida 2 ta belgidan iborat bo‘lishi kerak.');
    form.elements.display_name.focus();
    return;
  }
  if (bio.length > 180) {
    showFormError(errorElement, 'Bio 180 ta belgidan oshmasligi kerak.');
    form.elements.bio.focus();
    return;
  }

  setButtonBusy(submit, true, 'Saqlanmoqda…');
  try {
    await api('/api/profile', {
      method: 'PATCH',
      body: {
        display_name: displayName,
        bio,
        emoji,
        accent,
      },
    });
    closeModal({ restoreFocus: false });
    toast('Profil yangilandi', 'Yangi ko‘rinish barcha yuraklarga ko‘rindi.', 'success');
    await refreshState({ silent: true });
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    showFormError(errorElement, error.message);
  } finally {
    setButtonBusy(submit, false);
  }
}

async function handleDeleteAccountSubmit(form) {
  const errorElement = form.querySelector('[data-form-error]');
  const submit = document.getElementById('deleteAccountSubmit');
  const me = currentUser();
  if (!me) return;
  showFormError(errorElement, '');

  const password = form.elements.password.value;
  const confirmRaw = form.elements.confirm.value.trim();
  const confirm = confirmRaw.replace(/^@/, '');

  if (!password) {
    showFormError(errorElement, 'Parolingizni kiriting.');
    form.elements.password.focus();
    return;
  }
  if (confirm !== me.username) {
    showFormError(errorElement, `Tasdiqlash uchun ${me.username} deb yozing.`);
    form.elements.confirm.focus();
    return;
  }

  setButtonBusy(submit, true, 'O‘chirilmoqda…');
  try {
    await api('/api/account', {
      method: 'DELETE',
      body: { password, confirm },
    });
    closeModal({ restoreFocus: false });
    disconnectStream();
    app.data = null;
    showAuth();
    toast(
      'Akkaunt o‘chirildi',
      'Barcha shaxsiy izlaringiz tozalandi. Yana ko‘rishguncha.',
      'info',
    );
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    showFormError(errorElement, error.message);
  } finally {
    setButtonBusy(submit, false);
  }
}

/* --------------------------------------------------------------------------
   Tugmalar orqali bajariladigan amallar
   -------------------------------------------------------------------------- */

async function confirmTaskComplete(button) {
  const taskId = button.dataset.taskId;
  const task = app.data?.tasks.find((item) => item.id === taskId);
  if (!task) {
    closeModal({ restoreFocus: false });
    toast('Vazifa topilmadi', 'Oqim yangilangan. Qayta urinib ko‘ring.', 'error');
    return;
  }

  setButtonBusy(button, true, 'Saqlanmoqda…');
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST' });
    closeModal({ restoreFocus: false });
    heartBurst();
    toast('Yana bir g‘alaba!', `“${task.title}” — +1 ball hisobingizda.`, 'success');
    await refreshState({ silent: true });
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    if (error.status === 409) {
      closeModal({ restoreFocus: false });
      await refreshState({ silent: true });
      toast('Afsus, sizdan tezroq bo‘lishdi', 'Bu vazifani boshqa yurak birinchi bo‘lib bajardi. Yangisini sinab ko‘ring.', 'info');
    } else {
      toast('Bajara olmadik', error.message, 'error');
      setButtonBusy(button, false);
    }
  }
}

async function confirmTaskDelete(button) {
  const taskId = button.dataset.taskId;
  const task = app.data?.tasks.find((item) => item.id === taskId);
  setButtonBusy(button, true, 'O‘chirilmoqda…');
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    closeModal({ restoreFocus: false });
    toast('Vazifa o‘chirildi', task ? `“${task.title}” oqimdan olib tashlandi.` : '', 'info');
    await refreshState({ silent: true });
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    closeModal({ restoreFocus: false });
    await refreshState({ silent: true });
    toast('Vazifani o‘chirib bo‘lmadi', error.message, 'error');
  }
}

function handleAction(node) {
  const action = node.dataset.action;
  if (!action) return;

  if (action === 'set-filter') {
    app.filter = node.dataset.filter || 'active';
    renderApp();
    return;
  }

  if (action === 'go-mine') {
    app.filter = 'mine';
    if (app.route.name !== 'board') navigate('board');
    else renderApp();
    return;
  }

  if (action === 'open-create') {
    if (!app.data) return;
    openCreateDialog({
      targetId: node.dataset.targetId || null,
      mode: node.dataset.createMode || null,
    });
    return;
  }

  if (action === 'complete-task') {
    openCompleteDialog(node.dataset.taskId);
    return;
  }

  if (action === 'confirm-complete') {
    confirmTaskComplete(node);
    return;
  }

  if (action === 'delete-task') {
    openDeleteTaskDialog(node.dataset.taskId);
    return;
  }

  if (action === 'confirm-delete-task') {
    confirmTaskDelete(node);
    return;
  }

  if (action === 'edit-profile') {
    openEditProfileDialog();
    return;
  }

  if (action === 'delete-account') {
    openDeleteAccountDialog();
    return;
  }

  if (action === 'copy-invite') {
    copyInvite();
    return;
  }

  if (action === 'logout') {
    handleLogout();
  }
}

/* --------------------------------------------------------------------------
   Hodisalar
   -------------------------------------------------------------------------- */

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const passwordToggle = target.closest('[data-toggle-password]');
  if (passwordToggle) {
    event.preventDefault();
    const shell = passwordToggle.closest('.input-shell');
    const input = shell?.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', show ? 'Parolni yashirish' : 'Parolni ko‘rsatish');
    const use = passwordToggle.querySelector('use');
    use?.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
    return;
  }

  const authModeButton = target.closest('[data-auth-mode]');
  if (authModeButton && !app.data) {
    event.preventDefault();
    setAuthMode(authModeButton.dataset.authMode);
    return;
  }

  const actionNode = target.closest('[data-action]');
  if (actionNode && app.data) {
    event.preventDefault();
    handleAction(actionNode);
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === 'authForm') {
    event.preventDefault();
    handleAuthSubmit(form);
    return;
  }

  if (form.id === 'createTaskForm') {
    event.preventDefault();
    handleCreateTaskSubmit(form);
    return;
  }

  if (form.id === 'editProfileForm') {
    event.preventDefault();
    handleEditProfileSubmit(form);
    return;
  }

  if (form.id === 'deleteAccountForm') {
    event.preventDefault();
    handleDeleteAccountSubmit(form);
    return;
  }
}

function handleDocumentInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (dom.authForm.contains(target) && !dom.authError.hidden) {
    clearAuthError();
  }

  const form = target.closest('form');
  if (!form) return;
  const errorElement = form.querySelector('[data-form-error]');
  if (errorElement && !errorElement.hidden) {
    showFormError(errorElement, '');
  }
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('submit', handleDocumentSubmit);
  document.addEventListener('input', handleDocumentInput);
  window.addEventListener('hashchange', handleRouteChange);

  // Chat form and input delegation
  document.addEventListener('submit', (event) => {
    if (event.target.matches('[data-chat-form]')) {
      event.preventDefault();
      handleChatFormSubmit(event);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-chat-input]')) {
      handleChatInput(event);
    }
  });

  window.addEventListener('offline', () => {
    if (app.data) setStreamStatus(false, 'oflayn');
  });

  window.addEventListener('online', () => {
    if (!app.data) return;
    setStreamStatus(false, 'qayta ulanish');
    connectStream();
    refreshState({ silent: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.data) {
      refreshState({ silent: true });
    }
  });
}

/* --------------------------------------------------------------------------
   Boshlanish
   -------------------------------------------------------------------------- */

async function boot() {
  setAuthMode('login');
  bindEvents();

  try {
    const data = await api('/api/state', { allow401: true });
    if (!data) {
      showAuth();
      return;
    }

    app.data = data;
    if (!location.hash || location.hash === '#/kirish') {
      history.replaceState(null, '', '#/board');
    }
    app.route = parseRoute();
    dom.bootScreen.hidden = true;
    dom.authScreen.hidden = true;
    dom.appScreen.hidden = false;
    renderApp();
    connectStream();
  } catch (error) {
    showAuth();
    if (error.status === 0) {
      toast('Server bilan aloqa yo‘q', 'Internet aloqasini tekshirib, sahifani yangilang.', 'error');
    }
  } finally {
    hideBoot();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
