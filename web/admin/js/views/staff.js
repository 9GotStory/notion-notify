// หน้าบุคลากร — ทำเนียบ + ประเภทบุคลากรต่อคน + ผู้อนุมัติรายกลุ่มงาน
// (ตำแหน่ง ประเภทบุคลากร กลุ่มงาน และผู้อนุมัติอ้างอิงจากข้อมูลมาตรฐานของระบบ)
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
    const approverStaffOptions = approversRes.staffOptions ||
      (approversRes.staffKeys || []).map(key => ({ key: key, name: key, group: '', position: '' }));
    const approverGroupOptions = approversRes.groupOptions || [];
    const approvers = approversRes.approvers || [];
    this.approversVersion = approversRes.version || '';

    // ----- ทำเนียบ + ประเภทบุคลากร -----
    let html =
      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 px-4 pt-4 pb-2">ทำเนียบเจ้าหน้าที่ (' + staff.length + ' คน · อนุมัติการผูกแล้ว ' +
      staff.filter(s => s.registered).length + ')</p>' +
      '<div id="staffCards" class="divide-y divide-slate-100"></div>' +
      '<div id="staffPagination" class="hidden border-t border-slate-100 px-4 py-3"></div>' +
      '<p class="text-xs text-slate-400 px-4 py-3">HR เตรียมข้อมูลทำเนียบและรหัสบุคลากรโดยเว้นสถานะทั้งสองช่อง ระบบจะตั้ง PENDING เมื่อขอผูก และตั้ง ACTIVE/APPROVED เมื่ออนุมัติ</p>' +
      '</div>';

    // ----- ผู้อนุมัติรายกลุ่มงาน -----
    html +=
      '<div class="bg-white border border-slate-200 rounded-2xl p-4">' +
      '<div class="flex items-center justify-between mb-1">' +
      '<p class="text-sm font-semibold text-slate-600">ผู้อนุมัติรายกลุ่มงาน (' + approvers.length + ')</p>' +
      '<button id="apAddRow" type="button" class="text-xs text-primary font-medium hover:underline">+ เพิ่มกลุ่มงาน</button>' +
      '</div>' +
      '<p class="text-xs text-slate-500 mb-3">เลือกกลุ่มงานและผู้อนุมัติจากทำเนียบ Staff โดยตรง ผู้อนุมัติต้องผูก LINE และได้รับอนุมัติแล้ว — บันทึกแบบแทนที่ทั้งตาราง</p>' +
      '<div id="apRows" class="space-y-2"></div>' +
      '<button id="apSave" type="button" class="mt-4 h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">บันทึกผู้อนุมัติทั้งหมด</button>' +
      '</div>';

    root.innerHTML = html;
    this.renderStaffPage_();
    this.renderApproverRows(approvers, approverStaffOptions, approverGroupOptions);
    UI.$('apAddRow').addEventListener('click', () =>
      this.appendApproverRow('', '', false, approverStaffOptions, approverGroupOptions));
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
      const employmentStatusClass = active
        ? 'bg-emerald-50 text-emerald-700'
        : (s.employmentStatus ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600');
      return '<article class="p-4">' +
        '<div class="min-w-0">' +
          '<p class="font-semibold text-slate-800 break-words">' + UI.escapeHtml(s.name) + '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500 break-words">ตำแหน่ง: ' + UI.escapeHtml(s.position || 'ยังไม่ระบุ') + '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500 break-words">กลุ่มงาน: ' + UI.escapeHtml(s.group || 'ยังไม่ระบุ') +
            ' · รหัส <span class="font-mono">' + UI.escapeHtml(s.employeeId || '—') + '</span></p>' +
        '</div>' +
        '<div class="mt-2 flex flex-wrap gap-2">' +
          '<span class="rounded-full px-2.5 py-1 text-xs font-medium ' +
            employmentStatusClass + '">บุคลากร: ' +
            UI.escapeHtml(s.employmentStatus || 'รอระบบยืนยัน') + '</span>' +
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

  renderApproverRows(approvers, staffOptions, groupOptions) {
    const wrap = UI.$('apRows');
    wrap.innerHTML = '';
    if (!approvers.length) this.appendApproverRow('', '', false, staffOptions, groupOptions);
    approvers.forEach(a => this.appendApproverRow(a.group, a.names, a.forward, staffOptions, groupOptions));
  },

  appendApproverRow(group, names, forward, staffOptions, groupOptions) {
    const wrap = UI.$('apRows');
    const row = document.createElement('div');
    row.className = 'rounded-xl border border-slate-200 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start';

    const groupControl = document.createElement('div');
    const groupLabel = document.createElement('label');
    groupLabel.className = 'block text-xs font-medium text-slate-500 mb-1.5';
    groupLabel.textContent = 'กลุ่มงาน';
    const groupSelect = document.createElement('select');
    groupSelect.dataset.role = 'approver-group';
    groupSelect.className = 'w-full h-11 px-3 border border-slate-200 rounded-lg text-sm bg-white';
    const groupPlaceholder = document.createElement('option');
    groupPlaceholder.value = '';
    groupPlaceholder.textContent = '— เลือกกลุ่มงานจาก Staff —';
    groupSelect.appendChild(groupPlaceholder);
    const availableGroups = groupOptions || [];
    if (group && !availableGroups.includes(group)) {
      const legacyGroup = document.createElement('option');
      legacyGroup.value = group;
      legacyGroup.textContent = group + ' (ไม่มีใน Staff)';
      groupSelect.appendChild(legacyGroup);
    }
    availableGroups.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      groupSelect.appendChild(option);
    });
    groupSelect.value = group || '';
    groupControl.appendChild(groupLabel);
    groupControl.appendChild(groupSelect);

    const namesControl = document.createElement('fieldset');
    const namesLabel = document.createElement('legend');
    namesLabel.className = 'block text-xs font-medium text-slate-500 mb-1.5';
    namesLabel.textContent = 'ผู้อนุมัติ (เลือกได้หลายคน)';
    const namesList = document.createElement('div');
    namesList.className = 'max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100';
    const selectedNames = new Set(String(names || '').split(/[,，\n]/)
      .map(name => name.trim().replace(/\s+/g, ' ')).filter(Boolean));
    const availableKeys = new Set();
    (staffOptions || []).forEach(staff => {
      const key = String(staff.key || '').trim();
      if (!key) return;
      availableKeys.add(key);
      const label = document.createElement('label');
      label.className = 'flex items-start gap-2 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.role = 'approver-name';
      checkbox.value = key;
      checkbox.checked = selectedNames.has(key);
      checkbox.className = 'mt-0.5 w-4 h-4 accent-[#0F6E56]';
      const detail = [staff.position, staff.group].filter(Boolean).join(' · ');
      const text = document.createElement('span');
      text.textContent = (staff.name || key) + (detail ? ' — ' + detail : '');
      label.appendChild(checkbox);
      label.appendChild(text);
      namesList.appendChild(label);
    });
    selectedNames.forEach(name => {
      if (availableKeys.has(name)) return;
      const label = document.createElement('label');
      label.className = 'flex items-start gap-2 px-3 py-2.5 text-sm text-red-700 bg-red-50 cursor-pointer';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.role = 'approver-name';
      checkbox.value = name;
      checkbox.checked = true;
      checkbox.className = 'mt-0.5 w-4 h-4 accent-[#0F6E56]';
      const text = document.createElement('span');
      text.textContent = name + ' — ไม่พร้อมเป็นผู้อนุมัติ กรุณายกเลิกเลือก';
      label.appendChild(checkbox);
      label.appendChild(text);
      namesList.appendChild(label);
    });
    if (!namesList.children.length) {
      const empty = document.createElement('p');
      empty.className = 'px-3 py-3 text-xs text-amber-700 bg-amber-50';
      empty.textContent = 'ยังไม่มีบุคลากรที่ผูก LINE และอนุมัติแล้ว';
      namesList.appendChild(empty);
    }
    namesControl.appendChild(namesLabel);
    namesControl.appendChild(namesList);

    const forwardLabel = document.createElement('label');
    forwardLabel.className = 'flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap';
    const forwardCheck = document.createElement('input');
    forwardCheck.type = 'checkbox';
    forwardCheck.dataset.role = 'approver-forward';
    forwardCheck.checked = !!forward;
    forwardCheck.className = 'w-4 h-4 accent-[#0F6E56]';
    forwardLabel.appendChild(forwardCheck);
    forwardLabel.appendChild(document.createTextNode('ส่งต่อ หัวหน้า สสอ.'));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-xs text-red-500 hover:underline';
    del.textContent = 'ลบ';
    del.addEventListener('click', () => row.remove());

    row.appendChild(groupControl);
    row.appendChild(namesControl);
    row.appendChild(forwardLabel);
    row.appendChild(del);
    wrap.appendChild(row);
  },

  collectApproverRows() {
    return Array.from(UI.$('apRows').children).map(row => ({
      group: (row.querySelector('[data-role="approver-group"]').value || '').trim(),
      names: Array.from(row.querySelectorAll('[data-role="approver-name"]:checked'))
        .map(input => input.value).join(', '),
      forward: row.querySelector('[data-role="approver-forward"]').checked,
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
