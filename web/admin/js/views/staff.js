// หน้าบุคลากร — ทำเนียบ + ประเภทบุคลากรต่อคน + ผู้อนุมัติรายกลุ่มงาน
// (ประเภทบุคลากรย้ายมาจากแท็บโควตาเดิม — จัดให้อยู่โดมน์บุคลากรจริง / ผู้อนุมัติเดิมแก้ชีตตรงๆ เท่านั้น)
'use strict';

AdminViews.staff = {

  employmentTypes: [],
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
    const staff = quotaRes.staff || [];
    const staffKeys = approversRes.staffKeys || [];
    const approvers = approversRes.approvers || [];

    // ----- ทำเนียบ + ประเภทบุคลากร -----
    let html =
      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 px-4 pt-4 pb-2">ทำเนียบเจ้าหน้าที่ (' + staff.length + ' คน · ลงทะเบียนแล้ว ' +
      staff.filter(s => s.registered).length + ')</p>' +
      '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500">' +
      '<tr><th class="px-4 py-2.5">ชื่อ</th><th class="px-4 py-2.5">กลุ่มงาน</th><th class="px-4 py-2.5">ประเภทบุคลากร</th><th class="px-4 py-2.5 w-24"></th></tr>' +
      '</thead><tbody id="staffBody" class="divide-y divide-slate-100"></tbody></table></div>' +
      '<p class="text-xs text-slate-400 px-4 py-3">ประเภทบุคลากรใช้จับคู่สิทธิ์วันลาจากหน้า "สิทธิ์วันลา" — คนที่ยังไม่ระบุใช้ค่าเริ่มต้นตามระเบียบข้าราชการ</p>' +
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
    this.renderStaffTable(staff);
    this.renderApproverRows(approvers, staffKeys);
    UI.$('apAddRow').addEventListener('click', () => this.appendApproverRow('', '', false, staffKeys));
    UI.$('apSave').addEventListener('click', () => this.saveApprovers());
  },

  renderStaffTable(list) {
    const body = UI.$('staffBody');
    body.innerHTML = (list || []).map(s =>
      '<tr>' +
      '<td class="px-4 py-2.5 whitespace-nowrap">' + UI.escapeHtml(s.name) +
      (s.registered ? '' : ' <span class="text-xs text-slate-400">(ยังไม่ลงทะเบียน)</span>') + '</td>' +
      '<td class="px-4 py-2.5 text-slate-500">' + UI.escapeHtml(s.group || '-') + '</td>' +
      '<td class="px-4 py-2.5"></td>' +
      '<td class="px-4 py-2.5 text-right"></td>' +
      '</tr>').join('');

    // ปุ่ม/select ผูก event ทีหลัง render ด้วย createElement — ไม่ฝัง payload ใน HTML string
    (list || []).forEach((s, i) => {
      const td = body.children[i].children[2];
      const sel = document.createElement('select');
      sel.className = 'px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white max-w-[200px]';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = s.employmentType || '— ยังไม่ระบุ —';
      sel.appendChild(placeholder);
      this.employmentTypes.forEach(t => {
        if (t === s.employmentType) return;
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        sel.appendChild(o);
      });
      td.appendChild(sel);

      const tdBtn = body.children[i].children[3];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-3 py-1.5 rounded-lg border border-slate-200 text-primary text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
      btn.textContent = 'บันทึก';
      btn.addEventListener('click', async () => {
        if (!sel.value) { UI.showToast('เลือกประเภทบุคลากรก่อนบันทึก', true); return; }
        UI.setBusy(btn, true, '…');
        try {
          await AdminAPI.call('set_staff_employment_type', { staffKey: s.key, employmentType: sel.value });
          placeholder.textContent = sel.value; // ค่าที่เลือกกลายเป็น placeholder ใหม่ของแถวนี้
          sel.value = '';
          UI.showToast('บันทึกแล้ว — ' + s.name + ' → ' + placeholder.textContent);
        } catch (e) {
          UI.showToast(e.message, true);
        } finally {
          UI.setBusy(btn, false, 'บันทึก');
        }
      });
      tdBtn.appendChild(btn);
    });
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
      await AdminAPI.call('save_approvers', { data: JSON.stringify(rows) });
      UI.showToast('บันทึกผู้อนุมัติแล้ว');
      await this.render(UI.$('view'), this._isStale); // โหลดใหม่เพื่ออัปเดตเลขแถว/ลิสต์จริง
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },
};
