// จัดการใบลา: เปลี่ยนผู้อนุมัติเฉพาะใบ + ปรับผลการลาใช้จริง
'use strict';

AdminViews['leave-manage'] = {
  data: null,
  filter: 'all',
  _isStale: null,

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
    const pendingCount = leaves.filter(leave => this.isPending_(leave)).length;
    const completedCount = leaves.length - pendingCount;
    root.innerHTML =
      UI.pageHeader('ดำเนินการใบลา', 'จัดการใบลา', 'เปลี่ยนผู้อนุมัติเฉพาะใบที่ค้าง หรือปรับผลลาใช้จริงหลังอนุมัติ — ทุกคำสั่งบันทึกผู้กระทำและเหตุผล') +
      '<section class="grid grid-cols-3 gap-2 mb-4" aria-label="สรุปใบลา">' +
        '<div class="ui-card p-3 text-center"><p class="text-xl font-bold text-text">' + leaves.length + '</p><p class="text-[11px] text-text-muted">ทั้งหมด</p></div>' +
        '<div class="ui-card p-3 text-center"><p class="text-xl font-bold text-warning">' + pendingCount + '</p><p class="text-[11px] text-text-muted">รอดำเนินการ</p></div>' +
        '<div class="ui-card p-3 text-center"><p class="text-xl font-bold text-success">' + completedCount + '</p><p class="text-[11px] text-text-muted">มีผลแล้ว</p></div>' +
      '</section>' +
      '<div class="ui-card ui-card-body mb-4"><label for="lm-filter" class="ui-label">กรองตามสถานะ</label>' +
      '<select id="lm-filter" class="ui-field"><option value="all">ทุกสถานะ</option><option value="pending">รอผู้อนุมัติ</option><option value="completed">อนุมัติหรือยกเลิกแล้ว</option></select></div>' +
      '<div id="lm-list"></div>';
    UI.$('lm-filter').value = this.filter;
    UI.$('lm-filter').addEventListener('change', event => {
      this.filter = event.target.value;
      this.renderLeaveList_();
    });
    this.renderLeaveList_();
  },

  isPending_(leave) {
    return leave.status === 'รอผู้อนุมัติ' || leave.status === 'รอหัวหน้า สสอ.อนุมัติ';
  },

  renderLeaveList_() {
    const list = UI.$('lm-list');
    if (!list) return;
    const leaves = (this.data.leaves || []).filter(leave => {
      if (this.filter === 'pending') return this.isPending_(leave);
      if (this.filter === 'completed') return !this.isPending_(leave);
      return true;
    });
    list.innerHTML = '';
    if (!leaves.length) {
      list.innerHTML = UI.emptyState('ไม่พบใบลาในสถานะที่เลือก', 'ลองเปลี่ยนตัวกรองเพื่อดูรายการอื่น');
      return;
    }
    leaves.forEach((leave, index) => list.appendChild(this.leaveCard_(leave, index)));
  },

  optionSelect_(items, valueKey, labelFn, selected) {
    const select = document.createElement('select');
    select.className = 'ui-field';
    (items || []).forEach(item => {
      const option = document.createElement('option');
      option.value = typeof item === 'string' ? item : item[valueKey];
      option.textContent = typeof item === 'string' ? item : labelFn(item);
      option.selected = option.value === selected;
      select.appendChild(option);
    });
    return select;
  },

  fieldWrap_(label, control, className) {
    const wrap = UI.el('label', className || 'block');
    wrap.appendChild(UI.el('span', 'ui-label', label));
    wrap.appendChild(control);
    return wrap;
  },

  dateField_(label, selected) {
    const wrap = UI.el('label', 'relative block min-h-[58px] rounded-control border border-border bg-white px-3 py-2 cursor-pointer focus-within:ring-2 focus-within:ring-brand/20');
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
    const card = UI.el('section', 'ui-card ui-card-body mb-3');
    card.innerHTML =
      '<div class="flex items-start justify-between gap-3"><div><p class="font-semibold">' + UI.escapeHtml(leave.fullName) + '</p>' +
      '<p class="text-[13px] text-text-muted">' + UI.escapeHtml(leave.groupName + ' · ' + leave.leaveType) + '</p></div>' +
      '<span class="ui-badge ' + (this.isPending_(leave) ? 'ui-badge-warning' : 'ui-badge-neutral') + ' flex-none">' + UI.escapeHtml(leave.status) + '</span></div>' +
      '<div class="mt-3 rounded-control bg-surface-subtle px-3 py-2"><p class="text-[11px] text-text-muted">ช่วงวันที่ลา</p><p class="mt-0.5 text-sm font-medium text-text">' + UI.escapeHtml(this.dateLabel_(leave)) + '</p></div>' +
      (leave.currentApproverNames.length ? '<p class="text-xs text-amber-700 mt-2">รอ: ' + UI.escapeHtml(leave.currentApproverNames.join(', ')) + '</p>' : '') +
      (leave.substituteName ? '<p class="text-xs text-slate-500 mt-1">ผู้ปฏิบัติงานแทน: ' + UI.escapeHtml(leave.substituteName) + '</p>' : '');

    const pending = this.isPending_(leave);
    if (pending) card.appendChild(this.reassignPanel_(leave, index));
    if (leave.status === 'อนุมัติ' || leave.status === 'ยกเลิก') card.appendChild(this.adjustPanel_(leave, index));
    return card;
  },

  togglePanel_(label, panel) {
    const wrap = UI.el('div', 'mt-3 pt-3 border-t border-slate-100');
    const toggle = UI.el('button', 'ui-btn-soft w-full sm:w-auto', label);
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
    reason.className = 'ui-field';
    const button = UI.el('button', 'ui-btn-primary w-full', 'ยืนยันเปลี่ยนผู้อนุมัติ');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!select.value || reason.value.trim().length < 5) { UI.showToast('เลือกผู้อนุมัติและระบุเหตุผลให้ครบ', true); return; }
      const accepted = await UI.confirm({
        title: 'เปลี่ยนผู้อนุมัติใบลานี้?',
        message: leave.fullName + ' · ' + this.dateLabel_(leave) + '\nปุ่มบนการ์ดของผู้อนุมัติเดิมจะใช้ไม่ได้ทันที',
        confirmText: 'เปลี่ยนผู้อนุมัติ',
      });
      if (!accepted) return;
      UI.setBusy(button, true, 'กำลังเปลี่ยน…');
      try {
        await AdminAPI.callMain('adminReassignApprover', { pageId: leave.pageId,
          targetStaffKey: select.value, reason: reason.value.trim(), requestId: UI.requestId() });
        UI.showToast('เปลี่ยนผู้อนุมัติและแจ้งผู้เกี่ยวข้องแล้ว');
        await App.renderRoute();
      } catch (err) { UI.showToast(err.message, true); } finally { UI.setBusy(button, false); }
    });
    panel.appendChild(this.fieldWrap_('ผู้อนุมัติสำรอง', select));
    panel.appendChild(this.fieldWrap_('เหตุผลที่เปลี่ยนผู้อนุมัติ', reason));
    panel.appendChild(button);
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
    reason.placeholder = 'เหตุผลการลา'; reason.className = 'ui-field';
    const adjustment = document.createElement('textarea'); adjustment.rows = 2; adjustment.maxLength = 500;
    adjustment.placeholder = 'เหตุผลการปรับผลใช้จริง (5–500 ตัวอักษร)'; adjustment.className = reason.className;
    const button = UI.el('button', 'ui-btn-primary col-span-2', 'บันทึกผลการลาใช้จริง');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!start.value || !end.value || adjustment.value.trim().length < 5) { UI.showToast('กรอกช่วงวันและเหตุผลการปรับให้ครบ', true); return; }
      const accepted = await UI.confirm({
        title: 'บันทึกผลการลาใช้จริง?',
        message: leave.fullName + ' · ' + this.dateLabel_(leave) + '\nยอดสิทธิ์และรายงานจะคำนวณใหม่ตามค่าที่บันทึก',
        confirmText: 'บันทึกผลการลา',
      });
      if (!accepted) return;
      UI.setBusy(button, true, 'กำลังบันทึก…');
      try {
        await AdminAPI.callMain('adminAdjustLeave', { pageId: leave.pageId, requestId: UI.requestId(),
          resultStatus: status.value, leaveType: type.value, start: start.value, end: end.value,
          period: period.value, reason: reason.value.trim(), substituteKey: substitute.value,
          adjustmentReason: adjustment.value.trim() });
        UI.showToast('บันทึกผลการลาใช้จริงและแจ้งผู้เกี่ยวข้องแล้ว');
        await App.renderRoute();
      } catch (err) { UI.showToast(err.message, true); } finally { UI.setBusy(button, false); }
    });
    [
      this.fieldWrap_('ผลการลา', status),
      this.fieldWrap_('ประเภทการลา', type),
      startField.element,
      endField.element,
      this.fieldWrap_('ช่วงวัน', period),
      this.fieldWrap_('ผู้ปฏิบัติงานแทน', substitute),
      this.fieldWrap_('เหตุผลการลา', reason, 'col-span-2'),
      this.fieldWrap_('เหตุผลการปรับผลใช้จริง', adjustment, 'col-span-2'),
      button,
    ].forEach(node => panel.appendChild(node));
    return this.togglePanel_('ปรับผลการลาใช้จริง', panel);
  },
};
