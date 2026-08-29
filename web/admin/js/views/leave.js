// หน้าสิทธิ์วันลา — โควตาตามประเภทบุคลากร + สมุดรายการปรับยอด (ยกมา/ใช้เพิ่ม)
// ย้ายมาจากแท็บ "โควตา" และ "ยอดวันลา" ของหน้าเดิมทั้ง pattern:
// edit-in-form (editing*Row null = โหมดเพิ่ม), dropdown เติมครั้งแรกเท่านั้น,
// ปุ่มแก้ไข/ลบผูก event หลัง render ด้วย createElement, โหลดใหม่หลังทุกการเปลี่ยนแปลง
'use strict';

AdminViews.leave = {

  editingQuotaRow: null,
  editingQuotaVersion: null,
  editingBalanceRow: null,
  editingBalanceVersion: null,
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว
  cache: { quotaProfiles: [], balances: [], employmentTypes: [], leaveTypes: [], staffKeys: [] },

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML = '<div class="text-center text-slate-400 text-sm py-10">กำลังโหลด…</div>';
    const [quotaRes, balanceRes] = await Promise.all([
      AdminAPI.call('get_quota_profiles'),
      AdminAPI.call('get_balances'),
    ]);
    if (isStale()) return; // ผู้ใช้ไปหน้าอื่นแล้ว — หยุดก่อนแตะ DOM
    this.cache = {
      quotaProfiles: quotaRes.profiles || [],
      employmentTypes: quotaRes.employmentTypes || [],
      leaveTypes: quotaRes.leaveTypes || [],
      balances: balanceRes.balances || [],
      staffKeys: balanceRes.staffKeys || [],
    };
    // leaveTypes ของสมุดยอดมาจาก get_balances — เอาฝั่งไหนครบกว่าใช้ฝั่งนั้น
    if ((balanceRes.leaveTypes || []).length > this.cache.leaveTypes.length) {
      this.cache.leaveTypes = balanceRes.leaveTypes;
    }

    root.innerHTML =
      '<!-- ===== โควตาตามประเภทบุคลากร ===== -->' +
      '<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 mb-1">โควตาสิทธิ์ตามประเภทบุคลากร</p>' +
      '<p class="text-xs text-slate-500 mb-3">ปีเว้นว่าง = ทุกปี ใส่ปี (เช่น 2569) = เฉพาะปีนั้น · โควตา <b>0 = ไม่มีสิทธิ์</b> · คลอด/บวชนับวันปฏิทิน ประเภทอื่นนับวันทำการ · ค่าเริ่มต้นต้องให้ HR ตรวจและลงวันที่ leave_policy_reviewed_at ก่อนใช้จริง</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ปี (พ.ศ. ว่าง = ทุกปี)</label>' +
      '<input id="q-year" type="number" inputmode="numeric" placeholder="เช่น 2569" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ประเภทบุคลากร</label>' +
      '<select id="q-emptype" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"><option value="">— เลือก —</option></select></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ประเภทการลา</label>' +
      '<select id="q-leavetype" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"><option value="">— เลือก —</option></select></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">เกณฑ์วันใช้สิทธิ์</label>' +
      '<input id="q-quota" type="number" step="0.5" min="0" placeholder="เช่น 10 หรือ 0 = ไม่มีสิทธิ์" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '<div class="sm:col-span-2"><label class="block text-xs font-semibold text-slate-500 mb-1.5">หมายเหตุ</label>' +
      '<input id="q-note" type="text" maxlength="200" placeholder="เช่น ตาม พ.ร.บ.คุ้มครองแรงงาน / เข้ากลางปี" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '</div>' +
      '<div class="flex gap-2 mt-3">' +
      '<button id="btnSaveQuota" type="button" class="h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">เพิ่มโควตา</button>' +
      '<button id="btnCancelEditQuota" type="button" class="hidden h-[38px] px-4 rounded-lg font-semibold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200">ยกเลิกการแก้ไข</button>' +
      '</div></div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-6">' +
      '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="text-left text-xs text-slate-500 font-semibold">' +
      '<th class="px-4 py-2.5">ปี</th><th class="px-4 py-2.5">ประเภทบุคลากร</th><th class="px-4 py-2.5">ประเภทการลา</th>' +
      '<th class="px-4 py-2.5 text-right">โควตา</th><th class="px-4 py-2.5">หมายเหตุ</th><th class="px-4 py-2.5"></th>' +
      '</tr></thead><tbody id="quotaBody" class="divide-y divide-slate-200"></tbody></table></div>' +
      '<p id="quotaEmpty" class="hidden text-center text-slate-500 text-sm py-8">ยังไม่มีโควตา — รันเมนู "เติมสิทธิ์วันลาตามระเบียบ" ใน Google Sheet ก่อน</p>' +
      '</div>' +

      '<!-- ===== สมุดรายการปรับยอด ===== -->' +
      '<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4">' +
      '<p class="text-sm font-semibold text-slate-600 mb-1">สมุดรายการปรับยอดวันลา (ยกมา / ใช้เพิ่ม)</p>' +
      '<p class="text-xs text-slate-500 mb-3">ยอดที่แสดงทุกจุดของระบบ = ใบลาจริงใน Notion + รายการในสมุดนี้ — <b>ยกมา</b> เพิ่มสิทธิ์ (เช่น พักร้อนสะสมจากปีก่อน) · <b>ใช้เพิ่ม</b> เพิ่มยอดที่ใช้ไปแล้ว (เช่น ลาก่อนใช้ระบบ)</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ปี (พ.ศ.)</label>' +
      '<input id="b-year" type="number" inputmode="numeric" placeholder="เช่น 2569" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ชื่อ สกุล</label>' +
      '<select id="b-name" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"><option value="">— เลือก —</option></select></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ประเภทการลา</label>' +
      '<select id="b-type" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"><option value="">— เลือก —</option></select></div>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ยกมา (+สิทธิ์)</label>' +
      '<input id="b-carry" type="number" step="0.5" min="0" placeholder="0" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">ใช้เพิ่ม (+ยอดใช้)</label>' +
      '<input id="b-extra" type="number" step="0.5" min="0" placeholder="0" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '</div>' +
      '<div class="sm:col-span-2"><label class="block text-xs font-semibold text-slate-500 mb-1.5">เหตุผล</label>' +
      '<input id="b-reason" type="text" maxlength="200" placeholder="เช่น พักร้อนสะสมจากปีก่อน / ลาก่อนใช้ระบบ" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
      '</div>' +
      '<div class="flex gap-2 mt-3">' +
      '<button id="btnSaveBalance" type="button" class="h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">เพิ่มรายการ</button>' +
      '<button id="btnCancelEditBalance" type="button" class="hidden h-[38px] px-4 rounded-lg font-semibold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200">ยกเลิกการแก้ไข</button>' +
      '</div></div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
      '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="text-left text-xs text-slate-500 font-semibold">' +
      '<th class="px-4 py-2.5">ปี</th><th class="px-4 py-2.5">ชื่อ สกุล</th><th class="px-4 py-2.5">ประเภท</th>' +
      '<th class="px-4 py-2.5 text-right">ยกมา</th><th class="px-4 py-2.5 text-right">ใช้เพิ่ม</th>' +
      '<th class="px-4 py-2.5">เหตุผล</th><th class="px-4 py-2.5"></th>' +
      '</tr></thead><tbody id="balanceBody" class="divide-y divide-slate-200"></tbody></table></div>' +
      '<p id="balanceEmpty" class="hidden text-center text-slate-500 text-sm py-8">ยังไม่มีรายการปรับยอด</p>' +
      '</div>';

    this.fillSelectOnce_('q-emptype', this.cache.employmentTypes);
    this.fillSelectOnce_('q-leavetype', this.cache.leaveTypes);
    this.fillSelectOnce_('b-name', this.cache.staffKeys);
    this.fillSelectOnce_('b-type', this.cache.leaveTypes);

    UI.$('btnSaveQuota').addEventListener('click', () => this.saveQuota());
    UI.$('btnCancelEditQuota').addEventListener('click', () => this.resetQuotaForm());
    UI.$('btnSaveBalance').addEventListener('click', () => this.saveBalance());
    UI.$('btnCancelEditBalance').addEventListener('click', () => this.resetBalanceForm());

    this.resetQuotaForm();
    this.resetBalanceForm();
    this.renderQuotas();
    this.renderBalances();
  },

  fillSelectOnce_(id, options) {
    const sel = UI.$(id);
    if (sel.options.length > 1) return; // เติมครั้งแรกเท่านั้น — กันเขียนทับของที่กำลังแก้
    options.forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
  },

  renderQuotas() {
    const list = this.cache.quotaProfiles;
    const body = UI.$('quotaBody');
    if (!body) return; // ตารางไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    body.innerHTML = list.map(q =>
      '<tr>' +
      '<td class="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(q.yearBE || 'ทุกปี') + '</td>' +
      '<td class="px-4 py-2.5 whitespace-nowrap">' + UI.escapeHtml(q.employmentType) + '</td>' +
      '<td class="px-4 py-2.5">' + UI.escapeHtml(q.leaveType) + '</td>' +
      '<td class="px-4 py-2.5 text-right font-mono text-xs">' + UI.escapeHtml(q.quota) + '</td>' +
      '<td class="px-4 py-2.5 text-slate-500 text-xs">' + UI.escapeHtml(q.note) + '</td>' +
      '<td class="px-4 py-2.5 text-right whitespace-nowrap"></td>' +
      '</tr>').join('');
    UI.$('quotaEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach((q, i) => {
      const td = body.children[i].lastElementChild;
      td.appendChild(this.rowButton_('แก้ไข', 'text-primary hover:bg-slate-50', () => {
        this.editingQuotaRow = q.row;
        this.editingQuotaVersion = q.version;
        UI.$('q-year').value = q.yearBE || '';
        UI.$('q-emptype').value = q.employmentType;
        UI.$('q-leavetype').value = q.leaveType;
        UI.$('q-quota').value = q.quota;
        UI.$('q-note').value = q.note || '';
        UI.$('btnSaveQuota').textContent = 'บันทึกการแก้ไข';
        UI.$('btnCancelEditQuota').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
      td.appendChild(this.rowButton_('ลบ', 'text-red-700 hover:bg-red-50 ml-1', async () => {
        if (!confirm('ลบโควตานี้?\n' + (q.yearBE || 'ทุกปี') + ' · ' + q.employmentType + ' · ' + q.leaveType + ' = ' + q.quota +
          '\n(ถ้าต้องการ "ปิด" สิทธิ์ ให้ตั้งค่าเป็น 0 แทนการลบ — ลบแล้วระบบใช้ค่าเริ่มต้น)')) return;
        try {
          await AdminAPI.call('delete_quota_profile', { row: q.row, version: q.version });
          UI.showToast('ลบแล้ว');
          await this.reload();
        } catch (e) { UI.showToast(e.message, true); }
      }));
    });
  },

  resetQuotaForm() {
    this.editingQuotaRow = null;
    this.editingQuotaVersion = null;
    ['q-year', 'q-quota', 'q-note'].forEach(id => { UI.$(id).value = ''; });
    UI.$('q-emptype').value = '';
    UI.$('q-leavetype').value = '';
    UI.$('btnSaveQuota').textContent = 'เพิ่มโควตา';
    UI.$('btnCancelEditQuota').classList.add('hidden');
  },

  async saveQuota() {
    const btn = UI.$('btnSaveQuota');
    const payload = {
      yearBE: UI.$('q-year').value.trim(),
      employmentType: UI.$('q-emptype').value,
      leaveType: UI.$('q-leavetype').value,
      quota: UI.$('q-quota').value.trim(),
      note: UI.$('q-note').value.trim(),
    };
    if (!payload.employmentType || !payload.leaveType) { UI.showToast('เลือกประเภทบุคลากรและประเภทการลาให้ครบ', true); return; }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    const wasEditing = this.editingQuotaRow;
    try {
      const call = wasEditing ? 'update_quota_profile' : 'add_quota_profile';
      const args = wasEditing
        ? { row: wasEditing, version: this.editingQuotaVersion, yearBE: payload.yearBE, employmentType: payload.employmentType, leaveType: payload.leaveType, quota: payload.quota, note: payload.note }
        : payload;
      await AdminAPI.call(call, args);
      UI.showToast(wasEditing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มโควตาแล้ว');
      this.resetQuotaForm();
      await this.reload();
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },

  renderBalances() {
    const list = this.cache.balances;
    const body = UI.$('balanceBody');
    if (!body) return; // ตารางไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    body.innerHTML = list.map(b =>
      '<tr>' +
      '<td class="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">' + UI.escapeHtml(b.yearBE) + '</td>' +
      '<td class="px-4 py-2.5 whitespace-nowrap">' + UI.escapeHtml(b.name) + '</td>' +
      '<td class="px-4 py-2.5">' + UI.escapeHtml(b.leaveType) + '</td>' +
      '<td class="px-4 py-2.5 text-right font-mono text-xs">' + (UI.escapeHtml(b.carryIn) || '—') + '</td>' +
      '<td class="px-4 py-2.5 text-right font-mono text-xs">' + (UI.escapeHtml(b.usedExtra) || '—') + '</td>' +
      '<td class="px-4 py-2.5 text-slate-500 text-xs">' + UI.escapeHtml(b.reason) + '</td>' +
      '<td class="px-4 py-2.5 text-right whitespace-nowrap"></td>' +
      '</tr>').join('');
    UI.$('balanceEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach((b, i) => {
      const td = body.children[i].lastElementChild;
      td.appendChild(this.rowButton_('แก้ไข', 'text-primary hover:bg-slate-50', () => {
        this.editingBalanceRow = b.row;
        this.editingBalanceVersion = b.version;
        UI.$('b-year').value = b.yearBE;
        UI.$('b-name').value = b.name;
        UI.$('b-type').value = b.leaveType;
        UI.$('b-carry').value = b.carryIn || '';
        UI.$('b-extra').value = b.usedExtra || '';
        UI.$('b-reason').value = b.reason || '';
        UI.$('btnSaveBalance').textContent = 'บันทึกการแก้ไข';
        UI.$('btnCancelEditBalance').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
      td.appendChild(this.rowButton_('ลบ', 'text-red-700 hover:bg-red-50 ml-1', async () => {
        if (!confirm('ลบรายการปรับยอดนี้?\n' + b.yearBE + ' · ' + b.name + ' · ' + b.leaveType +
          (b.carryIn ? ' · ยกมา ' + b.carryIn : '') + (b.usedExtra ? ' · ใช้เพิ่ม ' + b.usedExtra : ''))) return;
        try {
          await AdminAPI.call('delete_balance', { row: b.row, version: b.version });
          UI.showToast('ลบแล้ว');
          await this.reload();
        } catch (e) { UI.showToast(e.message, true); }
      }));
    });
  },

  resetBalanceForm() {
    this.editingBalanceRow = null;
    this.editingBalanceVersion = null;
    ['b-year', 'b-carry', 'b-extra', 'b-reason'].forEach(id => { UI.$(id).value = ''; });
    UI.$('b-name').value = '';
    UI.$('b-type').value = '';
    UI.$('btnSaveBalance').textContent = 'เพิ่มรายการ';
    UI.$('btnCancelEditBalance').classList.add('hidden');
  },

  async saveBalance() {
    const btn = UI.$('btnSaveBalance');
    const payload = {
      yearBE: UI.$('b-year').value.trim(),
      name: UI.$('b-name').value,
      leaveType: UI.$('b-type').value,
      carryIn: UI.$('b-carry').value.trim(),
      usedExtra: UI.$('b-extra').value.trim(),
      reason: UI.$('b-reason').value.trim(),
    };
    if (!payload.yearBE || !payload.name || !payload.leaveType) { UI.showToast('กรอกปี ชื่อ และประเภทการลาให้ครบ', true); return; }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    const wasEditing = this.editingBalanceRow;
    try {
      await AdminAPI.call(wasEditing ? 'update_balance' : 'add_balance',
        wasEditing ? Object.assign({ row: wasEditing, version: this.editingBalanceVersion }, payload) : payload);
      UI.showToast(wasEditing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มรายการแล้ว');
      this.resetBalanceForm();
      await this.reload();
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },

  rowButton_(text, extraClass, onClick) {
    const btn = UI.el('button', 'px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium ' + extraClass, text);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  },

  async reload() {
    const [quotaRes, balanceRes] = await Promise.all([
      AdminAPI.call('get_quota_profiles'),
      AdminAPI.call('get_balances'),
    ]);
    if (this._isStale && this._isStale()) return; // หน้าเปลี่ยนระหว่างรอ API — ทิ้งผลเก่า
    this.cache.quotaProfiles = quotaRes.profiles || [];
    this.cache.balances = balanceRes.balances || [];
    this.renderQuotas();
    this.renderBalances();
  },
};
