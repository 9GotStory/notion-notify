// จัดการใบลา: เปลี่ยนผู้อนุมัติเฉพาะใบ + ปรับผลการลาใช้จริง
'use strict';

AdminViews['leave-manage'] = {
  data: null,
  _isStale: null,

  requestId_() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    throw new Error('เบราว์เซอร์นี้ไม่รองรับรหัสคำขอที่ปลอดภัย');
  },

  dateLabel_(leave) {
    return UI.formatThaiDateRange(leave.start, leave.end) +
      (leave.period && leave.period !== 'เต็มวัน' ? ' (' + leave.period + ')' : '');
  },

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML = '<div class="text-center text-slate-400 text-sm py-10">กำลังโหลด…</div>';
    this.data = await AdminAPI.callMain('adminLeaveList');
    if (isStale()) return;
    const leaves = this.data.leaves || [];
    root.innerHTML =
      '<header class="mb-4"><h2 class="text-lg font-bold">จัดการใบลา</h2>' +
      '<p class="text-sm text-slate-500 mt-1">เปลี่ยนผู้อนุมัติเฉพาะใบที่ค้าง หรือปรับผลลาใช้จริงหลังอนุมัติ — ทุกคำสั่งบันทึกผู้กระทำและเหตุผล</p></header>' +
      '<div id="lm-list"></div>';
    const list = UI.$('lm-list');
    if (!leaves.length) {
      list.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">ยังไม่มีใบลาในช่วงปีที่ระบบแสดง</div>';
      return;
    }
    leaves.forEach((leave, index) => list.appendChild(this.leaveCard_(leave, index)));
  },

  optionSelect_(items, valueKey, labelFn, selected) {
    const select = document.createElement('select');
    select.className = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white';
    (items || []).forEach(item => {
      const option = document.createElement('option');
      option.value = typeof item === 'string' ? item : item[valueKey];
      option.textContent = typeof item === 'string' ? item : labelFn(item);
      option.selected = option.value === selected;
      select.appendChild(option);
    });
    return select;
  },

  dateField_(label, selected) {
    const wrap = UI.el('label', 'relative block min-h-[58px] px-3 py-2 border border-slate-200 rounded-lg bg-white cursor-pointer focus-within:ring-2 focus-within:ring-primary/30');
    const caption = UI.el('span', 'block text-[11px] font-semibold text-slate-500', label);
    const display = UI.el('span', 'block mt-0.5 text-sm text-slate-800', '— เลือกวันที่ —');
    const input = document.createElement('input');
    input.type = 'date';
    input.value = selected || '';
    input.setAttribute('aria-label', label);
    input.className = 'absolute inset-0 w-full h-full opacity-0 cursor-pointer';
    const refresh = () => { display.textContent = input.value ? UI.formatThaiDate(input.value) : '— เลือกวันที่ —'; };
    input.addEventListener('change', refresh);
    refresh();
    wrap.appendChild(caption); wrap.appendChild(display); wrap.appendChild(input);
    return { element: wrap, input: input, display: display };
  },

  leaveCard_(leave, index) {
    const card = UI.el('section', 'bg-white border border-slate-200 rounded-2xl p-4 mb-3');
    card.innerHTML =
      '<div class="flex items-start justify-between gap-3"><div><p class="font-semibold">' + UI.escapeHtml(leave.fullName) + '</p>' +
      '<p class="text-xs text-slate-500">' + UI.escapeHtml(leave.groupName + ' · ' + leave.leaveType + ' · ' + this.dateLabel_(leave)) + '</p></div>' +
      '<span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 flex-none">' + UI.escapeHtml(leave.status) + '</span></div>' +
      (leave.currentApproverNames.length ? '<p class="text-xs text-amber-700 mt-2">รอ: ' + UI.escapeHtml(leave.currentApproverNames.join(', ')) + '</p>' : '') +
      (leave.substituteName ? '<p class="text-xs text-slate-500 mt-1">ผู้ปฏิบัติงานแทน: ' + UI.escapeHtml(leave.substituteName) + '</p>' : '');

    const pending = leave.status === 'รอผู้อนุมัติ' || leave.status === 'รอหัวหน้า สสอ.อนุมัติ';
    if (pending) card.appendChild(this.reassignPanel_(leave, index));
    if (leave.status === 'อนุมัติ' || leave.status === 'ยกเลิก') card.appendChild(this.adjustPanel_(leave, index));
    return card;
  },

  togglePanel_(label, panel) {
    const wrap = UI.el('div', 'mt-3 pt-3 border-t border-slate-100');
    const toggle = UI.el('button', 'text-sm font-semibold text-primary hover:underline', label);
    toggle.type = 'button';
    panel.classList.add('hidden');
    toggle.addEventListener('click', () => panel.classList.toggle('hidden'));
    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    return wrap;
  },

  reassignPanel_(leave) {
    const panel = UI.el('div', 'mt-3 space-y-2');
    const people = [{ key: '', name: '— เลือกผู้อนุมัติสำรอง —', groupName: '' }].concat(this.data.staffOptions || []);
    const select = this.optionSelect_(people, 'key', p => p.name + (p.groupName ? ' · ' + p.groupName : ''), '');
    const reason = document.createElement('textarea');
    reason.rows = 2; reason.maxLength = 500; reason.placeholder = 'เหตุผลที่ผู้อนุมัติเดิมไม่สะดวก (5–500 ตัวอักษร)';
    reason.className = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm';
    const button = UI.el('button', 'h-10 px-4 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50', 'ยืนยันเปลี่ยนผู้อนุมัติ');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!select.value || reason.value.trim().length < 5) { UI.showToast('เลือกผู้อนุมัติและระบุเหตุผลให้ครบ', true); return; }
      if (!confirm('เปลี่ยนผู้อนุมัติใบลาของ ' + leave.fullName + '?\nปุ่มบนการ์ดเก่าจะใช้ไม่ได้ทันที')) return;
      UI.setBusy(button, true, 'กำลังเปลี่ยน…');
      try {
        await AdminAPI.callMain('adminReassignApprover', { pageId: leave.pageId,
          targetStaffKey: select.value, reason: reason.value.trim(), requestId: this.requestId_() });
        UI.showToast('เปลี่ยนผู้อนุมัติและแจ้งผู้เกี่ยวข้องแล้ว');
        await this.render(UI.$('view'), this._isStale);
      } catch (err) { UI.showToast(err.message, true); } finally { UI.setBusy(button, false); }
    });
    panel.appendChild(select); panel.appendChild(reason); panel.appendChild(button);
    return this.togglePanel_('เปลี่ยนผู้อนุมัติเฉพาะใบ', panel);
  },

  adjustPanel_(leave) {
    const panel = UI.el('div', 'mt-3 grid grid-cols-2 gap-2');
    const status = this.optionSelect_(['อนุมัติ', 'ยกเลิก'], '', x => x, leave.status);
    const type = this.optionSelect_(this.data.leaveTypes || [], '', x => x, leave.leaveType);
    const startField = this.dateField_('วันเริ่ม', leave.start);
    const endField = this.dateField_('วันสิ้นสุด', leave.end);
    const start = startField.input;
    const end = endField.input;
    const period = this.optionSelect_(this.data.periods || [], '', x => x, leave.period);
    const people = [{ key: '', name: '— ไม่ระบุผู้ปฏิบัติงานแทน —', groupName: '' }].concat(this.data.staffOptions || []);
    const substitute = this.optionSelect_(people, 'key', p => p.name + (p.groupName ? ' · ' + p.groupName : ''), leave.substituteKey);
    const reason = document.createElement('textarea'); reason.rows = 2; reason.maxLength = 500; reason.value = leave.reason || '';
    reason.placeholder = 'เหตุผลการลา'; reason.className = 'col-span-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm';
    const adjustment = document.createElement('textarea'); adjustment.rows = 2; adjustment.maxLength = 500;
    adjustment.placeholder = 'เหตุผลการปรับผลใช้จริง (5–500 ตัวอักษร)'; adjustment.className = reason.className;
    const button = UI.el('button', 'col-span-2 h-10 px-4 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50', 'บันทึกผลการลาใช้จริง');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!start.value || !end.value || adjustment.value.trim().length < 5) { UI.showToast('กรอกช่วงวันและเหตุผลการปรับให้ครบ', true); return; }
      if (!confirm('บันทึกผลการลาใช้จริงของ ' + leave.fullName + '?\nยอดสิทธิ์และรายงานจะคำนวณตามค่าใหม่')) return;
      UI.setBusy(button, true, 'กำลังบันทึก…');
      try {
        await AdminAPI.callMain('adminAdjustLeave', { pageId: leave.pageId, requestId: this.requestId_(),
          resultStatus: status.value, leaveType: type.value, start: start.value, end: end.value,
          period: period.value, reason: reason.value.trim(), substituteKey: substitute.value,
          adjustmentReason: adjustment.value.trim() });
        UI.showToast('บันทึกผลการลาใช้จริงและแจ้งผู้เกี่ยวข้องแล้ว');
        await this.render(UI.$('view'), this._isStale);
      } catch (err) { UI.showToast(err.message, true); } finally { UI.setBusy(button, false); }
    });
    [status, type, startField.element, endField.element, period, substitute, reason, adjustment, button]
      .forEach(node => panel.appendChild(node));
    return this.togglePanel_('ปรับผลการลาใช้จริง', panel);
  },
};
