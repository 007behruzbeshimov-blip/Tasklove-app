'use strict';

/* --------------------------------------------------------------------------
   tasklove. — modal oynalari
   -------------------------------------------------------------------------- */

function openCreateDialog({ targetId = null, mode = null } = {}) {
  const me = currentUser();
  if (!me) return;

  const others = app.data.users.filter((user) => user.id !== me.id);
  const usableTarget = targetId && others.some((user) => user.id === targetId)
    ? targetId
    : null;

  if (!others.length) {
    openModal({
      title: 'Hali bog‘da yolg‘izsiz.',
      eyebrow: 'Birinchi qadam',
      intro: 'Vazifa tashlash uchun kamida yana bitta yurak kerak. Do‘stingizni taklif qiling — keyin o‘yin boshlanadi.',
      size: 'modal--narrow',
      body: `
        <div class="create-unavailable">
          ${icon('users')}
          <h3>Birga o‘ynash qiziqroq.</h3>
          <p>Quyidagi havolani do‘stingizga yuboring. U ro‘yxatdan o‘tgach, unga kichik vazifalar tashlashingiz mumkin bo‘ladi.</p>
          <button class="button button--ink button--small" type="button" data-action="copy-invite">${icon('copy')} Havolani nusxalash</button>
        </div>
      `,
      footer: `<button class="button button--ghost" type="button" data-close-modal>Yopish</button>`,
    });
    return;
  }

  const validModes = ['solo', 'shared', 'open'];
  let initialMode = validModes.includes(mode) ? mode : 'solo';
  if (mode && !validModes.includes(mode)) initialMode = 'solo';

  let selected = new Set(usableTarget ? [usableTarget] : []);
  if (initialMode === 'open') selected = new Set();
  if ((initialMode === 'solo' || initialMode === 'shared') && selected.size === 0) {
    selected = new Set([others[0].id]);
  }

  const orderedOthers = [...others].sort((a, b) => a.display_name.localeCompare(b.display_name, 'uz'));

  const modeChoice = (value) => {
    const meta = modeMeta(value);
    const iconName = value === 'solo' ? 'lock' : value === 'shared' ? 'users' : 'globe';
    return `
      <label class="mode-choice">
        <input type="radio" name="mode" value="${value}" ${value === initialMode ? 'checked' : ''}>
        <span class="mode-choice-body">
          <span class="mode-choice-icon">${icon(iconName)}</span>
          <strong>${esc(meta.label)}</strong>
          <p>${esc(meta.description)}</p>
          <span class="mode-choice-tag">${esc(meta.tag)}</span>
        </span>
      </label>
    `;
  };

  const categoryChoice = (value) => {
    const meta = categoryMeta(value);
    return `
      <label class="choice-chip">
        <input type="radio" name="category" value="${value}" ${value === 'other' ? 'checked' : ''}>
        <span>${meta.emoji} ${esc(meta.label)}</span>
      </label>
    `;
  };

  const formBody = `
    <form id="createTaskForm" class="create-form" novalidate>
      <div class="form-grid">
        <div class="form-field field-full">
          <div class="form-label-row">
            <label for="taskTitle">Vazifa nomi</label>
            <span class="form-label-hint">3–100 belgi</span>
          </div>
          <input id="taskTitle" name="title" type="text" maxlength="100" placeholder="Masalan, birgalikda quyosh chiqishini tomosha qilish" required autofocus autocomplete="off">
        </div>

        <div class="form-field field-full">
          <div class="form-label-row">
            <label for="taskDescription">Kichik izoh</label>
            <span class="form-label-hint">ixtiyoriy</span>
          </div>
          <textarea id="taskDescription" name="description" maxlength="600" placeholder="Nima qilish kerak? Kichik bir tafsilot qo‘shing…"></textarea>
        </div>

        <fieldset class="mode-fieldset field-full">
          <legend class="form-label">Kim uchun va qanday?</legend>
          <div class="mode-grid">
            ${modeChoice('solo')}
            ${modeChoice('shared')}
            ${modeChoice('open')}
          </div>
        </fieldset>

        <div class="field-full" data-participants-wrap></div>

        <div class="field-half">
          <span class="form-label" style="display:block;margin-bottom:8px">Kichik bo‘lim</span>
          <div class="choice-chips" id="taskCategories">
            ${Object.keys(CATEGORY_META).map(categoryChoice).join('')}
          </div>
        </div>

        <div class="form-field field-half">
          <div class="form-label-row">
            <label for="taskDue">Muddat</label>
            <span class="form-label-hint">ixtiyoriy</span>
          </div>
          <input id="taskDue" name="due_date" type="date" min="${localToday()}">
        </div>

        <div class="field-full">
          <div class="prize-banner">
            <span class="ball-coin">+1</span>
            <span><strong>Birinchi bo‘lib bajargan 1 ball oladi.</strong> Shaxsiy vazifada yakka o‘yinchi, birgalikda esa poyga bo‘ladi. O‘z vazifangizni o‘zingiz bajara olmaysiz.</span>
          </div>
        </div>

        <p class="form-error create-error field-full" data-form-error hidden></p>
      </div>
    </form>
  `;

  openModal({
    title: 'Yangi vazifa tashlang.',
    eyebrow: 'Kichik bir ish, katta bir his',
    intro: 'Kimningdir kuniga kichik bir quvonch qo‘shing. Vazifa manzili va kim birinchi bo‘lishini siz tanlaysiz.',
    size: 'modal--wide',
    body: formBody,
    footer: `
      <button class="button button--ghost" type="button" data-close-modal>Bekor qilish</button>
      <button class="button button--primary" type="submit" form="createTaskForm" id="createTaskSubmit">
        <span>Vazifani tashlash</span>
        ${icon('send')}
      </button>
    `,
    onMount: (layer) => {
      const form = layer.querySelector('#createTaskForm');
      const participantsWrap = layer.querySelector('[data-participants-wrap]');

      const currentMode = () => form.querySelector('input[name="mode"]:checked')?.value || 'solo';
      const selectedFromDom = () => new Set(
        [...form.querySelectorAll('input[name="participant"]:checked')].map((input) => input.value),
      );

      function participantsHtml(modeValue) {
        if (modeValue === 'open') {
          return `
            <div class="audience-note">
              ${icon('globe')}
              <span><strong>Hamma uchun ochiq.</strong> Sizdan boshqa barcha foydalanuvchilar bu vazifani bajarishi mumkin. Birinchi bo‘lgan 1 ball oladi.</span>
            </div>
          `;
        }

        const single = modeValue === 'solo';
        const selectedCount = selected.size;
        return `
          <div class="participants-block">
            <div class="participants-head">
              <strong>${single ? 'Kim bajaradi?' : 'Kimlar ishtirok etadi?'}</strong>
              <span data-selected-count>${selectedCount} ta tanlandi</span>
            </div>
            <div class="person-picker">
              ${orderedOthers.map((user) => `
                <label class="picker-person">
                  <input type="${single ? 'radio' : 'checkbox'}" name="participant" value="${esc(user.id)}" ${selected.has(user.id) ? 'checked' : ''}>
                  ${avatarHtml(user, 'sm')}
                  <span class="picker-info">
                    <strong>${esc(user.display_name)}</strong>
                    <span>@${esc(user.username)}</span>
                  </span>
                  <span class="picker-check">${icon('check')}</span>
                </label>
              `).join('')}
            </div>
            <p class="participants-hint">${single
              ? 'Shaxsiy vazifani faqat tanlangan yurak bajaradi.'
              : 'Tanlangan yuraklar orasida poyga. Birinchi bo‘lib bajarganingiz muhim!'}</p>
          </div>
        `;
      }

      function paintParticipants() {
        participantsWrap.innerHTML = participantsHtml(currentMode());
      }

      paintParticipants();

      form.addEventListener('change', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;

        if (input.name === 'mode') {
          const nextMode = input.value;
          const currentlySelected = selectedFromDom();
          if (nextMode === 'open') {
            selected = new Set();
          } else if (nextMode === 'solo') {
            const first = [...currentlySelected][0] || usableTarget || orderedOthers[0]?.id;
            selected = new Set(first ? [first] : []);
          } else {
            selected = currentlySelected.size
              ? currentlySelected
              : new Set([usableTarget || orderedOthers[0]?.id].filter(Boolean));
          }
          paintParticipants();
          return;
        }

        if (input.name === 'participant') {
          selected = selectedFromDom();
          const count = participantsWrap.querySelector('[data-selected-count]');
          if (count) count.textContent = `${selected.size} ta tanlandi`;
        }
      });
    },
  });
}

function openCompleteDialog(taskId) {
  const task = app.data.tasks.find((item) => item.id === taskId);
  if (!task) {
    toast('Vazifa topilmadi', 'Oqim yangilangan bo‘lishi mumkin.', 'error');
    return;
  }
  if (task.status !== 'active' || !task.can_complete) {
    toast('Bu vazifa endi mavjud emas', 'Kimdir sizdan tezroq bo‘lgan bo‘lishi mumkin.', 'info');
    return;
  }

  const mode = modeMeta(task.mode);
  const category = categoryMeta(task.category);
  openModal({
    title: 'Vazifa bajarildi deb belgilansinmi?',
    eyebrow: mode.label,
    intro: 'Bir daqiqa. Bu qaytarib bo‘lmaydigan kichik qadam.',
    body: `
      <div class="confirm-task">
        <p class="eyebrow">${category.emoji} ${esc(category.label)}</p>
        <h3>${esc(task.title)}</h3>
        <p>${esc(task.creator.display_name)} tashlagan vazifa${task.due_date ? ` · muddat ${esc(dueLabel(task.due_date).toLowerCase())}` : ''}</p>
        ${task.description ? `<p style="margin-top:7px">${esc(task.description)}</p>` : ''}
      </div>
      <div class="confirm-prize">
        <span class="ball-coin">+1</span>
        <div class="confirm-prize-copy">
          <strong>Bir ball sizning hisobingizga qo‘shiladi.</strong>
          <span>Va bu g‘alaba profilingizda abadiy qoladi.</span>
        </div>
      </div>
      <p class="confirm-warning">
        ${icon('clock')}
        <span>${task.mode === 'solo'
          ? 'Bu shaxsiy vazifa. Tasdiqlaganingizdan keyin yakunlangan deb belgilanadi.'
          : 'Birgalikdagi vazifada poyga bor. Tasdiqlaganingizda vazifa yopiladi va boshqalar bajarolmaydi.'}</span>
      </p>
    `,
    footer: `
      <button class="button button--ghost" type="button" data-close-modal>Bekor qilish</button>
      <button class="button button--primary" type="button" id="confirmCompleteButton" data-action="confirm-complete" data-task-id="${esc(task.id)}">
        Ha, bajardim ${icon('check')}
      </button>
    `,
  });
}

function openDeleteTaskDialog(taskId) {
  const task = app.data.tasks.find((item) => item.id === taskId);
  if (!task) {
    toast('Vazifa topilmadi', 'Oqim yangilangan bo‘lishi mumkin.', 'error');
    return;
  }
  if (!task.can_delete) {
    toast('Bu vazifani o‘chirib bo‘lmaydi', 'Bajarilgan vazifalar tarix uchun saqlanadi.', 'info');
    return;
  }

  openModal({
    title: 'Vazifa o‘chirilsinmi?',
    eyebrow: 'Tashlab yuborilgan reja',
    intro: 'Bu vazifa oqimdan butunlay olib tashlanadi.',
    size: 'modal--narrow',
    body: `
      <div class="confirm-task">
        <p class="eyebrow">${esc(modeMeta(task.mode).label)}</p>
        <h3>${esc(task.title)}</h3>
        <p>U hali bajarilmagan. O‘chirish bilan u boshqa foydalanuvchilarga ham ko‘rinmaydi.</p>
      </div>
      <p class="confirm-warning">${icon('alert')} <span>Allaqachon bajarilgan vazifalarni o‘chirish mumkin emas — ular tarixda qoladi.</span></p>
    `,
    footer: `
      <button class="button button--ghost" type="button" data-close-modal>Qoldirish</button>
      <button class="button button--danger" type="button" id="confirmDeleteTaskButton" data-action="confirm-delete-task" data-task-id="${esc(task.id)}">
        ${icon('trash')} O‘chirish
      </button>
    `,
  });
}

function openEditProfileDialog() {
  const me = currentUser();
  if (!me) return;

  const emojiChoices = AVATAR_EMOJIS.map((emoji) => `
    <label class="emoji-option" title="${esc(emoji)}">
      <input type="radio" name="emoji" value="${esc(emoji)}" ${emoji === me.emoji ? 'checked' : ''}>
      <span>${esc(emoji)}</span>
    </label>
  `).join('');

  const colorChoices = AVATAR_COLORS.map((color) => `
    <label class="color-option" title="${esc(color)}">
      <input type="radio" name="accent" value="${esc(color)}" ${color === me.accent ? 'checked' : ''}>
      <span style="--color:${safeAccent(color)}"></span>
    </label>
  `).join('');

  openModal({
    title: 'Profilingizni yangilang.',
    eyebrow: 'O‘zingizni ko‘rsating',
    intro: 'Ismingiz, bio va avatar rangingiz boshqa yuraklarga qanday ko‘rinishini tanlang.',
    size: 'modal--wide',
    body: `
      <form id="editProfileForm" class="edit-profile-form" novalidate>
        <div class="edit-preview" data-edit-preview></div>

        <div class="form-row">
          <div class="form-field">
            <div class="form-label-row">
              <label for="profileName">Ismingiz</label>
              <span class="form-label-hint">2–40 belgi</span>
            </div>
            <input id="profileName" name="display_name" type="text" maxlength="40" value="${esc(me.display_name)}" required autofocus>
          </div>
          <div class="form-field">
            <label for="profileUsername">Taxallusingiz</label>
            <input id="profileUsername" type="text" value="@${esc(me.username)}" disabled>
            <p class="form-hint">Taxallus o‘zgarmaydi.</p>
          </div>
        </div>

        <div class="form-field">
          <div class="form-label-row">
            <label for="profileBio">O‘zingiz haqingizda</label>
            <span class="form-label-hint">180 belgigacha</span>
          </div>
          <textarea id="profileBio" name="bio" maxlength="180" placeholder="Biror shirin gap yozib qoldiring…">${esc(me.bio)}</textarea>
        </div>

        <div>
          <span class="edit-choice-label">Avatar belgisi</span>
          <div class="emoji-grid">${emojiChoices}</div>
        </div>

        <div>
          <span class="edit-choice-label">Yurak rangi</span>
          <div class="color-grid">${colorChoices}</div>
        </div>

        <p class="form-error" data-form-error hidden></p>
      </form>
    `,
    footer: `
      <button class="button button--ghost" type="button" data-close-modal>Bekor qilish</button>
      <button class="button button--primary" type="submit" form="editProfileForm" id="editProfileSubmit">
        Saqlash ${icon('check')}
      </button>
    `,
    onMount: (layer) => {
      const form = layer.querySelector('#editProfileForm');
      const preview = layer.querySelector('[data-edit-preview]');

      const refreshPreview = () => {
        const name = form.elements.display_name.value.trim() || 'Ismsiz yurak';
        const emoji = form.querySelector('input[name="emoji"]:checked')?.value || me.emoji;
        const accent = form.querySelector('input[name="accent"]:checked')?.value || me.accent;
        preview.innerHTML = `
          ${avatarHtml({ emoji, accent }, 'md')}
          <div class="edit-preview-copy">
            <strong>${esc(name)}</strong>
            <span>@${esc(me.username)}</span>
          </div>
        `;
      };

      refreshPreview();
      form.addEventListener('input', (event) => {
        if (event.target.name === 'display_name') refreshPreview();
      });
      form.addEventListener('change', refreshPreview);
    },
  });
}

function openDeleteAccountDialog() {
  const me = currentUser();
  if (!me) return;

  openModal({
    title: 'Akkauntni butunlay o‘chirasizmi?',
    eyebrow: 'Xavfli qadam',
    intro: 'Bu amalni ortga qaytarib bo‘lmaydi. Iltimos, niyatingiz jiddiy ekaniga ishonch hosil qiling.',
    size: 'modal--narrow',
    body: `
      <form id="deleteAccountForm" class="delete-account-form" novalidate>
        <div class="danger-illustration">
          <span class="danger-illustration-icon">${icon('trash')}</span>
          <div>
            <strong>Bu butunlay o‘chiriladi</strong>
            <p>Profilingiz, sevgi hisobingiz, siz tashlagan barcha faol vazifalar va bu saytdagi shaxsiy izlaringiz.</p>
          </div>
        </div>

        <ul class="delete-warning">
          <li>Profil va ballaringiz boshqa hech kimga ko‘rinmaydi.</li>
          <li>Siz yaratgan faol vazifalar oqimdan o‘chadi.</li>
          <li>Boshqa foydalanuvchilarning sizning vazifalaringizdagi g‘alaba yozuvlari tarix uchun qoladi.</li>
          <li>Qayta kirish yoki parolni tiklashning imkoni yo‘q.</li>
        </ul>

        <div class="form-field">
          <label for="deletePassword">Parolingiz</label>
          <input id="deletePassword" name="password" type="password" autocomplete="current-password" placeholder="Tasdiqlash uchun parolingizni kiriting" required autofocus>
        </div>

        <div class="form-field">
          <label for="deleteConfirm">Tasdiqlash uchun <strong>${esc(me.username)}</strong> yozing</label>
          <input id="deleteConfirm" name="confirm" type="text" autocomplete="off" placeholder="${esc(me.username)}" required spellcheck="false">
        </div>

        <p class="delete-confirm-label">Yozishingiz kerak: <strong>${esc(me.username)}</strong></p>
        <p class="form-error" data-form-error hidden></p>
      </form>
    `,
    footer: `
      <button class="button button--ghost" type="button" data-close-modal>Bekor qilish</button>
      <button class="button button--danger" type="submit" form="deleteAccountForm" id="deleteAccountSubmit">
        ${icon('trash')} Butunlay o‘chirish
      </button>
    `,
  });
}
