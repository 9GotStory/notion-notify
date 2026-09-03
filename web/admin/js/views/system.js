// หน้าระบบ — ฟอร์ม Settings (ย้ายจากแท็บ "การตั้งค่า" เดิม) + ประวัติการส่ง (Logs)
'use strict';

AdminViews.system = {

  format: 'text',
  settingsVersion: '',
  logPage: 1,
  logPageSize: 15,
  logPagination: { page: 1, pageSize: 15, totalItems: 0, totalPages: 1 },
  _logLoadSeq: 0,
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
    this.logPage = 1;
    const logRequestSeq = ++this._logLoadSeq;
    root.innerHTML =
      UI.pageHeader('ตั้งค่าและตรวจสอบ', 'ระบบ', 'ควบคุมการแจ้งเตือน การเชื่อมต่อ และตรวจประวัติการทำงานล่าสุด') +
      '<div class="ui-card ui-card-body mb-4">' +
      '<div class="flex items-center justify-between">' +
      '<div><label for="f-enabled" class="text-sm font-semibold text-slate-700">เปิดใช้งานการแจ้งเตือน</label>' +
      '<p class="ui-help">ปิดเพื่อหยุดส่งข้อความตามเวลา โดยไม่ลบการตั้งค่าเดิม</p></div>' +
      '<label class="relative inline-flex items-center cursor-pointer">' +
      '<input type="checkbox" id="f-enabled" class="sr-only peer">' +
      '<div class="w-11 h-6 bg-slate-300 rounded-full peer-checked:bg-primary transition-colors motion-reduce:transition-none ' +
      'after:content-[\'\'] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full ' +
      'after:h-5 after:w-5 after:transition-transform after:motion-reduce:transition-none peer-checked:after:translate-x-5"></div>' +
      '</label></div>' +
      '</div>' +

      '<section class="ui-card ui-card-body mb-4 space-y-5" aria-labelledby="systemNotifyTitle">' +
      '<div><p id="systemNotifyTitle" class="ui-section-title">การแจ้งเตือนและการเก็บประวัติ</p></div>' +
      '<div><label for="f-time" class="ui-label">เวลาแจ้งเตือนทุกเช้า</label>' +
      '<input type="time" id="f-time" class="ui-field">' +
      '<p class="ui-help">หลังเปลี่ยนเวลา ให้กดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ" ใน Google Sheet</p></div>' +
      '<div><label for="f-log-retention" class="ui-label">เก็บประวัติ Logs</label>' +
      '<div class="relative"><input type="number" id="f-log-retention" min="30" max="3650" step="1" inputmode="numeric" ' +
      'class="ui-field pr-14"><span class="absolute right-3 top-3 text-sm text-slate-400">วัน</span></div>' +
      '<p class="ui-help">ค่าแนะนำ 90 วัน · ระบบลบรายการเก่าอัตโนมัติวันละครั้ง และไม่ลบ AuditLog หรือ SecurityEvents</p></div>' +
      '<div><label class="ui-label">รูปแบบข้อความ</label>' +
      '<div id="f-format" class="grid grid-cols-2 overflow-hidden rounded-control border border-border">' +
      '<button type="button" data-value="text" class="format-btn min-h-11 border-r border-border px-3 text-sm">ข้อความธรรมดา</button>' +
      '<button type="button" data-value="flex" class="format-btn min-h-11 px-3 text-sm">การ์ด Flex</button>' +
      '</div></div>' +
      '</section>' +

      '<section class="ui-card ui-card-body mb-4 space-y-5" aria-labelledby="systemConnectionTitle">' +
      '<div><p id="systemConnectionTitle" class="ui-section-title">การเชื่อมต่อระบบ</p>' +
      '<p class="ui-help">ค่าเหล่านี้เป็นรหัสอ้างอิง ไม่ใช่ token ลับ</p></div>' +
      '<div><label for="f-calendar" class="ui-label">Notion Database ID</label>' +
      '<input type="text" id="f-calendar" placeholder="your_notion_database_id" class="ui-field font-mono text-xs">' +
      '<p class="ui-help">เอาจาก URL ของหน้า database ใน Notion (ส่วนก่อนเครื่องหมาย ?) และต้องแชร์ database ให้ integration ก่อน</p></div>' +
      '<div><label for="f-group" class="ui-label">LINE Group ID</label>' +
      '<input type="text" id="f-group" placeholder="เติมอัตโนมัติหลังตั้งค่า Webhook" class="ui-field font-mono text-xs">' +
      '<p class="ui-help">ปกติระบบเติมให้เองหลังเชิญบอทเข้ากลุ่ม แก้เองตรงนี้ได้ถ้าจำเป็น</p></div>' +
      '</section>' +

      '<section class="ui-card ui-card-body mb-4 space-y-5" aria-labelledby="systemAdminTitle">' +
      '<div><p id="systemAdminTitle" class="ui-section-title">สิทธิ์ผู้ดูแลระบบ</p>' +
      '<p class="ui-help">ใครอยู่ในรายชื่อนี้ (และผูก LINE กับทำเนียบแล้ว) ล็อกอินหน้านี้ด้วยปุ่ม "เข้าสู่ระบบด้วย LINE" ได้</p></div>' +
      '<div><label for="f-admin-staff" class="ui-label">รายชื่อผู้ดูแล (ชื่อต้น คั่นลูกน้ำ)</label>' +
      '<input type="text" id="f-admin-staff" placeholder="เช่น สมชาย, สมหญิง" class="ui-field">' +
      '<p class="ui-help">เว้นว่าง = ใช้รหัสผู้ดูแล (ADMIN_TOKEN) อย่างเดียว · เพิ่มชื่อแล้วผู้นั้นใช้งานได้ทันที ไม่ต้องแจกรหัส</p></div>' +
      '</section>' +

      '<button type="button" id="btnSaveSettings" class="ui-btn-primary w-full sm:w-auto">บันทึกการตั้งค่าระบบ</button>' +
      '<p class="ui-help mt-3.5">อยากทดสอบส่งจริง เปิด Google Sheet แล้วใช้เมนู "ระบบแจ้งเตือนปฏิทิน &gt; ทดสอบส่งตอนนี้" — หน้านี้ไม่แตะ LINE token โดยตรงเพื่อความปลอดภัย</p>' +

      '<div class="ui-card mt-6 overflow-hidden">' +
      '<div class="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">' +
      '<div><p class="ui-section-title">ประวัติการส่ง</p>' +
      '<p class="text-[13px] text-text-muted">เรียงจากรายการล่าสุด · แบ่งหน้าละ 15 รายการ</p></div>' +
      '<span id="logCount" class="ui-badge ui-badge-neutral shrink-0" aria-live="polite">กำลังโหลด…</span></div>' +
      '<div id="logCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<div class="hidden overflow-x-auto sm:block"><table class="ui-data-table"><thead>' +
      '<tr><th class="px-4 py-2.5">เวลาที่บันทึก</th><th class="px-4 py-2.5">วันที่อ้างอิง</th><th class="px-4 py-2.5">ผลลัพธ์</th><th class="px-4 py-2.5">รายละเอียด</th></tr>' +
      '</thead><tbody id="logBody"></tbody></table></div>' +
      '<div id="logEmpty" class="hidden">' + UI.emptyState('ยังไม่มีประวัติการทำงาน', 'เมื่อระบบเริ่มส่งข้อความ รายการล่าสุดจะแสดงที่นี่') + '</div>' +
      '<div id="logPagination" class="hidden border-t border-slate-100 px-4 py-3">' +
      '<div class="grid grid-cols-1 gap-2 sm:flex sm:items-center sm:justify-between">' +
      '<p id="logPageSummary" class="text-xs text-slate-500" aria-live="polite"></p>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<button id="logPrevBtn" type="button" class="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-medium disabled:opacity-40">ก่อนหน้า</button>' +
      '<button id="logNextBtn" type="button" class="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-medium disabled:opacity-40">ถัดไป</button>' +
      '</div></div></div>' +
      '</div>';

    root.querySelectorAll('.format-btn').forEach(btn =>
      btn.addEventListener('click', () => this.setFormat(btn.dataset.value)));
    UI.$('btnSaveSettings').addEventListener('click', () => this.save());
    UI.$('logPrevBtn').addEventListener('click', () => this.loadLogs_(this.logPage - 1));
    UI.$('logNextBtn').addEventListener('click', () => this.loadLogs_(this.logPage + 1));

    const [settingsRes, logsRes] = await Promise.all([
      AdminAPI.call('get_settings'),
      AdminAPI.call('get_logs', { page: 1, pageSize: this.logPageSize }),
    ]);
    if (isStale() || logRequestSeq !== this._logLoadSeq) return; // ผู้ใช้ไปหน้าอื่นแล้ว — หยุดก่อนแตะ DOM
    this.renderSettings(settingsRes.settings);
    this.renderLogs(logsRes.logs, logsRes.pagination);
  },

  renderSettings(s) {
    if (!UI.$('f-enabled')) return; // ฟอร์มไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    s = s || {};
    this.settingsVersion = s._version || '';
    UI.$('f-enabled').checked = String(s.enabled).toUpperCase() === 'TRUE';
    UI.$('f-time').value = this.normalizeTimeForInput_(s.notify_time);
    UI.$('f-log-retention').value = /^\d+$/.test(String(s.logs_retention_days || '')) ? s.logs_retention_days : '90';
    UI.$('f-calendar').value = s.notion_database_id || '';
    UI.$('f-group').value = s.line_group_id || '';
    UI.$('f-admin-staff').value = s.admin_staff || '';
    this.setFormat(String(s.message_format || 'text').toLowerCase());
  },

  normalizeTimeForInput_(value) {
    const text = String(value == null ? '' : value).trim();
    const match = text.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
    if (!match || Number(match[1]) > 23) return '08:30';
    return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
  },

  setFormat(value) {
    this.format = value === 'flex' ? 'flex' : 'text';
    document.querySelectorAll('.format-btn').forEach(b => {
      const active = b.dataset.value === this.format;
      b.classList.toggle('bg-primary-light', active);
      b.classList.toggle('text-primary-dark', active);
      b.classList.toggle('font-semibold', active);
      b.classList.toggle('text-slate-500', !active);
    });
  },

  async save() {
    const btn = UI.$('btnSaveSettings');
    const payload = {
      enabled: UI.$('f-enabled').checked ? 'TRUE' : 'FALSE',
      notify_time: UI.$('f-time').value,
      logs_retention_days: UI.$('f-log-retention').value.trim(),
      notion_database_id: UI.$('f-calendar').value.trim(),
      line_group_id: UI.$('f-group').value.trim(),
      admin_staff: UI.$('f-admin-staff').value.trim(),
      message_format: this.format,
      _version: this.settingsVersion,
    };
    if (payload.enabled === 'TRUE') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.notify_time)) { UI.showToast('เวลาแจ้งเตือนไม่ถูกต้อง', true); return; }
      if (!payload.notion_database_id) { UI.showToast('กรุณาใส่ Notion Database ID', true); return; }
      if (!payload.line_group_id) { UI.showToast('กรุณาใส่ LINE Group ID', true); return; }
    }
    if (!/^\d+$/.test(payload.logs_retention_days) || Number(payload.logs_retention_days) < 30 ||
        Number(payload.logs_retention_days) > 3650) {
      UI.showToast('จำนวนวันที่เก็บ Logs ต้องอยู่ระหว่าง 30-3650 วัน', true);
      return;
    }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call('save_settings', { data: JSON.stringify(payload) });
      UI.showToast('บันทึกแล้ว — หากเปลี่ยนเวลา ให้ติดตั้ง/อัปเดต trigger ใน Google Sheet');
      await this.render(UI.$('view'), this._isStale);
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },

  async loadLogs_(page) {
    const target = Math.min(Math.max(Number(page) || 1, 1), this.logPagination.totalPages || 1);
    if (target === this.logPage) return;
    const requestSeq = ++this._logLoadSeq;
    this.setLogLoading_(true);
    try {
      const res = await AdminAPI.call('get_logs', { page: target, pageSize: this.logPageSize });
      if ((this._isStale && this._isStale()) || requestSeq !== this._logLoadSeq) return;
      this.renderLogs(res.logs, res.pagination);
    } catch (e) {
      if (!(this._isStale && this._isStale())) UI.showToast(e.message, true);
    } finally {
      if (requestSeq === this._logLoadSeq && !(this._isStale && this._isStale())) {
        this.setLogLoading_(false);
        this.renderLogPagination_();
      }
    }
  },

  setLogLoading_(loading) {
    const pagination = UI.$('logPagination');
    const prev = UI.$('logPrevBtn');
    const next = UI.$('logNextBtn');
    if (pagination) pagination.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (prev) prev.disabled = loading || this.logPage <= 1;
    if (next) next.disabled = loading || this.logPage >= this.logPagination.totalPages;
  },

  renderLogPagination_() {
    const pagination = UI.$('logPagination');
    const summary = UI.$('logPageSummary');
    if (!pagination || !summary) return;
    const p = this.logPagination;
    pagination.classList.toggle('hidden', p.totalItems === 0 || p.totalPages <= 1);
    const start = p.totalItems ? (p.page - 1) * p.pageSize + 1 : 0;
    const end = Math.min(p.totalItems, (p.page - 1) * p.pageSize + this._renderedLogCount);
    summary.textContent = 'รายการ ' + start + '–' + end + ' จาก ' + p.totalItems + ' · หน้า ' + p.page + ' จาก ' + p.totalPages;
    this.setLogLoading_(false);
  },

  logStatusMeta_(status) {
    const raw = String(status || '').trim();
    const value = raw.toLowerCase();
    if (value.includes('error') || value.includes('fail') || value.includes('dead-letter')) {
      return { label: 'ผิดพลาด', badge: 'ui-badge ui-badge-danger', detail: 'text-red-700', raw: raw || 'ไม่ระบุ' };
    }
    if (value.indexOf('success') === 0) {
      return { label: 'สำเร็จ', badge: 'ui-badge ui-badge-success', detail: 'text-slate-700', raw: raw };
    }
    if (value.indexOf('skip') === 0) {
      return { label: 'ข้ามการส่ง', badge: 'ui-badge ui-badge-warning', detail: 'text-slate-700', raw: raw };
    }
    if (value.includes('leave')) {
      return { label: 'รายการลา', badge: 'ui-badge ui-badge-info', detail: 'text-slate-700', raw: raw };
    }
    if (value.includes('schedule')) {
      return { label: 'งานระบบ', badge: 'ui-badge ui-badge-neutral', detail: 'text-slate-700', raw: raw };
    }
    return { label: 'เหตุการณ์', badge: 'ui-badge ui-badge-neutral', detail: 'text-slate-700', raw: raw || 'ไม่ระบุ' };
  },

  logFact_(label, value, mono) {
    return '<div class="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2">' +
      '<p class="text-[11px] text-slate-400">' + label + '</p>' +
      '<p class="mt-0.5 break-words text-xs font-medium text-slate-700' + (mono ? ' font-mono' : '') + '">' +
      UI.escapeHtml(value || '—') + '</p></div>';
  },

  renderLogs(list, pagination) {
    const body = UI.$('logBody');
    if (!body) return; // ตารางไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    list = list || [];
    const fallback = { page: 1, pageSize: this.logPageSize, totalItems: list.length, totalPages: 1 };
    this.logPagination = Object.assign(fallback, pagination || {});
    this.logPage = this.logPagination.page;
    this._renderedLogCount = list.length;
    body.innerHTML = '';
    const cards = UI.$('logCards');
    cards.innerHTML = '';
    UI.$('logEmpty').classList.toggle('hidden', list.length > 0);
    UI.$('logCount').textContent = this.logPagination.totalItems + ' รายการ';
    list.forEach(l => {
      const meta = this.logStatusMeta_(l.status);
      const tr = UI.el('tr');
      tr.innerHTML =
        '<td class="whitespace-nowrap px-4 py-2.5 text-xs font-medium text-slate-700">' + UI.escapeHtml(UI.formatThaiDateTime(l.timestamp) || '—') + '</td>' +
        '<td class="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">' + UI.escapeHtml(UI.formatThaiDate(l.date) || '—') + '</td>' +
        '<td class="px-4 py-2.5"><span class="' + meta.badge + '">' + meta.label + '</span>' +
        '<p class="mt-1 whitespace-nowrap font-mono text-[11px] text-slate-400">' + UI.escapeHtml(meta.raw) + '</p></td>' +
        '<td class="px-4 py-2.5"><p class="max-w-lg break-words text-sm ' + meta.detail + '">' + UI.escapeHtml(l.detail || '—') + '</p></td>';
      body.appendChild(tr);

      const card = UI.el('article', 'p-4');
      card.innerHTML =
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0"><p class="text-[11px] text-text-muted">เวลาที่บันทึก</p>' +
          '<p class="mt-0.5 text-sm font-semibold text-text">' + UI.escapeHtml(UI.formatThaiDateTime(l.timestamp) || '—') + '</p></div>' +
          '<span class="' + meta.badge + ' shrink-0">' + meta.label + '</span>' +
        '</div><div class="mt-3 grid grid-cols-2 gap-2">' +
          this.logFact_('วันที่อ้างอิง', UI.formatThaiDate(l.date), false) +
          this.logFact_('ประเภทเหตุการณ์', meta.raw, true) +
        '</div><div class="mt-3 rounded-control bg-surface-subtle px-3 py-2.5">' +
          '<p class="text-[11px] text-text-muted">รายละเอียด</p>' +
          '<p class="mt-1 break-words text-sm leading-relaxed ' + meta.detail + '">' + UI.escapeHtml(l.detail || '—') + '</p></div>';
      cards.appendChild(card);
    });
    this.renderLogPagination_();
  },
};
