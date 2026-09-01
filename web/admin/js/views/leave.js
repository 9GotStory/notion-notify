// หน้าสิทธิ์วันลา — โควตาตามประเภทบุคลากร + สมุดรายการปรับยอด (ยกมา/ใช้เพิ่ม)
// ย้ายมาจากแท็บ "โควตา" และ "ยอดวันลา" ของหน้าเดิมทั้ง pattern:
// edit-in-form (editing*Row null = โหมดเพิ่ม), dropdown เติมครั้งแรกเท่านั้น,
// ปุ่มแก้ไข/ลบผูก event หลัง render ด้วย createElement, โหลดใหม่หลังทุกการเปลี่ยนแปลง
'use strict';

AdminViews.leave = {

  requestId_() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },

  editingQuotaRow: null,
  editingQuotaVersion: null,
  editingBalanceRow: null,
  editingBalanceVersion: null,
  balanceRequestId: null,
  balanceRequestKey: '',
  activeSection: 'quotas',
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
      UI.pageHeader('จัดการสิทธิ์', 'สิทธิ์วันลา', 'กำหนดโควตาตามประเภทบุคลากร และบันทึกรายการยกมาหรือยอดใช้เพิ่มเติม') +
      '<section class="grid grid-cols-2 gap-2 mb-4" aria-label="สรุปสิทธิ์วันลา">' +
        '<div class="ui-card p-3 text-center"><p id="leaveQuotaCount" class="text-xl font-bold text-text">' + this.cache.quotaProfiles.length + '</p><p class="text-[11px] text-text-muted">รายการโควตา</p></div>' +
        '<div class="ui-card p-3 text-center"><p id="leaveBalanceCount" class="text-xl font-bold text-text">' + this.cache.balances.length + '</p><p class="text-[11px] text-text-muted">รายการปรับยอด</p></div>' +
      '</section>' +
      '<div class="ui-card grid grid-cols-2 gap-1 p-1 mb-4" role="tablist" aria-label="งานสิทธิ์วันลา">' +
        '<button id="leaveTabQuotas" type="button" role="tab" aria-controls="leaveQuotaSection" data-leave-section="quotas" class="min-h-11 rounded-control px-3 text-sm font-semibold">โควตาสิทธิ์</button>' +
        '<button id="leaveTabBalances" type="button" role="tab" aria-controls="leaveBalanceSection" data-leave-section="balances" class="min-h-11 rounded-control px-3 text-sm font-semibold">ปรับยอดวันลา</button>' +
      '</div>' +
      '<section id="leaveQuotaSection" role="tabpanel" aria-labelledby="leaveTabQuotas">' +
      '<!-- ===== โควตาตามประเภทบุคลากร ===== -->' +
      '<div class="ui-card ui-card-body mb-4">' +
      '<p class="ui-section-title">โควตาสิทธิ์ตามประเภทบุคลากร</p>' +
      '<p class="ui-help mb-3">ใช้ปีงบประมาณ 1 ต.ค.–30 ก.ย. ปีเว้นว่าง = ทุกปี ใส่ปี (เช่น 2570) = เฉพาะปีงบประมาณนั้น · โควตา <b>0 = ไม่มีสิทธิ์</b> · คลอด/บวชนับวันปฏิทิน ประเภทอื่นนับวันทำการ · ค่าเริ่มต้นต้องให้ HR ตรวจและลงวันที่ leave_policy_reviewed_at ก่อนใช้จริง</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><label for="q-year" class="ui-label">ปีงบประมาณ (พ.ศ. ว่าง = ทุกปี)</label><input id="q-year" type="number" inputmode="numeric" placeholder="เช่น 2570" class="ui-field"></div>' +
      '<div><label for="q-emptype" class="ui-label">ประเภทบุคลากร</label><select id="q-emptype" class="ui-field"><option value="">— เลือก —</option></select></div>' +
      '<div><label for="q-leavetype" class="ui-label">ประเภทการลา</label><select id="q-leavetype" class="ui-field"><option value="">— เลือก —</option></select></div>' +
      '<div><label for="q-quota" class="ui-label">เกณฑ์วันใช้สิทธิ์</label><input id="q-quota" type="number" step="0.5" min="0" placeholder="เช่น 10 หรือ 0 = ไม่มีสิทธิ์" class="ui-field"></div>' +
      '<div class="sm:col-span-2"><label for="q-note" class="ui-label">หมายเหตุ</label><input id="q-note" type="text" maxlength="200" placeholder="เช่น ตาม พ.ร.บ.คุ้มครองแรงงาน / เข้ากลางปี" class="ui-field"></div>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2 mt-3 sm:flex">' +
      '<button id="btnSaveQuota" type="button" class="ui-btn-primary">เพิ่มโควตา</button>' +
      '<button id="btnCancelEditQuota" type="button" class="ui-btn-secondary hidden">ยกเลิกการแก้ไข</button>' +
      '</div></div>' +

      '<div class="ui-card overflow-hidden">' +
      '<div id="quotaCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<div class="hidden overflow-x-auto sm:block"><table class="ui-data-table">' +
      '<thead><tr class="text-left text-xs text-slate-500 font-semibold">' +
      '<th class="px-4 py-2.5">ปีงบประมาณ</th><th class="px-4 py-2.5">ประเภทบุคลากร</th><th class="px-4 py-2.5">ประเภทการลา</th>' +
      '<th class="px-4 py-2.5 text-right">โควตา</th><th class="px-4 py-2.5">หมายเหตุ</th><th class="px-4 py-2.5"></th>' +
      '</tr></thead><tbody id="quotaBody" class="divide-y divide-slate-200"></tbody></table></div>' +
      '<div id="quotaEmpty" class="hidden">' + UI.emptyState('ยังไม่มีโควตา', 'รันเมนู “เติมสิทธิ์วันลาตามระเบียบ” ใน Google Sheet ก่อน') + '</div>' +
      '</div></section>' +

      '<!-- ===== สมุดรายการปรับยอด ===== -->' +
      '<section id="leaveBalanceSection" class="hidden" role="tabpanel" aria-labelledby="leaveTabBalances">' +
      '<div class="ui-card ui-card-body mb-4">' +
      '<p class="ui-section-title">สมุดรายการปรับยอดวันลา (ยกมา / ใช้เพิ่ม)</p>' +
      '<p class="ui-help mb-3">ยอดที่แสดงทุกจุดของระบบ = ใบลาจริงใน Notion + รายการในสมุดนี้ — <b>ยกมา</b> เพิ่มสิทธิ์ (เช่น พักร้อนสะสมจากปีก่อน) · <b>ใช้เพิ่ม</b> เพิ่มยอดที่ใช้ไปแล้ว (เช่น ลาก่อนใช้ระบบ)</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
      '<div><label for="b-year" class="ui-label">ปีงบประมาณ (พ.ศ.)</label><input id="b-year" type="number" inputmode="numeric" placeholder="เช่น 2570" class="ui-field"></div>' +
      '<div><label for="b-name" class="ui-label">ชื่อ สกุล</label><select id="b-name" class="ui-field"><option value="">— เลือก —</option></select></div>' +
      '<div><label for="b-type" class="ui-label">ประเภทการลา</label><select id="b-type" class="ui-field"><option value="">— เลือก —</option></select></div>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<div><label for="b-carry" class="ui-label">ยกมา (+สิทธิ์)</label><input id="b-carry" type="number" step="0.5" min="0" placeholder="0" class="ui-field"></div>' +
      '<div><label for="b-extra" class="ui-label">ใช้เพิ่ม (+ยอดใช้)</label><input id="b-extra" type="number" step="0.5" min="0" placeholder="0" class="ui-field"></div>' +
      '</div>' +
      '<div class="sm:col-span-2"><label for="b-reason" class="ui-label">เหตุผล <span class="text-red-600">*</span></label><input id="b-reason" type="text" maxlength="500" placeholder="อย่างน้อย 5 ตัวอักษร เช่น พักร้อนสะสมจากปีก่อน" class="ui-field"></div>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2 mt-3 sm:flex">' +
      '<button id="btnSaveBalance" type="button" class="ui-btn-primary">เพิ่มรายการ</button>' +
      '<button id="btnCancelEditBalance" type="button" class="ui-btn-secondary hidden">ยกเลิกการแก้ไข</button>' +
      '</div></div>' +

      '<div class="ui-card overflow-hidden">' +
      '<div id="balanceCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<div class="hidden overflow-x-auto sm:block"><table class="ui-data-table">' +
      '<thead><tr class="text-left text-xs text-slate-500 font-semibold">' +
      '<th class="px-4 py-2.5">ปีงบประมาณ</th><th class="px-4 py-2.5">ชื่อ สกุล</th><th class="px-4 py-2.5">ประเภท</th>' +
      '<th class="px-4 py-2.5 text-right">ยกมา</th><th class="px-4 py-2.5 text-right">ใช้เพิ่ม</th>' +
      '<th class="px-4 py-2.5">เหตุผล</th><th class="px-4 py-2.5"></th>' +
      '</tr></thead><tbody id="balanceBody" class="divide-y divide-slate-200"></tbody></table></div>' +
      '<div id="balanceEmpty" class="hidden">' + UI.emptyState('ยังไม่มีรายการปรับยอด', 'เพิ่มรายการเมื่อมีสิทธิ์ยกมาหรือยอดใช้ก่อนเริ่มระบบ') + '</div>' +
      '</div></section>';

    this.fillSelectOnce_('q-emptype', this.cache.employmentTypes);
    this.fillSelectOnce_('q-leavetype', this.cache.leaveTypes);
    this.fillSelectOnce_('b-name', this.cache.staffKeys);
    this.fillSelectOnce_('b-type', this.cache.leaveTypes);

    UI.$('btnSaveQuota').addEventListener('click', () => this.saveQuota());
    UI.$('btnCancelEditQuota').addEventListener('click', () => this.resetQuotaForm());
    UI.$('btnSaveBalance').addEventListener('click', () => this.saveBalance());
    UI.$('btnCancelEditBalance').addEventListener('click', () => this.resetBalanceForm());
    root.querySelectorAll('[data-leave-section]').forEach(button =>
      button.addEventListener('click', () => this.showSection_(button.dataset.leaveSection)));

    this.resetQuotaForm();
    this.resetBalanceForm();
    this.renderQuotas();
    this.renderBalances();
    this.showSection_(this.activeSection);
  },

  showSection_(section) {
    this.activeSection = section === 'balances' ? 'balances' : 'quotas';
    UI.$('leaveQuotaSection').classList.toggle('hidden', this.activeSection !== 'quotas');
    UI.$('leaveBalanceSection').classList.toggle('hidden', this.activeSection !== 'balances');
    document.querySelectorAll('[data-leave-section]').forEach(button => {
      const active = button.dataset.leaveSection === this.activeSection;
      button.className = 'min-h-11 rounded-control px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
        (active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-subtle');
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
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
    const cards = UI.$('quotaCards');
    cards.innerHTML = list.map(q =>
      '<article class="p-4">' +
        '<div class="flex items-start justify-between gap-3"><div class="min-w-0">' +
          '<p class="font-semibold text-text break-words">' + UI.escapeHtml(q.employmentType) + '</p>' +
          '<p class="mt-0.5 text-[13px] text-text-muted">' + UI.escapeHtml(q.leaveType) + '</p>' +
        '</div><span class="ui-badge ui-badge-info shrink-0">' + UI.escapeHtml(q.quota) + ' วัน</span></div>' +
        '<div class="mt-3 grid grid-cols-2 gap-2 text-[13px]">' +
          '<div class="rounded-control bg-surface-subtle px-3 py-2"><p class="text-text-muted">ปีงบประมาณ</p><p class="font-medium text-text">' + UI.escapeHtml(q.yearBE || 'ทุกปี') + '</p></div>' +
          '<div class="rounded-control bg-surface-subtle px-3 py-2"><p class="text-text-muted">หมายเหตุ</p><p class="font-medium text-text break-words">' + UI.escapeHtml(q.note || '—') + '</p></div>' +
        '</div><div data-role="quota-actions" class="mt-3 grid grid-cols-2 gap-2"></div>' +
      '</article>').join('');
    UI.$('quotaEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach((q, i) => {
      const td = body.children[i].lastElementChild;
      td.appendChild(this.quotaEditButton_(q, 'ui-btn-secondary px-3 text-xs'));
      td.appendChild(this.quotaDeleteButton_(q, 'ui-btn-danger ml-1 px-3 text-xs'));
      const actions = cards.children[i].querySelector('[data-role="quota-actions"]');
      actions.appendChild(this.quotaEditButton_(q, 'ui-btn-secondary'));
      actions.appendChild(this.quotaDeleteButton_(q, 'ui-btn-danger'));
    });
  },

  quotaEditButton_(quota, className) {
    return this.rowButton_('แก้ไขโควตา', className, () => {
      this.activeSection = 'quotas';
      this.editingQuotaRow = quota.row;
      this.editingQuotaVersion = quota.version;
      UI.$('q-year').value = quota.yearBE || '';
      UI.$('q-emptype').value = quota.employmentType;
      UI.$('q-leavetype').value = quota.leaveType;
      UI.$('q-quota').value = quota.quota;
      UI.$('q-note').value = quota.note || '';
      UI.$('btnSaveQuota').textContent = 'บันทึกโควตา';
      UI.$('btnCancelEditQuota').classList.remove('hidden');
      UI.$('leaveQuotaSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  },

  quotaDeleteButton_(quota, className) {
    let button;
    button = this.rowButton_('ลบโควตา', className, async () => {
      const accepted = await UI.confirm({
        title: 'ลบโควตานี้?',
        message: (quota.yearBE || 'ทุกปี') + ' · ' + quota.employmentType + ' · ' + quota.leaveType + ' = ' + quota.quota +
          '\nหากต้องการปิดสิทธิ์ ให้ตั้งโควตาเป็น 0 แทน เพราะเมื่อลบ ระบบอาจกลับไปใช้ค่าเริ่มต้น',
        confirmText: 'ลบโควตา', danger: true,
      });
      if (!accepted) return;
      UI.setBusy(button, true, 'กำลังลบ…');
      try {
        await AdminAPI.call('delete_quota_profile', { row: quota.row, version: quota.version });
        UI.showToast('ลบโควตาแล้ว');
        await this.reload();
      } catch (e) { UI.showToast(e.message, true); }
      finally { UI.setBusy(button, false); }
    });
    return button;
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
    const cards = UI.$('balanceCards');
    cards.innerHTML = list.map(b =>
      '<article class="p-4">' +
        '<div class="flex items-start justify-between gap-3"><div class="min-w-0">' +
          '<p class="font-semibold text-text break-words">' + UI.escapeHtml(b.name) + '</p>' +
          '<p class="mt-0.5 text-[13px] text-text-muted">' + UI.escapeHtml(b.leaveType) + ' · ปีงบประมาณ ' + UI.escapeHtml(b.yearBE) + '</p>' +
        '</div></div>' +
        '<div class="mt-3 grid grid-cols-2 gap-2 text-[13px]">' +
          '<div class="rounded-control bg-success-soft px-3 py-2"><p class="text-success">ยกมา (+สิทธิ์)</p><p class="font-semibold text-text">' + (UI.escapeHtml(b.carryIn) || '—') + '</p></div>' +
          '<div class="rounded-control bg-warning-soft px-3 py-2"><p class="text-warning">ใช้เพิ่ม (+ยอดใช้)</p><p class="font-semibold text-text">' + (UI.escapeHtml(b.usedExtra) || '—') + '</p></div>' +
        '</div><p class="mt-2 text-[13px] text-text-muted break-words">เหตุผล: ' + UI.escapeHtml(b.reason || '—') + '</p>' +
        '<div data-role="balance-actions" class="mt-3 grid grid-cols-2 gap-2"></div>' +
      '</article>').join('');
    UI.$('balanceEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach((b, i) => {
      const td = body.children[i].lastElementChild;
      td.appendChild(this.balanceEditButton_(b, 'ui-btn-secondary px-3 text-xs'));
      td.appendChild(this.balanceDeleteButton_(b, 'ui-btn-danger ml-1 px-3 text-xs'));
      const actions = cards.children[i].querySelector('[data-role="balance-actions"]');
      actions.appendChild(this.balanceEditButton_(b, 'ui-btn-secondary'));
      actions.appendChild(this.balanceDeleteButton_(b, 'ui-btn-danger'));
    });
  },

  balanceEditButton_(balance, className) {
    return this.rowButton_('แก้ไขรายการ', className, () => {
      this.activeSection = 'balances';
      this.editingBalanceRow = balance.row;
      this.editingBalanceVersion = balance.version;
      UI.$('b-year').value = balance.yearBE;
      UI.$('b-name').value = balance.name;
      UI.$('b-type').value = balance.leaveType;
      UI.$('b-carry').value = balance.carryIn || '';
      UI.$('b-extra').value = balance.usedExtra || '';
      UI.$('b-reason').value = balance.reason || '';
      UI.$('btnSaveBalance').textContent = 'บันทึกรายการปรับยอด';
      UI.$('btnCancelEditBalance').classList.remove('hidden');
      UI.$('leaveBalanceSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  },

  balanceDeleteButton_(balance, className) {
    let button;
    button = this.rowButton_('ลบรายการ', className, async () => {
      const detail = balance.yearBE + ' · ' + balance.name + ' · ' + balance.leaveType +
        (balance.carryIn ? ' · ยกมา ' + balance.carryIn : '') + (balance.usedExtra ? ' · ใช้เพิ่ม ' + balance.usedExtra : '');
      const accepted = await UI.confirm({
        title: 'ลบรายการปรับยอดนี้?', message: detail + '\nยอดสิทธิ์ของบุคลากรจะถูกคำนวณใหม่ทันที',
        confirmText: 'ลบรายการ', danger: true,
      });
      if (!accepted) return;
      UI.setBusy(button, true, 'กำลังลบ…');
      try {
        await AdminAPI.call('delete_balance', { row: balance.row, version: balance.version });
        UI.showToast('ลบรายการปรับยอดแล้ว');
        await this.reload();
      } catch (e) { UI.showToast(e.message, true); }
      finally { UI.setBusy(button, false); }
    });
    return button;
  },

  resetBalanceForm() {
    this.editingBalanceRow = null;
    this.editingBalanceVersion = null;
    this.balanceRequestId = null;
    this.balanceRequestKey = '';
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
    if (!payload.yearBE || !payload.name || !payload.leaveType) { UI.showToast('กรอกปีงบประมาณ ชื่อ และประเภทการลาให้ครบ', true); return; }
    if (payload.reason.length < 5) { UI.showToast('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร', true); return; }
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    const wasEditing = this.editingBalanceRow;
    try {
      if (!wasEditing) {
        const requestKey = JSON.stringify(payload);
        if (!this.balanceRequestId || this.balanceRequestKey !== requestKey) {
          this.balanceRequestId = this.requestId_();
          this.balanceRequestKey = requestKey;
        }
        payload.requestId = this.balanceRequestId;
      }
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
    const btn = UI.el('button', extraClass, text);
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
    if (UI.$('leaveQuotaCount')) UI.$('leaveQuotaCount').textContent = this.cache.quotaProfiles.length;
    if (UI.$('leaveBalanceCount')) UI.$('leaveBalanceCount').textContent = this.cache.balances.length;
    this.renderQuotas();
    this.renderBalances();
  },
};
