// หน้าระบบ — ฟอร์ม Settings (ย้ายจากแท็บ "การตั้งค่า" เดิม) + ประวัติการส่ง (Logs)
'use strict';

AdminViews.system = {

  format: 'text',
  settingsVersion: '',
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
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

      '<button type="button" id="btnSaveSettings" class="ui-btn-primary w-full sm:w-auto">บันทึกการตั้งค่าระบบ</button>' +
      '<p class="ui-help mt-3.5">อยากทดสอบส่งจริง เปิด Google Sheet แล้วใช้เมนู "ระบบแจ้งเตือนปฏิทิน &gt; ทดสอบส่งตอนนี้" — หน้านี้ไม่แตะ LINE token โดยตรงเพื่อความปลอดภัย</p>' +

      '<div class="ui-card mt-6 overflow-hidden">' +
      '<div class="border-b border-slate-100 px-4 py-3"><p class="ui-section-title">ประวัติการส่ง</p>' +
      '<p class="text-[13px] text-text-muted">40 รายการล่าสุด</p></div>' +
      '<div id="logCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<div class="hidden overflow-x-auto sm:block"><table class="ui-data-table"><thead>' +
      '<tr><th class="px-4 py-2.5">วันที่</th><th class="px-4 py-2.5">เวลา</th><th class="px-4 py-2.5">สถานะ</th><th class="px-4 py-2.5">รายละเอียด</th></tr>' +
      '</thead><tbody id="logBody"></tbody></table></div>' +
      '<div id="logEmpty" class="hidden">' + UI.emptyState('ยังไม่มีประวัติการทำงาน', 'เมื่อระบบเริ่มส่งข้อความ รายการล่าสุดจะแสดงที่นี่') + '</div>' +
      '</div>';

    root.querySelectorAll('.format-btn').forEach(btn =>
      btn.addEventListener('click', () => this.setFormat(btn.dataset.value)));
    UI.$('btnSaveSettings').addEventListener('click', () => this.save());

    const [settingsRes, logsRes] = await Promise.all([
      AdminAPI.call('get_settings'),
      AdminAPI.call('get_logs', { limit: 40 }),
    ]);
    if (isStale()) return; // ผู้ใช้ไปหน้าอื่นแล้ว — หยุดก่อนแตะ DOM
    this.renderSettings(settingsRes.settings);
    this.renderLogs(logsRes.logs);
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

  renderLogs(list) {
    const body = UI.$('logBody');
    if (!body) return; // ตารางไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    body.innerHTML = '';
    const cards = UI.$('logCards');
    cards.innerHTML = '';
    UI.$('logEmpty').classList.toggle('hidden', (list || []).length > 0);
    (list || []).forEach(l => {
      const tr = UI.el('tr');
      tr.innerHTML =
        '<td class="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(UI.formatThaiDate(l.date)) + '</td>' +
        '<td class="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(UI.formatThaiDateTime(l.timestamp)) + '</td>' +
        '<td class="px-4 py-2.5"><span class="' + UI.badgeClasses(l.status) + '">' + UI.escapeHtml(l.status) + '</span></td>' +
        '<td class="px-4 py-2.5">' + UI.escapeHtml(l.detail) + '</td>';
      body.appendChild(tr);

      const card = UI.el('article', 'p-4');
      card.innerHTML =
        '<div class="flex items-start justify-between gap-3">' +
          '<div><p class="font-medium text-text">' + UI.escapeHtml(UI.formatThaiDate(l.date)) + '</p>' +
          '<p class="mt-0.5 text-[13px] text-text-muted">' + UI.escapeHtml(UI.formatThaiDateTime(l.timestamp)) + '</p></div>' +
          '<span class="' + UI.badgeClasses(l.status) + ' shrink-0">' + UI.escapeHtml(l.status) + '</span>' +
        '</div><p class="mt-2 text-sm text-slate-700 break-words">' + UI.escapeHtml(l.detail) + '</p>';
      cards.appendChild(card);
    });
  },
};
