// หน้าบุคลากร — ทำเนียบ + ประเภทบุคลากรต่อคน + ผู้อนุมัติรายกลุ่มงาน
// (ประเภทบุคลากรย้ายมาจากแท็บโควตาเดิม — จัดให้อยู่โดมน์บุคลากรจริง / ผู้อนุมัติเดิมแก้ชีตตรงๆ เท่านั้น)
'use strict';

AdminViews.staff = {

  employmentTypes: [],
  positionOptions: [],
  approversVersion: '',
  staffList: [],
  staffPage: 1,
  staffPageSize: 10,
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML = '<div class="text-center text-slate-400 text-sm py-10">กำลังโหลด…</div>';
    const [quotaRes, approversRes] = await Promise.all([
      AdminAPI.call('get_quota_profiles'),
      AdminAPI.call('get_approvers'),
    ]);
    if (isStale()) return; // ผู้ใช้ไปหน้าอื่นแล้ว — หยุดก่อนแตะ DOM
    this.employmentTypes = quotaRes.employmentTypes || [];
    this.positionOptions = quotaRes.positionOptions || [];
    const staff = quotaRes.staff || [];
    this.staffList = staff;
    this.staffPage = Math.min(this.staffPage, this.staffPageCount_());
    const staffKeys = approversRes.staffKeys || [];
    const approvers = approversRes.approvers || [];
    this.approversVersion = approversRes.version || '';

    // ----- ทำเนียบ + ประเภทบุคลากร -----
    let html =
      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 px-4 pt-4 pb-2">ทำเนียบเจ้าหน้าที่ (' + staff.length + ' คน · อนุมัติการผูกแล้ว ' +
      staff.filter(s => s.registered).length + ')</p>' +
      '<div id="staffCards" class="divide-y divide-slate-100"></div>' +
      '<div id="staffPagination" class="hidden border-t border-slate-100 px-4 py-3"></div>' +
      '<p class="text-xs text-slate-400 px-4 py-3">สถานะบุคลากร ACTIVE/INACTIVE มาจากทำเนียบที่ HR รับรอง ส่วนสถานะผูก LINE ระบบอัปเดตอัตโนมัติจากคำขอและการอนุมัติ</p>' +
      '</div>';

    // ----- ผู้อนุมัติรายกลุ่มงาน -----
    html +=
      '<div class="bg-white border border-slate-200 rounded-2xl p-4">' +
      '<div class="flex items-center justify-between mb-1">' +
      '<p class="text-sm font-semibold text-slate-600">ผู้อนุมัติรายกลุ่มงาน (' + approvers.length + ')</p>' +
      '<button id="apAddRow" type="button" class="text-xs text-primary font-medium hover:underline">+ เพิ่มกลุ่มงาน</button>' +
      '</div>' +
      '<p class="text-xs text-slate-500 mb-3">รายชื่อคั่นด้วยจุลภาค (ต้องเป็น "ชื่อ สกุล" ที่ลงทะเบียนแล้ว) — บันทึกแบบแทนที่ทั้งตาราง</p>' +
      '<div id="apRows" class="space-y-2"></div>' +
      '<button id="apSave" type="button" class="mt-4 h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">บันทึกผู้อนุมัติทั้งหมด</button>' +
      '</div>';

    root.innerHTML = html;
    this.renderStaffPage_();
    this.renderApproverRows(approvers, staffKeys);
    UI.$('apAddRow').addEventListener('click', () => this.appendApproverRow('', '', false, staffKeys));
    UI.$('apSave').addEventListener('click', () => this.saveApprovers());
  },

  staffPageCount_() {
    return Math.max(1, Math.ceil(this.staffList.length / this.staffPageSize));
  },

  staffPageItems_() {
    const start = (this.staffPage - 1) * this.staffPageSize;
    return this.staffList.slice(start, start + this.staffPageSize);
  },

  renderStaffPage_() {
    this.staffPage = Math.min(Math.max(1, this.staffPage), this.staffPageCount_());
    this.renderStaffCards(this.staffPageItems_());
    const pagination = UI.$('staffPagination');
    if (this.staffList.length <= this.staffPageSize) {
      pagination.classList.add('hidden');
      pagination.innerHTML = '';
      return;
    }
    pagination.classList.remove('hidden');
    pagination.innerHTML =
      '<div class="flex items-center justify-between gap-3">' +
        '<p class="text-xs text-slate-500">หน้า ' + this.staffPage + ' จาก ' + this.staffPageCount_() + '</p>' +
        '<div class="flex gap-2">' +
          '<button id="staffPrev" type="button" class="min-h-10 px-3 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-40">ก่อนหน้า</button>' +
          '<button id="staffNext" type="button" class="min-h-10 px-3 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-40">ถัดไป</button>' +
        '</div>' +
      '</div>';
    const prev = UI.$('staffPrev');
    const next = UI.$('staffNext');
    prev.disabled = this.staffPage === 1;
    next.disabled = this.staffPage === this.staffPageCount_();
    prev.addEventListener('click', () => {
      this.staffPage--;
      this.renderStaffPage_();
    });
    next.addEventListener('click', () => {
      this.staffPage++;
      this.renderStaffPage_();
    });
  },

  renderStaffCards(list) {
    const wrap = UI.$('staffCards');
    if (!(list || []).length) {
      wrap.innerHTML = '<p class="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีรายชื่อบุคลากร</p>';
      return;
    }
    wrap.innerHTML = list.map(s => {
      const pending = s.bindingStatus === 'PENDING';
      const approved = s.bindingStatus === 'APPROVED';
      const statusClass = pending
        ? 'bg-amber-50 text-amber-700'
        : (approved ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600');
      const active = s.employmentStatus === 'ACTIVE';
      return '<article class="p-4">' +
        '<div class="min-w-0">' +
          '<p class="font-semibold text-slate-800 break-words">' + UI.escapeHtml(s.name) + '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500 break-words">ตำแหน่ง: ' + UI.escapeHtml(s.position || 'ยังไม่ระบุ') + '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500 break-words">กลุ่มงาน: ' + UI.escapeHtml(s.group || 'ยังไม่ระบุ') +
            ' · รหัส <span class="font-mono">' + UI.escapeHtml(s.employeeId || '—') + '</span></p>' +
        '</div>' +
        '<div class="mt-2 flex flex-wrap gap-2">' +
          '<span class="rounded-full px-2.5 py-1 text-xs font-medium ' +
            (active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700') + '">บุคลากร: ' +
            UI.escapeHtml(s.employmentStatus || 'ยังไม่ระบุ') + '</span>' +
          '<span class="max-w-full rounded-full px-2.5 py-1 text-xs font-medium break-words ' + statusClass + '">ผูก LINE: ' +
            UI.escapeHtml(s.bindingLabel || s.bindingStatus || 'ยังไม่ผูก') + '</span>' +
        '</div>' +
        '<div data-role="binding-actions" class="mt-3 flex flex-wrap gap-2"></div>' +
        '<div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">' +
          '<div class="rounded-xl bg-slate-50 p-3">' +
            '<label class="block text-xs font-medium text-slate-500 mb-1.5">ตำแหน่ง</label>' +
            '<div data-role="position-control"></div>' +
          '</div>' +
          '<div class="rounded-xl bg-slate-50 p-3">' +
            '<label class="block text-xs font-medium text-slate-500 mb-1.5">ประเภทบุคลากร</label>' +
            '<div data-role="employment-control"></div>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    // ปุ่ม/select ผูก event ทีหลัง render ด้วย createElement — ไม่ฝัง payload ใน HTML string
    (list || []).forEach((s, i) => {
      const card = wrap.children[i];
      const positionControl = card.querySelector('[data-role="position-control"]');
      const employmentControl = card.querySelector('[data-role="employment-control"]');
      this.appendStaffOptionControl_(positionControl, s, this.positionOptions, s.position,
        'set_staff_position', 'position', 'ตำแหน่ง');
      this.appendStaffOptionControl_(employmentControl, s, this.employmentTypes, s.employmentType,
        'set_staff_employment_type', 'employmentType', 'ประเภทบุคลากร');

      const reviewable = s.bindingStatus === 'PENDING' ||
        (!!s.lineUserId && s.bindingStatus !== 'APPROVED');
      if (reviewable) {
        const actions = card.querySelector('[data-role="binding-actions"]');
        const actionLabel = document.createElement('p');
        actionLabel.className = 'w-full text-xs font-medium text-slate-500';
        actionLabel.textContent = 'ตรวจสอบการผูกบัญชี LINE';
        actions.appendChild(actionLabel);
        ['approve', 'reject'].forEach(action => {
          const reviewButton = document.createElement('button');
          reviewButton.type = 'button';
          reviewButton.className = 'min-h-11 flex-1 sm:flex-none px-4 rounded-lg border text-sm font-semibold disabled:opacity-50 ' +
            (action === 'approve' ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700' :
              'border-red-200 bg-white text-red-700 hover:bg-red-50');
          reviewButton.textContent = action === 'approve' ? 'อนุมัติผูก' : 'ปฏิเสธ';
          reviewButton.addEventListener('click', async () => {
            const reason = window.prompt(action === 'approve'
              ? 'ระบุหลักฐาน/เหตุผลที่ยืนยันตัวตน (อย่างน้อย 5 ตัวอักษร)'
              : 'ระบุเหตุผลที่ปฏิเสธ (อย่างน้อย 5 ตัวอักษร)', 'ตรวจสอบกับทำเนียบแล้ว');
            if (reason === null) return;
            UI.setBusy(reviewButton, true, '…');
            try {
              await AdminAPI.call(action + '_staff_binding', {
                row: s.row, version: s.version, reason: reason.trim(),
              });
              UI.showToast(action === 'approve' ? 'อนุมัติการผูกแล้ว' : 'ปฏิเสธและล้างการผูกแล้ว');
              await this.render(UI.$('view'), this._isStale);
            } catch (e) {
              UI.showToast(e.message, true);
            } finally {
              UI.setBusy(reviewButton, false);
            }
          });
          actions.appendChild(reviewButton);
        });
      }
    });
  },

  appendStaffOptionControl_(container, staff, options, currentValue, action, valueKey, label) {
    const control = document.createElement('div');
    control.className = 'grid grid-cols-1 gap-2';
    const select = document.createElement('select');
    select.className = 'w-full h-11 px-3 border border-slate-200 rounded-lg text-sm bg-white';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = currentValue || '— ยังไม่ระบุ —';
    select.appendChild(placeholder);
    (options || []).forEach(value => {
      if (value === currentValue) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hidden h-11 w-full px-4 rounded-lg border border-slate-200 text-primary text-sm font-medium bg-white hover:bg-slate-100 disabled:opacity-50';
    button.textContent = 'บันทึก' + label;
    select.addEventListener('change', () => {
      button.classList.toggle('hidden', !select.value);
    });
    button.addEventListener('click', async () => {
      if (!select.value) { UI.showToast('เลือก' + label + 'ก่อนบันทึก', true); return; }
      UI.setBusy(button, true, 'กำลังบันทึก…');
      try {
        const payload = { staffKey: staff.key };
        payload[valueKey] = select.value;
        await AdminAPI.call(action, payload);
        UI.showToast('บันทึกแล้ว — ' + staff.name + ' → ' + select.value);
        await this.render(UI.$('view'), this._isStale);
      } catch (e) {
        UI.showToast(e.message, true);
      } finally {
        UI.setBusy(button, false);
      }
    });
    control.appendChild(select);
    control.appendChild(button);
    container.appendChild(control);
  },

  renderApproverRows(approvers, staffKeys) {
    const wrap = UI.$('apRows');
    wrap.innerHTML = '';
    if (!approvers.length) this.appendApproverRow('', '', false, staffKeys);
    approvers.forEach(a => this.appendApproverRow(a.group, a.names, a.forward, staffKeys));
  },

  appendApproverRow(group, names, forward, staffKeys) {
    const wrap = UI.$('apRows');
    const row = document.createElement('div');
    row.className = 'grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto_auto] gap-2 items-center';
    row.dataset.datalistId = '';

    const groupInput = document.createElement('input');
    groupInput.type = 'text';
    groupInput.maxLength = 100;
    groupInput.placeholder = 'ชื่อกลุ่มงาน';
    groupInput.value = group || '';
    groupInput.className = 'px-3 py-2 border border-slate-200 rounded-lg text-sm';

    const namesInput = document.createElement('input');
    namesInput.type = 'text';
    namesInput.maxLength = 500;
    namesInput.placeholder = 'ชื่อ สกุล คั่นจุลภาค';
    namesInput.value = names || '';
    namesInput.className = 'px-3 py-2 border border-slate-200 rounded-lg text-sm';
    // datalist ช่วยพิมพ์ชื่อให้ตรงทำเนียบ (ชื่อต้องตรงเป๊ะระบบถึงจับคู่ผู้อนุมัติได้)
    const listId = 'dl-' + Math.random().toString(36).slice(2, 8);
    const dl = document.createElement('datalist');
    dl.id = listId;
    (staffKeys || []).forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      dl.appendChild(o);
    });
    namesInput.setAttribute('list', listId);

    const forwardLabel = document.createElement('label');
    forwardLabel.className = 'flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap';
    const forwardCheck = document.createElement('input');
    forwardCheck.type = 'checkbox';
    forwardCheck.checked = !!forward;
    forwardCheck.className = 'w-4 h-4 accent-[#0F6E56]';
    forwardLabel.appendChild(forwardCheck);
    forwardLabel.appendChild(document.createTextNode('ส่งต่อ หัวหน้า สสอ.'));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-xs text-red-500 hover:underline';
    del.textContent = 'ลบ';
    del.addEventListener('click', () => row.remove());

    row.appendChild(groupInput);
    row.appendChild(namesInput);
    row.appendChild(dl);
    row.appendChild(forwardLabel);
    row.appendChild(del);
    wrap.appendChild(row);
  },

  collectApproverRows() {
    return Array.from(UI.$('apRows').children).map(row => ({
      group: (row.children[0].value || '').trim(),
      names: (row.children[1].value || '').trim(),
      forward: row.children[3].querySelector('input').checked,
    }));
  },

  async saveApprovers() {
    const rows = this.collectApproverRows();
    const btn = UI.$('apSave');
    if (!confirm('บันทึกผู้อนุมัติทั้งหมด ' + rows.length + ' กลุ่มงาน?\n(แทนที่ตารางเดิมทั้งหมด)')) return;
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call('save_approvers', {
        data: JSON.stringify(rows), version: this.approversVersion,
      });
      UI.showToast('บันทึกผู้อนุมัติแล้ว');
      await this.render(UI.$('view'), this._isStale); // โหลดใหม่เพื่ออัปเดตเลขแถว/ลิสต์จริง
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },
};
