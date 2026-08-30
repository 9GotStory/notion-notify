// หน้าวันหยุดราชการ — เพิ่ม/ลบ (ย้ายจากแท็บ "วันหยุด" ของหน้าเดิม)
'use strict';

AdminViews.holidays = {

  TYPES: ['ราชการปกติ', 'ชดเชย', 'กรณีพิเศษ'],
  _isStale: null, // ตัวเช็คจาก app.js — reload/mutation ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML =
      '<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 mb-3">เพิ่มวันหยุด</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">วันที่</label>' +
      '<input id="hdDate" type="date" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ประเภท</label>' +
      '<select id="hdType" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">' +
      this.TYPES.map(t => '<option value="' + t + '">' + t + '</option>').join('') +
      '</select></div>' +
      '<div class="sm:col-span-2"><label class="block text-xs font-semibold text-slate-500 mb-1.5">ชื่อวันหยุด</label>' +
      '<input id="hdName" type="text" maxlength="120" placeholder="เช่น วันสงกรานต์" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '</div>' +
      '<button id="hdAddBtn" type="button" class="mt-3 h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">เพิ่มวันหยุด</button>' +
      '<p class="text-xs text-slate-400 mt-2">ตรวจทานกับประกาศวันหยุดราชการจากหน่วยงานเจ้าของประกาศทุกต้นปี</p>' +
      '</div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
      '<table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500">' +
      '<tr><th class="px-4 py-2.5">วันที่</th><th class="px-4 py-2.5">ชื่อวันหยุด</th><th class="px-4 py-2.5">ประเภท</th><th class="px-4 py-2.5 w-16"></th></tr>' +
      '</thead><tbody id="hdBody" class="divide-y divide-slate-100"></tbody></table>' +
      '<p id="hdEmpty" class="hidden text-center text-slate-400 text-sm py-8">ยังไม่มีวันหยุดในระบบ</p>' +
      '</div>';

    UI.$('hdAddBtn').addEventListener('click', () => this.add());
    await this.reload();
  },

  async reload() {
    const res = await AdminAPI.call('get_holidays');
    if (this._isStale && this._isStale()) return; // หน้าเปลี่ยนระหว่างรอ API — ทิ้งผลเก่า
    const list = (res.holidays || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const body = UI.$('hdBody');
    if (!body) return; // กันซ้ำซ้อน: element ไม่อยู่แล้ว (เช่นถูกเปลี่ยนหน้าไป)
    const today = UI.todayStr_();
    body.innerHTML = '';
    UI.$('hdEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach(h => {
      const tr = UI.el('tr');
      if (String(h.date) < today) tr.className = 'opacity-50'; // วันที่ผ่านไปแล้วจางลง
      tr.innerHTML =
        '<td class="px-4 py-2.5 font-mono text-xs whitespace-nowrap">' + UI.escapeHtml(h.date) + '</td>' +
        '<td class="px-4 py-2.5">' + UI.escapeHtml(h.name) + '</td>' +
        '<td class="px-4 py-2.5 text-slate-500 text-xs">' + UI.escapeHtml(h.type) + '</td>';
      const td = UI.el('td', 'px-4 py-2.5 text-right');
      const del = UI.el('button', 'text-xs text-red-500 hover:underline', 'ลบ');
      del.addEventListener('click', async () => {
        if (!confirm('ลบวันหยุด ' + h.date + ' — ' + h.name + '?')) return;
        UI.setBusy(del, true, 'กำลังลบ…');
        try {
          await AdminAPI.call('delete_holiday', { row: h.row, version: h.version });
          UI.showToast('ลบแล้ว');
          await this.reload(); // โหลดใหม่เสมอ — เลขแถวที่เหลือเปลี่ยนไปแล้ว
        } catch (e) {
          UI.showToast(e.message, true);
        } finally {
          UI.setBusy(del, false);
        }
      });
      td.appendChild(del);
      tr.appendChild(td);
      body.appendChild(tr);
    });
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
