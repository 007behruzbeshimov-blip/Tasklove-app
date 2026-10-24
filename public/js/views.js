'use strict';

/* --------------------------------------------------------------------------
   tasklove. — sahifalarni chizish
   -------------------------------------------------------------------------- */

function renderApp() {
  if (!app.data) return;
  renderHeader();
  updateNav();
  updatePresenceUI();

  const route = app.route;
  let html = '';
  let title = 'tasklove. — kichik vazifalar, katta hislar';

  if (route.name === 'people') {
    html = renderPeople();
    title = 'Yuraklar bog‘i — tasklove.';
  } else if (route.name === 'profile') {
    const user = route.self ? app.data.me : findUser(route.userId);
    if (user) {
      html = renderProfile(user);
      title = `${user.display_name} — tasklove.`;
    } else {
      html = renderMissingProfile();
      title = 'Yurak topilmadi — tasklove.';
    }
  } else if (route.name === 'chat') {
    html = renderChat();
    title = 'Suhbatlar — tasklove.';
  } else {
    html = renderBoard();
  }

  dom.viewRoot.innerHTML = html;
  document.title = title;
  updatePresenceUI();
  
  // Initialize chat if on chat page
  if (route.name === 'chat') {
    initChat();
  }
}

function renderHeader() {
  const me = currentUser();
  if (!me) return;

  const name = document.querySelector('[data-header-name]');
  const points = document.querySelector('[data-header-points]');
  const headerAvatar = document.querySelector('[data-header-avatar]');
  const mobileAvatar = document.querySelector('[data-mobile-avatar]');
  const headerProfile = document.querySelector('[data-header-profile]');
  const mobileProfile = document.querySelector('[data-mobile-profile]');

  if (name) name.textContent = me.display_name;
  if (points) points.textContent = String(me.points);
  if (headerAvatar) {
    headerAvatar.className = 'avatar avatar--xs';
    headerAvatar.style.setProperty('--accent', safeAccent(me.accent));
    headerAvatar.innerHTML = me.avatar_url
      ? `<img class="avatar-image" src="${esc(me.avatar_url)}" alt="">`
      : `<span class="avatar-emoji">${esc(safeEmoji(me.emoji))}</span>`;
  }
  if (mobileAvatar) {
    mobileAvatar.className = 'avatar avatar--mobile';
    mobileAvatar.style.setProperty('--accent', safeAccent(me.accent));
    mobileAvatar.innerHTML = me.avatar_url
      ? `<img class="avatar-image" src="${esc(me.avatar_url)}" alt="">`
      : `<span class="avatar-emoji">${esc(safeEmoji(me.emoji))}</span>`;
  }
  if (headerProfile) headerProfile.setAttribute('href', '#/me');
  if (mobileProfile) mobileProfile.setAttribute('href', '#/me');
}

function updateNav() {
  const route = app.route;
  let active = 'board';
  if (route.name === 'people') active = 'people';
  else if (route.name === 'profile') active = route.self ? 'me' : 'people';
  else if (route.name === 'chat') active = 'chat';

  document.querySelectorAll('.desktop-nav [data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === active && active !== 'me');
  });
  document.querySelectorAll('.mobile-nav [data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === active);
  });
}

function updatePresenceUI() {
  if (!app.data) return;
  const online = new Set(app.data.onlineUserIds);
  const onlineCount = online.size;

  document.querySelectorAll('[data-online-count]').forEach((node) => {
    node.textContent = String(onlineCount);
  });

  document.querySelectorAll('[data-user-online]').forEach((node) => {
    const isOnline = online.has(node.dataset.userOnline);
    node.classList.toggle('is-online', isOnline);
    const word = node.querySelector('[data-online-word]');
    if (word) word.textContent = isOnline ? 'onlayn' : 'oflayn';
  });

  const faces = document.querySelector('[data-online-faces]');
  if (faces) {
    const onlineUsers = app.data.users.filter((user) => online.has(user.id));
    faces.innerHTML = avatarStackHtml(onlineUsers, 5);
  }

  const onlineCopy = document.querySelector('[data-online-copy]');
  if (onlineCopy) {
    onlineCopy.innerHTML = onlineCopyHtml(onlineCount);
  }
}

function onlineCopyHtml(onlineCount) {
  if (onlineCount <= 1) {
    return 'Hozir faqat siz onlaynsiz. Do‘stingizni chaqiring — birgalikda o‘ynash shirinroq.';
  }
  return `<strong>${onlineCount} ta yurak</strong> hozir shu yerda. Kimdir sizga vazifa tashlagan bo‘lishi mumkin.`;
}

/* --------------------------------------------------------------------------
   Oqim
   -------------------------------------------------------------------------- */

function getFilteredTasks() {
  const tasks = app.data.tasks;
  let filtered = tasks;

  if (app.filter === 'done') {
    filtered = tasks.filter((task) => task.status === 'completed');
    return [...filtered].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  }

  filtered = tasks.filter((task) => task.status === 'active');
  if (app.filter === 'mine') filtered = filtered.filter((task) => task.can_complete);
  if (app.filter === 'shared') filtered = filtered.filter((task) => task.mode === 'shared');
  if (app.filter === 'open') filtered = filtered.filter((task) => task.mode === 'open');

  return [...filtered].sort((a, b) => {
    if (a.can_complete !== b.can_complete) return a.can_complete ? -1 : 1;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

function filterCount(key) {
  const active = app.data.tasks.filter((task) => task.status === 'active');
  if (key === 'done') return app.data.tasks.length - active.length;
  if (key === 'mine') return active.filter((task) => task.can_complete).length;
  if (key === 'shared') return active.filter((task) => task.mode === 'shared').length;
  if (key === 'open') return active.filter((task) => task.mode === 'open').length;
  return active.length;
}

function renderBoard() {
  const me = currentUser();
  const activeTasks = app.data.tasks.filter((task) => task.status === 'active');
  const actionable = activeTasks.filter((task) => task.can_complete);
  const myWins = app.data.completions.filter((item) => item.user_id === me.id);
  const recentWins = myWins.slice(0, 3);
  const onlineUsers = app.data.users.filter((user) => app.data.onlineUserIds.includes(user.id));
  const visible = getFilteredTasks();

  const filters = [
    { key: 'active', label: 'Faol' },
    { key: 'mine', label: 'Menga' },
    { key: 'shared', label: 'Birgalikda' },
    { key: 'open', label: 'Hamma uchun' },
    { key: 'done', label: 'Bajarilgan' },
  ].map((filter) => `
    <button class="filter-chip ${app.filter === filter.key ? 'is-active' : ''}" type="button" data-action="set-filter" data-filter="${filter.key}">
      ${esc(filter.label)}
      <span>${filterCount(filter.key)}</span>
    </button>
  `).join('');

  let intro;
  if (actionable.length > 0) {
    intro = `Sizni <strong>${actionable.length} ta vazifa</strong> kutmoqda. Birinchi bo‘lib bajaring — <strong>1 ball</strong> va yana bitta kichik g‘alaba sizniki bo‘ladi.`;
  } else if (activeTasks.length > 0) {
    intro = 'Bugun hamma band. Siz ham birovga kichik bir yaxshilik tashlab, kunini yorqinroq qilishingiz mumkin.';
  } else {
    intro = 'Hozircha vazifalar yo‘q. Birinchi bo‘lib kimningdir kuniga kichik bir quvonch tashlang.';
  }

  const filterEmpty = emptyTaskState();

  return `
    <section class="view view--board">
      <section class="board-hero">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-line"></span> ${esc(todayLabel())}</p>
          <h1>Salom, <em>${esc(getFirstName(me.display_name))}</em>.<br>Kimning kunini <span class="highlight-word">yorqinroq</span> qilamiz?</h1>
          <p class="hero-lede">${intro}</p>
          <div class="hero-actions">
            <button class="button button--primary" type="button" data-action="open-create">
              <span>Vazifa tashlash</span>
              <span class="button-arrow">${icon('arrow-up-right')}</span>
            </button>
            <a class="button button--ghost" href="#/people">Yuraklarni ko‘rish ${icon('arrow-right')}</a>
          </div>
          <p class="hero-footnote">${icon('heart')} Birinchi bo‘lgan 1 ball oladi. Qolgani — birgalikda o‘tkazilgan vaqt.</p>
        </div>
        <aside class="score-ticket" aria-label="Sizning hisobingiz">
          <span class="ticket-serial">LOVE CLUB · ${esc(String(me.points).padStart(3, '0'))}</span>
          <span class="score-ticket-label">sevgi hisobi</span>
          <div class="score-main">
            <span class="score-number">${me.points}</span>
            <span class="score-unit">ball</span>
          </div>
          <div class="score-divider"></div>
          <div class="score-stats">
            <div class="score-stat">
              <strong>${me.completed_count}</strong>
              <span>g‘alaba</span>
            </div>
            <div class="score-stat">
              <strong>${actionable.length}</strong>
              <span>kutayotgan</span>
            </div>
          </div>
          <span class="ticket-heart" aria-hidden="true">♥</span>
        </aside>
      </section>

      <div class="love-ticker" aria-hidden="true">
        <div class="love-ticker-track">
          <span>BIRINCHI BO‘L</span><span class="ticker-star">✦</span>
          <span class="ticker-ball">+1 BALL</span><span class="ticker-star">✦</span>
          <span>YURAKNI XURSAND QIL</span><span class="ticker-star">✦</span>
          <span>BIRGALIKDA O‘YNA</span><span class="ticker-star">✦</span>
          <span>KICHIK VAZIFALAR</span><span class="ticker-star">✦</span>
          <span class="ticker-ball">KATTA HISLAR</span><span class="ticker-star">✦</span>
          <span>BIRINCHI BO‘L</span><span class="ticker-star">✦</span>
          <span class="ticker-ball">+1 BALL</span><span class="ticker-star">✦</span>
          <span>YURAKNI XURSAND QIL</span><span class="ticker-star">✦</span>
          <span>BIRGALIKDA O‘YNA</span><span class="ticker-star">✦</span>
          <span>KICHIK VAZIFALAR</span><span class="ticker-star">✦</span>
          <span class="ticker-ball">KATTA HISLAR</span><span class="ticker-star">✦</span>
        </div>
      </div>

      <div class="board-grid">
        <section class="feed-column" aria-labelledby="tasksHeading">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Bugungi reja</p>
              <h2 id="tasksHeading">Vazifalar oqimi</h2>
            </div>
            <span class="section-count"><strong>${visible.length}</strong> ta vazifa</span>
          </div>

          <div class="filter-row" role="group" aria-label="Vazifalarni filtrlash">
            ${filters}
          </div>

          <div class="task-list">
            ${visible.length ? visible.map((task) => taskCardHtml(task)).join('') : filterEmpty}
          </div>
        </section>

        <aside class="board-side">
          <section class="side-card side-card--dark online-card">
            <div class="side-card-head">
              <span class="side-label">Hozir shu yerda</span>
              <span class="live-label">live</span>
            </div>
            <div class="online-stack" data-online-faces>
              ${avatarStackHtml(onlineUsers, 5)}
            </div>
            <p class="online-copy" data-online-copy>${onlineCopyHtml(onlineUsers.length)}</p>
          </section>

          <section class="side-card wins-card">
            <div class="side-card-head">
              <span class="side-label">Mening izlarim</span>
              <a class="side-link" href="#/me">Barchasi ↗</a>
            </div>
            ${recentWins.length ? `
              <div class="wins-list">
                ${recentWins.map((win) => `
                  <div class="win-mini">
                    <span class="win-mini-check">${icon('check')}</span>
                    <div class="win-mini-copy">
                      <strong>${esc(win.task_title)}</strong>
                      <span>${esc(timeAgo(win.completed_at))}</span>
                    </div>
                    <span class="win-mini-points">+${win.points}</span>
                  </div>
                `).join('')}
              </div>
            ` : `
              <p class="wins-empty">Hali birinchi g‘alabangiz yo‘q. Oqimdan o‘zingizga mos vazifani tanlang.</p>
              <button class="link-button" type="button" data-action="set-filter" data-filter="mine">Vazifalarni ko‘rish ${icon('arrow-right')}</button>
            `}
          </section>

          <section class="side-card rules-card">
            <div class="side-card-head">
              <span class="side-label">Qanday o‘ynaladi?</span>
            </div>
            <ol class="rules-list">
              <li><span><strong>Tanlang.</strong> Birovga yoki hammaga kichik vazifa tashlang.</span></li>
              <li><span><strong>Birinchi bo‘ling.</strong> Boshqalar tashlagan vazifani birinchi bo‘lib bajaring.</span></li>
              <li><span><strong>Ball yig‘ing.</strong> Har bir g‘alaba uchun +1 ball. Profilingizda tarix qoladi.</span></li>
            </ol>
            <p class="rules-foot">O‘z vazifangizni o‘zingiz bajara olmaysiz. Sevgi ham, o‘yin ham adolatli bo‘lsin.</p>
          </section>
        </aside>
      </div>
    </section>
  `;
}

function emptyTaskState() {
  if (app.filter === 'done') {
    return `
      <div class="empty-state tasks-empty">
        <span class="empty-state-icon">${icon('check')}</span>
        <h3>Hali g‘alabalar yo‘q.</h3>
        <p>Birinchi bo‘lib bajarilgan vazifa shu yerda porlaydi. Ochiq vazifalardan boshlang.</p>
        <button class="button button--primary" type="button" data-action="set-filter" data-filter="active">Faol vazifalarni ko‘rish ${icon('arrow-right')}</button>
      </div>
    `;
  }

  if (app.filter === 'mine') {
    return `
      <div class="empty-state tasks-empty">
        <span class="empty-state-icon">${icon('heart-line')}</span>
        <h3>Hozircha sizga vazifa yo‘q.</h3>
        <p>Do‘stlaringizni taklif qiling yoki boshqalar tashlagan ochiq vazifalardan birini birinchi bo‘lib bajaring.</p>
        <button class="button button--primary" type="button" data-action="set-filter" data-filter="active">Barcha vazifalar ${icon('arrow-right')}</button>
      </div>
    `;
  }

  if (app.filter === 'shared' || app.filter === 'open') {
    return `
      <div class="empty-state tasks-empty">
        <span class="empty-state-icon">${icon(app.filter === 'shared' ? 'users' : 'globe')}</span>
        <h3>${app.filter === 'shared' ? 'Birgalikda hali jimlik.' : 'Ochiq vazifalar yo‘q.'}</h3>
        <p>Birinchi bo‘lib shunday vazifa tashlang. Kim birinchi bajarishini birga tomosha qilamiz.</p>
        <button class="button button--primary" type="button" data-action="open-create" data-create-mode="${app.filter}">Vazifa tashlash ${icon('plus')}</button>
      </div>
    `;
  }

  return `
    <div class="empty-state tasks-empty">
      <span class="empty-state-icon">${icon('sparkle')}</span>
      <h3>Hozircha hech kim vazifa tashlamagan.</h3>
      <p>Birinchi bo‘ling. Kimningdir kunini yorqinroq qiladigan kichik bir vazifa yetarli.</p>
      <button class="button button--primary" type="button" data-action="open-create">Birinchi vazifani tashlash ${icon('plus')}</button>
    </div>
  `;
}

function taskCardHtml(task) {
  const mode = modeMeta(task.mode);
  const category = categoryMeta(task.category);
  const participants = task.participants || [];
  const isCompleted = task.status === 'completed';
  const creator = task.creator;
  const firstParticipant = participants[0] || null;

  let recipientMarkup = '';
  if (task.mode === 'open') {
    recipientMarkup = `
      <span class="route-audience">${icon('globe')} Barcha yuraklar</span>
    `;
  } else if (task.mode === 'solo') {
    recipientMarkup = firstParticipant
      ? `<span class="route-more">${esc(firstParticipant.display_name)} uchun</span>`
      : '<span class="route-more">Yurak tanlanmagan</span>';
  } else {
    recipientMarkup = `${avatarStackHtml(participants, 3)}<span class="route-more">${participants.length} ishtirokchi</span>`;
  }

  const tags = [
    `<span class="task-tag">${category.emoji} ${esc(category.label)}</span>`,
    task.due_date ? `<span class="task-tag">${icon('calendar')} ${esc(dueLabel(task.due_date))}</span>` : '',
    !isCompleted ? `<span class="task-tag task-tag--prize">${task.mode === 'solo' ? '+1 ball' : '1-bajargan +1'}</span>` : '',
  ].filter(Boolean).join('');

  let footer = '';
  if (isCompleted) {
    const completer = task.completer || {
      id: null,
      display_name: 'O‘chirilgan yurak',
      emoji: '🕊️',
      accent: '#8a7770',
    };
    const proofHtml = task.proof_url
      ? `
        <div class="task-proof">
          <a class="task-proof-link" href="${esc(task.proof_url)}" target="_blank" rel="noopener">
            <span class="task-proof-thumb"><img src="${esc(task.proof_url)}" alt="Dalil rasmi" loading="lazy"></span>
            <span>${icon('image')} Dalil rasmi</span>
          </a>
        </div>
      `
      : '';
    footer = `
      <div class="winner-line">
        ${avatarHtml(completer, 'sm')}
        <div class="winner-copy">
          <strong>${esc(completer.display_name)}</strong>
          <span>birinchi bo‘lib bajardi · ${esc(timeAgo(task.completed_at))}</span>
        </div>
      </div>
      ${proofHtml}
      <span class="task-completed-mark">${icon('check')} yakunlangan</span>
    `;
  } else if (task.can_complete) {
    footer = `
      <div class="task-action">
        <button class="button button--complete" type="button" data-action="complete-task" data-task-id="${esc(task.id)}">
          <span>Bajardim</span>
          <span class="prize-pill">+1</span>
        </button>
        <p class="task-action-hint">
          ${task.mode === 'solo'
            ? 'Shaxsiy vazifa. Bajarilishi bilan ball sizniki.'
            : 'Birinchi bo‘lib bajaring — ball va g‘alaba sizniki.'}
        </p>
      </div>
    `;
  } else if (task.is_creator) {
    footer = `
      <span class="task-status-note">${icon('lock')} <strong>Siz tashlagansiz.</strong> Boshqalar bajarishini kuting.</span>
    `;
  } else if (task.mode === 'shared') {
    footer = `
      <span class="task-status-note">${icon('users')} <strong>Faqat ishtirokchilar uchun.</strong> Bu vazifada siz tanlanmagansiz.</span>
    `;
  } else {
    const targetName = firstParticipant ? firstParticipant.display_name : 'boshqa yurak';
    footer = `
      <span class="task-status-note">${icon('lock')} <strong>Shaxsiy vazifa.</strong> Faqat ${esc(targetName)} bajarishi mumkin.</span>
    `;
  }

  const deleteButton = task.can_delete
    ? `<button class="icon-button task-delete" type="button" data-action="delete-task" data-task-id="${esc(task.id)}" title="Vazifani o‘chirish" aria-label="Vazifani o‘chirish">${icon('trash')}</button>`
    : '';

  return `
    <article class="task-card ${isCompleted ? 'is-completed' : ''}" style="--task-accent:${safeAccent(creator.accent)}">
      <div class="task-card-top">
        <span class="mode-badge mode-badge--${esc(task.mode)}">${icon(mode.icon)} ${esc(mode.label)}</span>
        <span class="task-number">${taskSerial(task.id)}</span>
      </div>
      <div class="task-title-row">
        <h3>${esc(task.title)}</h3>
        ${deleteButton}
      </div>
      ${task.description ? `<p class="task-description">${esc(task.description)}</p>` : ''}
      <div class="task-route">
        <div class="route-person">
          ${avatarHtml(creator, 'sm')}
          <div class="route-text">
            <span class="route-label">tashlagan</span>
            <span class="route-name">${esc(creator.display_name)}</span>
          </div>
        </div>
        <span class="route-arrow">${icon('arrow-right')}</span>
        <div class="route-recipients">
          ${recipientMarkup}
        </div>
      </div>
      <div class="task-tags">${tags}</div>
      <div class="task-footer">${footer}</div>
    </article>
  `;
}

/* --------------------------------------------------------------------------
   Yuraklar
   -------------------------------------------------------------------------- */

function renderPeople() {
  const me = currentUser();
  const onlineCount = app.data.onlineUserIds.length;
  const cards = app.data.users.map((user, index) => {
    const rank = index + 1;
    const online = isUserOnline(user.id);
    const isMe = user.id === me.id;
    const points = user.points;
    return `
      <a class="person-card ${isMe ? 'is-me' : ''} ${rank <= 3 && points > 0 ? 'is-top' : ''}"
         href="${profileHref(user.id)}"
         style="--person-accent:${safeAccent(user.accent)}"
         aria-label="${esc(user.display_name)} profili">
        <span class="person-topline">
          <span class="person-rank">${rank === 1 && points > 0 ? icon('crown') : ''} № ${String(rank).padStart(2, '0')}</span>
          ${onlineLabelHtml(user.id)}
        </span>
        <div class="person-main">
          <div class="person-avatar-wrap">
            ${avatarHtml(user, 'lg')}
            ${online ? '<span class="avatar-online" title="Onlayn"></span>' : ''}
            ${isMe ? '<span class="person-you">Siz</span>' : ''}
          </div>
          <h2>${esc(user.display_name)}</h2>
          <span class="person-username">@${esc(user.username)}</span>
          <p class="person-bio">${esc(user.bio || 'Hali o‘zi haqida biror so‘z yozmagan. Sirli yurak.')}</p>
          <div class="person-stats">
            <span class="person-stat"><strong>${points}</strong><span>ball</span></span>
            <span class="person-stat"><strong>${user.completed_count}</strong><span>g‘alaba</span></span>
            <span class="person-open">Profil ${icon('arrow-up-right')}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');

  return `
    <section class="view view--people">
      <header class="people-intro">
        <div class="people-intro-copy">
          <p class="eyebrow"><span class="eyebrow-line"></span> Yuraklar xaritasi</p>
          <h1>Yuraklar <em>bog‘i.</em></h1>
          <p>Har bir profil — kichik bir hikoya. Kimning qanday g‘alabalari borligini ko‘ring, ilhom oling va birovning kuniga kichik bir vazifa tashlang.</p>
        </div>
        <aside class="invite-stub">
          <p class="eyebrow">Birga o‘ynang</p>
          <h3>Do‘stingizni olib keling.</h3>
          <p>Bog‘ qancha boy bo‘lsa, vazifalar shuncha qiziqarli bo‘ladi.</p>
          <button class="link-button" type="button" data-action="copy-invite">Havolani nusxalash ${icon('copy')}</button>
        </aside>
      </header>

      <div class="people-meta">
        <span><strong>${app.data.users.length}</strong> ta yurak bog‘da</span>
        <span class="people-meta-note">${icon('sparkle')} <span data-online-count>${onlineCount}</span> kishi hozir onlayn</span>
      </div>

      <div class="people-grid">
        ${cards}
      </div>

      <p class="people-note">${icon('heart')} Siz ham shu bog‘ning bir qismisiz. Profilingizni oching — u yerda barcha g‘alabalaringiz saqlanadi.</p>
    </section>
  `;
}

/* --------------------------------------------------------------------------
   Profil
   -------------------------------------------------------------------------- */

function renderProfile(user) {
  const me = currentUser();
  const isMe = user.id === me.id;
  const online = isUserOnline(user.id);
  const rank = userRank(user.id);
  const completions = app.data.completions.filter((item) => item.user_id === user.id);
  const activeAssigned = app.data.tasks.filter((task) => (
    task.status === 'active'
    && task.creator.id !== user.id
    && (task.participant_ids || []).includes(user.id)
  ));

  const history = completions.length
    ? completions.map((completion) => {
        const stamp = dateStamp(completion.completed_at);
        const mode = modeMeta(completion.task_mode);
        const category = categoryMeta(completion.task_category);
        const proofHtml = completion.proof_url
          ? `
            <div class="history-proof">
              <a class="history-proof-thumb" href="${esc(completion.proof_url)}" target="_blank" rel="noopener">
                <img src="${esc(completion.proof_url)}" alt="Dalil rasmi" loading="lazy">
              </a>
              <a class="history-proof-link" href="${esc(completion.proof_url)}" target="_blank" rel="noopener">${icon('image')} Dalilni ochish</a>
            </div>
          `
          : '';
        return `
          <article class="history-item">
            <div class="history-date">
              <strong>${esc(stamp.day)}</strong>
              <span>${esc(stamp.month)}</span>
            </div>
            <div class="history-copy">
              <h3>${esc(completion.task_title)}</h3>
              <p>
                <span>${esc(completion.creator_name)} tashlagan</span>
                <span>${category.emoji} ${esc(category.label)}</span>
                <span>${esc(mode.label)}</span>
                <span>${esc(timeAgo(completion.completed_at))}</span>
              </p>
              ${proofHtml}
            </div>
            <span class="history-points">+${completion.points}<small>ball</small></span>
          </article>
        `;
      }).join('')
    : `
      <div class="history-empty">
        ${icon('heart-line')}
        <p>${isMe ? 'Hali birinchi g‘alabangiz yozilmagan. Oqimdan boshlang.' : `${esc(getFirstName(user.display_name))} hali birinchi g‘alabasini yozmagan.`}</p>
        ${isMe
          ? `<button class="button button--tiny button--ghost" type="button" data-action="go-mine" style="margin-top:12px">Menga mos vazifalar ${icon('arrow-right')}</button>`
          : `<button class="button button--tiny button--ghost" type="button" data-action="open-create" data-target-id="${esc(user.id)}" style="margin-top:12px">Vazifa tashlash ${icon('plus')}</button>`}
      </div>
    `;

  const assigned = activeAssigned.length
    ? `<div class="assigned-grid">
        ${activeAssigned.map((task) => `
          <div class="assigned-card">
            <strong>${esc(task.title)}</strong>
            <span>${esc(task.creator.display_name)} tashlagan · ${task.mode === 'solo' ? 'shaxsiy' : 'birgalikda'}</span>
          </div>
        `).join('')}
      </div>`
    : `<p class="assigned-empty">${isMe ? 'Hozircha sizga tashlangan faol vazifa yo‘q.' : 'Hozircha unga tashlangan faol vazifa yo‘q.'}</p>`;

  const actionButtons = isMe
    ? `
      <button class="button button--ink" type="button" data-action="edit-profile">${icon('edit')} Profilni tahrirlash</button>
      <button class="button button--ghost" type="button" data-action="copy-invite">${icon('copy')} Do‘st taklif qilish</button>
    `
    : `
      <button class="button button--ink" type="button" data-action="open-create" data-target-id="${esc(user.id)}">${icon('send')} Vazifa tashlash</button>
      <button class="button button--ghost" type="button" data-action="copy-invite">${icon('copy')} Havolani ulashish</button>
    `;

  const danger = isMe
    ? `
      <section class="danger-zone">
        <div class="danger-copy">
          <p class="eyebrow">Xavfli hudud</p>
          <h2>Akkauntni butunlay o‘chirish</h2>
          <p>Profilingiz, siz yaratgan vazifalar va shaxsiy natijalaringiz o‘chiriladi. Boshqa odamlarning tarixiy g‘alaba yozuvlari saqlanadi. Bu amalni ortga qaytarib bo‘lmaydi.</p>
        </div>
        <button class="button button--danger-ghost" type="button" data-action="delete-account">${icon('trash')} Akkauntni o‘chirish</button>
      </section>
    `
    : '';

  return `
    <section class="view view--profile">
      <a class="back-link" href="#/people">${icon('chevron-left')} Yuraklarga qaytish</a>

      <div class="profile-layout">
        <aside class="profile-passport" style="--profile-accent:${safeAccent(user.accent)}">
          <span class="profile-tape" aria-hidden="true"></span>
          <div class="profile-passport-head">
            <span>${isMe ? 'Sizning yurak daftaringiz' : 'Yurak daftari'} · ${esc(user.username)}</span>
            ${onlineLabelHtml(user.id)}
          </div>

          <div class="profile-avatar-wrap">
            ${avatarHtml(user, 'xl')}
            <span class="profile-avatar-ring" aria-hidden="true"></span>
            ${online ? '<span class="avatar-online" title="Onlayn"></span>' : ''}
          </div>

          <p class="eyebrow profile-eyebrow">${isMe ? 'Bu siz' : `${String(rank).padStart(2, '0')}-o‘rin`}</p>
          <h1>${esc(user.display_name)}</h1>
          <p class="profile-username">@${esc(user.username)}</p>
          <p class="profile-bio">${esc(user.bio || 'Hali o‘zi haqida biror so‘z yozmagan. Balki siri shunda.')}</p>

          <div class="profile-numbers">
            <div class="profile-number">
              <strong>${user.points}</strong>
              <span>ball</span>
            </div>
            <div class="profile-number">
              <strong>${user.completed_count}</strong>
              <span>g‘alaba</span>
            </div>
          </div>

          <dl class="profile-meta">
            <div><dt>Qo‘shilgan</dt><dd>${esc(fullDate(user.created_at))}</dd></div>
            <div><dt>Reyting</dt><dd>#${rank} / ${app.data.users.length}</dd></div>
            <div><dt>Holat</dt><dd>${onlineLabelHtml(user.id)}</dd></div>
            <div><dt>Oxirgi kirish</dt><dd>${lastSeenHtml(user)}</dd></div>
          </dl>

          <div class="profile-actions">
            ${actionButtons}
          </div>

          <p class="passport-note">${isMe ? 'Har bir g‘alaba shu daftarda qoladi.' : 'Kichik vazifalar, katta hislar.'}</p>
        </aside>

        <div class="profile-main">
          <section class="profile-section">
            <div class="profile-section-head">
              <div>
                <p class="eyebrow">Yozib qo‘yilgan g‘alabalar</p>
                <h2>Bajarilgan vazifalar</h2>
              </div>
              <span class="section-count"><strong>${completions.length}</strong> ta</span>
            </div>
            <div class="history-list">
              ${history}
            </div>
          </section>

          <section class="profile-section">
            <div class="profile-section-head">
              <div>
                <p class="eyebrow">Hozir qo‘lda</p>
                <h2>Faol vazifalar</h2>
              </div>
              <span class="section-count"><strong>${activeAssigned.length}</strong> ta</span>
            </div>
            ${assigned}
          </section>

          ${danger}
        </div>
      </div>
    </section>
  `;
}

function renderMissingProfile() {
  return `
    <section class="view profile-not-found">
      <span class="empty-state-icon">${icon('heart-line')}</span>
      <h1>Bu yurak topilmadi.</h1>
      <p>Ehtimol, profil o‘chirilgan yoki manzil biroz xato.</p>
      <a class="button button--primary" href="#/people">Yuraklar bog‘iga qaytish ${icon('arrow-right')}</a>
    </section>
  `;
}

/* --------------------------------------------------------------------------
   Chat / Suhbatlar
   -------------------------------------------------------------------------- */

function renderChat() {
  const me = currentUser();
  const onlineUsers = app.data.onlineUserIds ? new Set(app.data.onlineUserIds) : new Set();
  
  // Chat list HTML
  let chatListHtml = `
    <div class="chat-header">
      <h2>${icon('chat')} Suhbatlar</h2>
      <div class="chat-search">
        ${icon('search')}
        <input type="text" placeholder="Izlash..." data-chat-search>
      </div>
    </div>
    <div class="chat-list" data-chat-list>
      <div class="chat-item is-general ${app.chat?.active === 'general' ? 'is-active' : ''}" data-chat-target="general">
        <div class="chat-item-avatar">
          <span class="avatar avatar--md" style="--accent:#b84a5f" aria-hidden="true">
            <span class="avatar-emoji">${icon('users')}</span>
          </span>
        </div>
        <div class="chat-item-meta">
          <span class="chat-item-name">Umumiy suhbat</span>
          <span class="chat-item-preview">${app.chat?.general?.last_message ? (app.chat.general.last_message.mine ? 'Siz: ' : '') + esc(app.chat.general.last_message.body) : 'Xabarlar yo‘q'}</span>
        </div>
        <span class="chat-item-time">${app.chat?.general?.last_message ? esc(timeAgo(app.chat.general.last_message.created_at)) : ''}</span>
      </div>
      <div class="chat-divider"></div>
      ${(app.chat?.directs || []).map((conv) => {
        const user = conv.user;
        const isOnline = onlineUsers.has(user.id);
        const last = conv.last_message;
        return `
          <a class="chat-item ${app.chat?.active === user.id ? 'is-active' : ''}" data-chat-target="${esc(user.id)}" href="#/chat/${esc(user.id)}">
            <div class="chat-item-avatar">
              ${avatarHtml(user, 'md')}
              ${isOnline ? '<span class="chat-item-online" title="Onlayn"></span>' : ''}
            </div>
            <div class="chat-item-meta">
              <span class="chat-item-name">${esc(user.display_name)}</span>
              <span class="chat-item-preview">${last ? (last.mine ? 'Siz: ' : '') + esc(last.body) : 'Xabarlar yo‘q'}</span>
            </div>
            <span class="chat-item-time">${last ? esc(timeAgo(last.created_at)) : ''}</span>
          </a>
        `;
      }).join('')}
    </div>
  `;

  // Chat thread HTML
  let threadHtml = '';
  const activeTarget = app.chat?.active || 'general';
  const isGeneral = activeTarget === 'general';
  const messages = app.chat?.messages || [];
  const targetUser = isGeneral ? null : (app.chat?.directs || []).find((c) => c.user.id === activeTarget)?.user || null;

  if (!app.chat || app.chat.loading) {
    threadHtml = `
      <div class="chat-thread">
        <div class="chat-thread-header">
          <button class="icon-button chat-sidebar-toggle" type="button" data-action="chat-sidebar-toggle" aria-label="Suhbatlar ro‘yxati">${icon('chevron-left')}</button>
          ${isGeneral ? `
            <div class="chat-thread-avatar">
              <span class="avatar avatar--md" style="--accent:#b84a5f" aria-hidden="true"><span class="avatar-emoji">${icon('users')}</span></span>
            </div>
            <div class="chat-thread-info">
              <span class="chat-thread-title">Umumiy suhbat</span>
              <span class="chat-thread-status">Hammaga ochiq</span>
            </div>
          ` : `
            <div class="chat-thread-avatar">${avatarHtml(targetUser, 'md')}${targetUser && isUserOnline(targetUser.id) ? '<span class="avatar-online" title="Onlayn"></span>' : ''}</div>
            <div class="chat-thread-info">
              <span class="chat-thread-title">${esc(targetUser?.display_name || 'Yuklanmoqda...')}</span>
              <span class="chat-thread-status ${targetUser && isUserOnline(targetUser.id) ? 'online' : ''}">${targetUser && isUserOnline(targetUser.id) ? 'onlayn' : (targetUser ? 'oflayn' : 'yuklanmoqda...')}</span>
            </div>
          `}
        </div>
        <div class="chat-messages">
          <div class="chat-empty-state">
            <span class="icon">${icon(isGeneral ? 'users' : 'chat')}</span>
            <h3>Xabarlar yuklanmoqda...</h3>
          </div>
        </div>
        <form class="chat-composer" data-chat-form>
          <div class="chat-composer-form">
            <div class="chat-composer-input-wrapper">
              <textarea class="chat-composer-input" placeholder="${isGeneral ? 'Hammaga xabar yozing...' : `${esc(targetUser?.display_name || '')}ga xabar yozing...`}" data-chat-input rows="1"></textarea>
            </div>
            <button class="chat-composer-send" type="submit" disabled>${icon('send')}</button>
          </div>
        </form>
      </div>
    `;
  } else if (isGeneral) {
    threadHtml = `
      <div class="chat-thread">
        <div class="chat-thread-header">
          <button class="icon-button chat-sidebar-toggle" type="button" data-action="chat-sidebar-toggle" aria-label="Suhbatlar ro‘yxati">${icon('chevron-left')}</button>
          <div class="chat-thread-avatar">
            <span class="avatar avatar--md" style="--accent:#b84a5f" aria-hidden="true"><span class="avatar-emoji">${icon('users')}</span></span>
          </div>
          <div class="chat-thread-info">
            <span class="chat-thread-title">Umumiy suhbat</span>
            <span class="chat-thread-status">Hammaga ochiq · ${app.data.users.length - 1} ta yurak</span>
          </div>
        </div>
        <div class="chat-messages" data-chat-messages>
          ${messages.length ? messages.map((msg) => renderChatMessage(msg)).join('') : `
            <div class="chat-empty-state">
              <span class="icon">${icon('users')}</span>
              <h3>Hozircha xabarlar yo‘q</h3>
              <p>Birinchi bo‘lib salom bering! Barcha ishtirokchilar ko‘radi.</p>
            </div>
          `}
        </div>
        <form class="chat-composer" data-chat-form>
          <div class="chat-composer-form">
            <div class="chat-composer-input-wrapper">
              <textarea class="chat-composer-input" placeholder="Hammaga xabar yozing..." data-chat-input rows="1"></textarea>
            </div>
            <button class="chat-composer-send" type="submit">${icon('send')}</button>
          </div>
        </form>
      </div>
    `;
  } else if (targetUser) {
    threadHtml = `
      <div class="chat-thread">
        <div class="chat-thread-header">
          <button class="icon-button chat-sidebar-toggle" type="button" data-action="chat-sidebar-toggle" aria-label="Suhbatlar ro‘yxati">${icon('chevron-left')}</button>
          <div class="chat-thread-avatar">${avatarHtml(targetUser, 'md')}${isUserOnline(targetUser.id) ? '<span class="avatar-online" title="Onlayn"></span>' : ''}</div>
          <div class="chat-thread-info">
            <span class="chat-thread-title">${esc(targetUser.display_name)}</span>
            <span class="chat-thread-status ${isUserOnline(targetUser.id) ? 'online' : ''}">${isUserOnline(targetUser.id) ? 'onlayn' : 'oflayn'}</span>
          </div>
        </div>
        <div class="chat-messages" data-chat-messages>
          ${messages.length ? messages.map((msg) => renderChatMessage(msg)).join('') : `
            <div class="chat-empty-state">
              <span class="icon">${icon('chat')}</span>
              <h3>Xabarlar yo‘q</h3>
              <p>Birinchi bo‘lib xabar yuboring.</p>
            </div>
          `}
        </div>
        <form class="chat-composer" data-chat-form>
          <div class="chat-composer-form">
            <div class="chat-composer-input-wrapper">
              <textarea class="chat-composer-input" placeholder="${esc(targetUser.display_name)}ga xabar yozing..." data-chat-input rows="1"></textarea>
            </div>
            <button class="chat-composer-send" type="submit">${icon('send')}</button>
          </div>
        </form>
      </div>
    `;
  } else {
    threadHtml = `
      <div class="chat-thread">
        <div class="chat-empty-state">
          <span class="icon">${icon('chat')}</span>
          <h3>Suhbat topilmadi</h3>
          <p>Chapdan suhbatni tanlang yoki yangi boshlang.</p>
        </div>
      </div>
    `;
  }

  return `
    <section class="view view--chat">
      <div class="chat-page">
        <aside class="chat-sidebar ${app.chatSidebarOpen ? 'is-open' : ''}" data-chat-sidebar>
          ${chatListHtml}
        </aside>
        ${threadHtml}
        <div class="chat-overlay ${app.chatSidebarOpen ? 'is-visible' : ''}" data-chat-overlay></div>
      </div>
    </section>
  `;
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

function lastSeenHtml(user) {
  if (!user.last_seen_at) return '<span class="profile-last-seen">Hali kirmagan</span>';
  const online = isUserOnline(user.id);
  if (online) return '<span class="profile-last-seen online">Hozir onlayn</span>';
  return `<span class="profile-last-seen">Oxirgi marta: ${esc(fullDate(user.last_seen_at))} ${esc(timeAgo(user.last_seen_at).replace(' oldin', ''))}da</span>`;
}
