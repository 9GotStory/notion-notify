// หน้าวันหยุดราชการ — เพิ่ม/ลบ (ย้ายจากแท็บ "วันหยุด" ของหน้าเดิม)
'use strict';

AdminViews.holidays = {

  TYPES: ['ราชการปกติ', 'ชดเชย', 'กรณีพิเศษ'],
  _isStale: null, // ตัวเช็คจาก app.js — reload/mutation ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML =
      UI.pageHeader('จัดการปฏิทิน', 'วันหยุด', 'เพิ่มและตรวจทานวันหยุดที่ใช้คำนวณวันทำการของระบบลา') +
      '<div class="ui-card ui-card-body mb-4">' +
      '<p class="ui-section-title mb-3">เพิ่มวันหยุด</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><span class="ui-label">วันที่</span><div class="relative">' +
      '<button id="hdDateTrigger" type="button" aria-haspopup="dialog" aria-controls="hdDate" class="ui-field flex cursor-pointer items-center justify-between text-left">' +
      '<span id="hdDateDisplay">— เลือกวันที่ —</span>' +
      '<span class="text-xs font-semibold text-brand" aria-hidden="true">เลือก</span></button>' +
      '<input id="hdDate" type="date" aria-label="วันที่" tabindex="-1" class="absolute inset-0 h-full w-full opacity-0 pointer-events-none"></div></div>' +
      '<div><label for="hdType" class="ui-label">ประเภท</label>' +
      '<select id="hdType" class="ui-field">' +
      this.TYPES.map(t => '<option value="' + t + '">' + t + '</option>').join('') +
      '</select></div>' +
      '<div class="sm:col-span-2"><label for="hdName" class="ui-label">ชื่อวันหยุด</label>' +
      '<input id="hdName" type="text" maxlength="120" placeholder="เช่น วันสงกรานต์" class="ui-field"></div>' +
      '</div>' +
      '<button id="hdAddBtn" type="button" class="ui-btn-primary mt-3 w-full sm:w-auto">เพิ่มวันหยุด</button>' +
      '<p class="ui-help">ตรวจทานกับประกาศวันหยุดราชการจากหน่วยงานเจ้าของประกาศทุกต้นปี</p>' +
      '</div>' +

      '<div class="ui-card overflow-hidden">' +
      '<div id="hdCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<table class="ui-data-table hidden sm:table"><thead>' +
      '<tr><th class="px-4 py-2.5">วันที่</th><th class="px-4 py-2.5">ชื่อวันหยุด</th><th class="px-4 py-2.5">ประเภท</th><th class="min-w-[132px] whitespace-nowrap px-4 py-2.5 text-right">การทำงาน</th></tr>' +
      '</thead><tbody id="hdBody"></tbody></table>' +
      '<div id="hdEmpty" class="hidden">' + UI.emptyState('ยังไม่มีวันหยุดในระบบ', 'เพิ่มวันหยุดรายการแรกจากแบบฟอร์มด้านบน') + '</div>' +
      '</div>';

    UI.$('hdAddBtn').addEventListener('click', () => this.add());
    UI.$('hdDateTrigger').addEventListener('click', () => this.openDatePicker_());
    UI.$('hdDate').addEventListener('change', () => this.refreshDateDisplay_());
    this.refreshDateDisplay_();
    await this.reload();
  },

  refreshDateDisplay_() {
    const input = UI.$('hdDate');
    const display = UI.$('hdDateDisplay');
    if (!input || !display) return;
    display.textContent = input.value ? UI.formatThaiDate(input.value) : '— เลือกวันที่ —';
  },

  openDatePicker_() {
    const input = UI.$('hdDate');
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch (_) {
        // บาง webview ไม่อนุญาต showPicker — ใช้ native click ต่อด้านล่าง
      }
    }
    input.focus({ preventScroll: true });
    input.click();
  },

  async reload() {
    const res = await AdminAPI.call('get_holidays');
    if (this._isStale && this._isStale()) return; // หน้าเปลี่ยนระหว่างรอ API — ทิ้งผลเก่า
    const list = (res.holidays || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const body = UI.$('hdBody');
    const cards = UI.$('hdCards');
    if (!body) return; // กันซ้ำซ้อน: element ไม่อยู่แล้ว (เช่นถูกเปลี่ยนหน้าไป)
    const today = UI.todayStr_();
    body.innerHTML = '';
    cards.innerHTML = '';
    UI.$('hdEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach(h => {
      const tr = UI.el('tr');
      if (String(h.date) < today) tr.className = 'opacity-50'; // วันที่ผ่านไปแล้วจางลง
      tr.innerHTML =
        '<td class="px-4 py-2.5 text-xs whitespace-nowrap">' + UI.escapeHtml(UI.formatThaiDate(h.date)) + '</td>' +
        '<td class="px-4 py-2.5">' + UI.escapeHtml(h.name) + '</td>' +
        '<td class="px-4 py-2.5 text-slate-500 text-xs">' + UI.escapeHtml(h.type) + '</td>';
      const td = UI.el('td', 'whitespace-nowrap px-4 py-2.5 text-right');
      td.appendChild(this.deleteButton_(h, 'ui-btn-danger whitespace-nowrap px-3'));
      tr.appendChild(td);
      body.appendChild(tr);

      const card = UI.el('article', 'p-4' + (String(h.date) < today ? ' opacity-60' : ''));
      card.innerHTML =
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0"><p class="font-semibold text-text break-words">' + UI.escapeHtml(h.name) + '</p>' +
          '<p class="mt-1 text-[13px] text-text-muted">' + UI.escapeHtml(UI.formatThaiDate(h.date)) + '</p></div>' +
          '<span class="ui-badge ui-badge-neutral shrink-0">' + UI.escapeHtml(h.type) + '</span>' +
        '</div>';
      card.appendChild(this.deleteButton_(h, 'ui-btn-danger mt-3 w-full whitespace-nowrap'));
      cards.appendChild(card);
    });
  },

  deleteButton_(holiday, className) {
    const button = UI.el('button', className, 'ลบวันหยุด');
    button.type = 'button';
    button.addEventListener('click', async () => {
      const accepted = await UI.confirm({
        title: 'ลบวันหยุดนี้?',
        message: UI.formatThaiDate(holiday.date) + ' — ' + holiday.name + '\nรายการนี้จะไม่ถูกใช้คำนวณวันทำการอีกต่อไป',
        confirmText: 'ลบวันหยุด',
        danger: true,
      });
      if (!accepted) return;
      UI.setBusy(button, true, 'กำลังลบ…');
      try {
        await AdminAPI.call('delete_holiday', { row: holiday.row, version: holiday.version });
        UI.showToast('ลบวันหยุดแล้ว');
        await this.reload(); // โหลดใหม่เสมอ — เลขแถวที่เหลือเปลี่ยนไปแล้ว
      } catch (e) {
        UI.showToast(e.message, true);
      } finally {
        UI.setBusy(button, false);
      }
    });
    return button;
  },

  async add() {
    const btn = UI.$('hdAddBtn');
    const date = UI.$('hdDate').value.trim();
    const name = UI.$('hdName').value.trim();
    const type = UI.$('hdType').value;
    if (!date || !name) { UI.showToast('กรอกวันที่และชื่อวันหยุดให้ครบ', true); return; }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call('add_holiday', { date: date, name: name, type: type });
      UI.$('hdDate').value = '';
      this.refreshDateDisplay_();
      UI.$('hdName').value = '';
      UI.showToast('เพิ่มวันหยุดแล้ว');
      await this.reload();
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },
};
