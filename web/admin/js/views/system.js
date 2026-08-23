// หน้าระบบ — ฟอร์ม Settings (ย้ายจากแท็บ "การตั้งค่า" เดิม) + ประวัติการส่ง (Logs)
'use strict';

AdminViews.system = {

  format: 'text',

  async render(root) {
    root.innerHTML =
      '<div class="bg-white border border-slate-200 rounded-2xl p-5 mb-4">' +
      '<div class="flex items-center justify-between">' +
      '<label for="f-enabled" class="text-sm font-semibold text-slate-500">เปิดใช้งานการแจ้งเตือน</label>' +
      '<label class="relative inline-flex items-center cursor-pointer">' +
      '<input type="checkbox" id="f-enabled" class="sr-only peer">' +
      '<div class="w-11 h-6 bg-slate-300 rounded-full peer-checked:bg-primary transition-colors motion-reduce:transition-none ' +
      'after:content-[\'\'] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full ' +
      'after:h-5 after:w-5 after:transition-transform after:motion-reduce:transition-none peer-checked:after:translate-x-5"></div>' +
      '</label></div>' +
      '</div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl p-5 mb-4 space-y-5">' +
      '<div><label for="f-time" class="block text-sm font-semibold text-slate-500 mb-1.5">เวลาแจ้งเตือนทุกเช้า</label>' +
      '<input type="time" id="f-time" class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm">' +
      '<p class="text-xs text-slate-500 mt-1.5">หลังแก้เวลา ให้กด "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ" ในเมนู Google Sheet</p></div>' +
      '<div><label for="f-calendar" class="block text-sm font-semibold text-slate-500 mb-1.5">Notion Database ID</label>' +
      '<input type="text" id="f-calendar" placeholder="your_notion_database_id" class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono text-xs">' +
      '<p class="text-xs text-slate-500 mt-1.5">เอาจาก URL ของหน้า database ใน Notion (ส่วนก่อนเครื่องหมาย ?) และต้องแชร์ database ให้ integration ก่อน</p></div>' +
      '<div><label for="f-group" class="block text-sm font-semibold text-slate-500 mb-1.5">LINE Group ID</label>' +
      '<input type="text" id="f-group" placeholder="เติมอัตโนมัติหลังตั้งค่า Webhook" class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono text-xs">' +
      '<p class="text-xs text-slate-500 mt-1.5">ปกติระบบเติมให้เองหลังเชิญบอทเข้ากลุ่ม แก้เองตรงนี้ได้ถ้าจำเป็น</p></div>' +
      '<div><label class="block text-sm font-semibold text-slate-500 mb-1.5">รูปแบบข้อความ</label>' +
      '<div id="f-format" class="flex border border-slate-200 rounded-lg overflow-hidden">' +
      '<button type="button" data-value="text" class="format-btn flex-1 py-2.5 text-sm border-r border-slate-200">ข้อความธรรมดา</button>' +
      '<button type="button" data-value="flex" class="format-btn flex-1 py-2.5 text-sm">การ์ด Flex</button>' +
      '</div></div>' +
      '</div>' +

      '<button type="button" id="btnSaveSettings" class="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">บันทึกการตั้งค่า</button>' +
      '<p class="text-xs text-slate-500 mt-3.5">อยากทดสอบส่งจริง เปิด Google Sheet แล้วใช้เมนู "ระบบแจ้งเตือนปฏิทิน &gt; ทดสอบส่งตอนนี้" — หน้านี้ไม่แตะ LINE token โดยตรงเพื่อความปลอดภัย</p>' +

      '<div class="bg-white border border-slate-200 rounded-2xl mt-6 overflow-hidden">' +
      '<p class="text-sm font-semibold text-slate-600 px-4 pt-4 pb-2">ประวัติการส่ง (40 รายการล่าสุด)</p>' +
      '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500">' +
      '<tr><th class="px-4 py-2.5">วันที่</th><th class="px-4 py-2.5">เวลา</th><th class="px-4 py-2.5">สถานะ</th><th class="px-4 py-2.5">รายละเอียด</th></tr>' +
      '</thead><tbody id="logBody" class="divide-y divide-slate-100"></tbody></table></div>' +
      '<p id="logEmpty" class="hidden text-center text-slate-400 text-sm py-8">ยังไม่มีประวัติการทำงาน</p>' +
      '</div>';

    root.querySelectorAll('.format-btn').forEach(btn =>
      btn.addEventListener('click', () => this.setFormat(btn.dataset.value)));
    UI.$('btnSaveSettings').addEventListener('click', () => this.save());

    const [settingsRes, logsRes] = await Promise.all([
      AdminAPI.call('get_settings'),
      AdminAPI.call('get_logs', { limit: 40 }),
    ]);
    this.renderSettings(settingsRes.settings);
    this.renderLogs(logsRes.logs);
  },

  renderSettings(s) {
    s = s || {};
    UI.$('f-enabled').checked = String(s.enabled).toUpperCase() === 'TRUE';
    UI.$('f-time').value = this.normalizeTimeForInput_(s.notify_time);
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
      notion_database_id: UI.$('f-calendar').value.trim(),
      line_group_id: UI.$('f-group').value.trim(),
      message_format: this.format,
    };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.notify_time)) { UI.showToast('เวลาแจ้งเตือนไม่ถูกต้อง', true); return; }
    if (!payload.notion_database_id) { UI.showToast('กรุณาใส่ Notion Database ID', true); return; }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call('save_settings', { data: JSON.stringify(payload) });
      UI.showToast('บันทึกแล้ว — หากเปลี่ยนเวลา ให้ไปอัปเดต Trigger ใน Google Sheet');
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },

  renderLogs(list) {
    const body = UI.$('logBody');
    body.innerHTML = '';
    UI.$('logEmpty').classList.toggle('hidden', (list || []).length > 0);
    (list || []).forEach(l => {
      const tr = UI.el('tr');
      tr.innerHTML =
        '<td class="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(l.date) + '</td>' +
        '<td class="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(l.timestamp) + '</td>' +
        '<td class="px-4 py-2.5"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ' + UI.badgeClasses(l.status) + '">' + UI.escapeHtml(l.status) + '</span></td>' +
        '<td class="px-4 py-2.5">' + UI.escapeHtml(l.detail) + '</td>';
      body.appendChild(tr);
    });
  },
};
