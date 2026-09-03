// หน้าบุคลากร — แยกงานทำเนียบ การตรวจสอบการผูก LINE และผู้อนุมัติการลาออกจากกัน
// (ตำแหน่ง ประเภทบุคลากร กลุ่มงาน และผู้อนุมัติอ้างอิงจากข้อมูลมาตรฐานของระบบ)
'use strict';

AdminViews.staff = {

  employmentTypes: [],
  positionOptions: [],
  approversVersion: '',
  staffList: [],
  staffQuery: '',
  staffFilter: 'all',
  activeSection: 'directory',
  staffPage: 1,
  staffPageSize: 10,
  reviewTarget: null,
  reviewPreviousFocus: null,
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

    const pendingCount = staff.filter(s => this.isReviewable_(s)).length;
    const registeredCount = staff.filter(s => s.registered).length;
    let html =
      UI.pageHeader('จัดการบุคลากร', 'บุคลากร', 'ค้นหา แก้ไขข้อมูล และตรวจสอบการผูกบัญชี โดยไม่ปะปนกับการอนุมัติใบลา') +
      '<section class="grid grid-cols-3 gap-2 mb-4" aria-label="สรุปบุคลากร">' +
        this.summaryCard_('บุคลากรทั้งหมด', staff.length, 'text-slate-800') +
        this.summaryCard_('รอตรวจสอบ', pendingCount, pendingCount ? 'text-amber-700' : 'text-slate-800') +
        this.summaryCard_('ผูก LINE แล้ว', registeredCount, 'text-emerald-700') +
      '</section>' +
      '<div class="bg-white border border-slate-200 rounded-2xl p-1 mb-4 overflow-x-auto" role="tablist" aria-label="งานบุคลากร">' +
        this.tabButton_('directory', 'ทำเนียบบุคลากร', staff.length) +
        this.tabButton_('bindings', 'รอตรวจสอบ LINE', pendingCount) +
        this.tabButton_('approvers', 'ผู้อนุมัติการลา', approvers.length) +
      '</div>' +

      '<section id="staffDirectorySection" role="tabpanel" aria-labelledby="staffTabDirectory">' +
        '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
          '<div class="p-4 border-b border-slate-100">' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
              '<label class="block">' +
                '<span class="sr-only">ค้นหาบุคลากร</span>' +
                '<input id="staffSearch" type="search" class="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="ค้นหาชื่อ รหัส ตำแหน่ง หรือกลุ่มงาน" value="' + UI.escapeHtml(this.staffQuery) + '">' +
              '</label>' +
              '<label class="block">' +
                '<span class="sr-only">กรองสถานะบุคลากร</span>' +
                '<select id="staffStatusFilter" class="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">' +
                  '<option value="all">ทุกสถานะ</option>' +
                  '<option value="pending">รอตรวจสอบ LINE</option>' +
                  '<option value="approved">ผูก LINE แล้ว</option>' +
                  '<option value="incomplete">ข้อมูลยังไม่ครบ</option>' +
                '</select>' +
              '</label>' +
            '</div>' +
            '<p id="staffResultSummary" class="mt-2 text-xs text-slate-500" aria-live="polite"></p>' +
          '</div>' +
          '<div id="staffCards" class="divide-y divide-slate-100"></div>' +
          '<div id="staffPagination" class="hidden border-t border-slate-100 px-4 py-3"></div>' +
          '<p class="text-xs text-slate-400 px-4 py-3 border-t border-slate-100">HR เตรียมข้อมูลทำเนียบและรหัสบุคลากรโดยเว้นสถานะทั้งสองช่อง ระบบจะตั้ง PENDING เมื่อขอผูก และตั้ง ACTIVE/APPROVED เมื่ออนุมัติ</p>' +
        '</div>' +
      '</section>' +

      '<section id="staffBindingsSection" class="hidden" role="tabpanel" aria-labelledby="staffTabBindings">' +
        '<div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-3">' +
          '<p class="font-semibold text-amber-800">ตรวจสอบตัวตนก่อนอนุมัติ</p>' +
          '<p class="mt-1 text-xs text-amber-700">เปรียบเทียบชื่อ รหัสบุคลากร และข้อมูล LINE กับทำเนียบ การอนุมัตินี้เป็นการผูกบัญชีผู้ใช้ ไม่ใช่การอนุมัติใบลา</p>' +
        '</div>' +
        '<div id="staffBindingCards" class="space-y-3"></div>' +
      '</section>' +

      '<section id="staffApproversSection" class="hidden" role="tabpanel" aria-labelledby="staffTabApprovers">' +
        '<div class="bg-white border border-slate-200 rounded-2xl p-4">' +
          '<div class="flex items-center justify-between gap-3 mb-1">' +
            '<div><p class="font-semibold text-slate-800">ผู้อนุมัติการลา</p>' +
            '<p class="text-xs text-slate-500">กำหนดผู้รับผิดชอบแยกตามกลุ่มงาน</p></div>' +
            '<button id="apAddRow" type="button" class="min-h-11 shrink-0 px-3 rounded-lg text-sm text-primary font-semibold hover:bg-primary-light">+ เพิ่มกลุ่ม</button>' +
          '</div>' +
          '<p class="text-xs text-slate-500 mb-3">เลือกกลุ่มงานและผู้อนุมัติจากทำเนียบ Staff โดยตรง ผู้อนุมัติต้องผูก LINE และได้รับอนุมัติแล้ว — บันทึกแบบแทนที่ทั้งตาราง</p>' +
          '<div id="apRows" class="space-y-2"></div>' +
          '<button id="apSave" type="button" class="mt-4 min-h-11 w-full sm:w-auto px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">บันทึกผู้อนุมัติทั้งหมด</button>' +
        '</div>' +
      '</section>' +

      '<div id="staffReviewDialog" class="hidden fixed inset-0 z-50 bg-slate-900/50 p-4 items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="staffReviewTitle">' +
        '<div class="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-xl p-5">' +
          '<div class="flex items-start justify-between gap-3">' +
            '<div><p id="staffReviewEyebrow" class="text-xs font-semibold tracking-wide text-primary"></p>' +
            '<h3 id="staffReviewTitle" class="mt-1 text-lg font-bold text-slate-900"></h3></div>' +
            '<button id="staffReviewClose" type="button" class="w-11 h-11 shrink-0 rounded-full text-slate-500 hover:bg-slate-100" aria-label="ปิดหน้าต่าง">✕</button>' +
          '</div>' +
          '<div id="staffReviewDetails" class="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"></div>' +
          '<label for="staffReviewReason" class="block mt-4 text-sm font-semibold text-slate-700">หลักฐานหรือเหตุผล <span class="font-normal text-slate-400">(5–500 ตัวอักษร)</span></label>' +
          '<textarea id="staffReviewReason" rows="3" maxlength="500" class="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"></textarea>' +
          '<p id="staffReviewError" class="hidden mt-1.5 text-xs text-red-600"></p>' +
          '<p id="staffReviewEffect" class="mt-3 text-xs text-slate-500"></p>' +
          '<div class="mt-5 grid grid-cols-2 gap-2">' +
            '<button id="staffReviewCancel" type="button" class="min-h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">ยกเลิก</button>' +
            '<button id="staffReviewSubmit" type="button" class="min-h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50"></button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;
    UI.$('staffStatusFilter').value = this.staffFilter;
    this.bindSectionTabs_();
    this.bindDirectoryControls_();
    this.bindReviewDialog_();
    this.renderStaffPage_();
    this.renderBindingCards_();
    this.renderApproverRows(approvers, approverStaffOptions, approverGroupOptions);
    UI.$('apAddRow').addEventListener('click', () =>
      this.appendApproverRow('', '', false, approverStaffOptions, approverGroupOptions));
    UI.$('apSave').addEventListener('click', () => this.saveApprovers());
    this.showSection_(this.activeSection);
  },

  summaryCard_(label, value, valueClass) {
    return '<div class="ui-card min-w-0 p-3 text-center">' +
      '<p class="text-xl font-bold ' + valueClass + '">' + value + '</p>' +
      '<p class="mt-0.5 text-[11px] text-slate-500 break-words">' + label + '</p>' +
    '</div>';
  },

  tabButton_(section, label, count) {
    const id = section.charAt(0).toUpperCase() + section.slice(1);
    return '<button id="staffTab' + id + '" type="button" role="tab" aria-controls="staff' + id + 'Section" data-staff-section="' + section + '" class="min-h-11 min-w-[140px] px-3 rounded-xl text-sm font-semibold whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">' +
      label + ' <span class="ml-1 text-xs">' + count + '</span></button>';
  },

  bindSectionTabs_() {
    document.querySelectorAll('[data-staff-section]').forEach(button => {
      button.addEventListener('click', () => this.showSection_(button.dataset.staffSection));
    });
  },

  showSection_(section) {
    const allowed = ['directory', 'bindings', 'approvers'];
    this.activeSection = allowed.includes(section) ? section : 'directory';
    const sections = {
      directory: UI.$('staffDirectorySection'),
      bindings: UI.$('staffBindingsSection'),
      approvers: UI.$('staffApproversSection'),
    };
    document.querySelectorAll('[data-staff-section]').forEach(button => {
      const active = button.dataset.staffSection === this.activeSection;
      button.className = 'min-h-11 min-w-[140px] px-3 rounded-xl text-sm font-semibold whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' +
        (active ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50');
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.keys(sections).forEach(name => sections[name].classList.toggle('hidden', name !== this.activeSection));
  },

  bindDirectoryControls_() {
    UI.$('staffSearch').addEventListener('input', event => {
      this.staffQuery = event.target.value;
      this.staffPage = 1;
      this.renderStaffPage_();
    });
    UI.$('staffStatusFilter').addEventListener('change', event => {
      this.staffFilter = event.target.value;
      this.staffPage = 1;
      this.renderStaffPage_();
    });
  },

  isReviewable_(staff) {
    return staff.bindingStatus === 'PENDING' ||
      (!!staff.lineUserId && staff.bindingStatus !== 'APPROVED');
  },

  isIncomplete_(staff) {
    return !staff.employeeId || !staff.group || !staff.position || !staff.employmentType;
  },

  filteredStaff_() {
    const query = this.staffQuery.trim().toLocaleLowerCase('th');
    return this.staffList.filter(staff => {
      const matchesQuery = !query || [staff.name, staff.employeeId, staff.position, staff.group, staff.employmentType]
        .some(value => String(value || '').toLocaleLowerCase('th').includes(query));
      if (!matchesQuery) return false;
      if (this.staffFilter === 'pending') return this.isReviewable_(staff);
      if (this.staffFilter === 'approved') return !!staff.registered;
      if (this.staffFilter === 'incomplete') return this.isIncomplete_(staff);
      return true;
    });
  },

  staffPageCount_() {
    return Math.max(1, Math.ceil(this.filteredStaff_().length / this.staffPageSize));
  },

  staffPageItems_() {
    const start = (this.staffPage - 1) * this.staffPageSize;
    return this.filteredStaff_().slice(start, start + this.staffPageSize);
  },

  renderStaffPage_() {
    this.staffPage = Math.min(Math.max(1, this.staffPage), this.staffPageCount_());
    this.renderStaffCards(this.staffPageItems_());
    const filtered = this.filteredStaff_();
    UI.$('staffResultSummary').textContent = filtered.length === this.staffList.length
      ? 'แสดงบุคลากรทั้งหมด ' + filtered.length + ' คน'
      : 'พบ ' + filtered.length + ' จาก ' + this.staffList.length + ' คน';
    const pagination = UI.$('staffPagination');
    if (filtered.length <= this.staffPageSize) {
      pagination.classList.add('hidden');
      pagination.innerHTML = '';
      return;
    }
    pagination.classList.remove('hidden');
    pagination.innerHTML =
      '<div class="flex items-center justify-between gap-3">' +
        '<p class="text-xs text-slate-500">หน้า ' + this.staffPage + ' จาก ' + this.staffPageCount_() + ' · ' + filtered.length + ' คน</p>' +
        '<div class="flex gap-2">' +
          '<button id="staffPrev" type="button" class="min-h-11 px-3 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-40">ก่อนหน้า</button>' +
          '<button id="staffNext" type="button" class="min-h-11 px-3 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-40">ถัดไป</button>' +
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
      wrap.innerHTML = '<div class="px-4 py-10 text-center"><p class="font-medium text-slate-600">ไม่พบบุคลากร</p>' +
        '<p class="mt-1 text-sm text-slate-400">ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ</p></div>';
      return;
    }
    wrap.innerHTML = list.map(s => {
      return '<article class="p-4">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<p class="font-semibold text-slate-800 break-words">' + UI.escapeHtml(s.name) + '</p>' +
            '<p class="mt-0.5 text-xs text-slate-500 break-words">' + UI.escapeHtml(s.position || 'ยังไม่ระบุตำแหน่ง') +
              ' · ' + UI.escapeHtml(s.group || 'ยังไม่ระบุกลุ่มงาน') + '</p>' +
          '</div>' +
          '<span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ' + this.bindingStatusClass_(s) + '">' +
            UI.escapeHtml(this.bindingStatusLabel_(s)) + '</span>' +
        '</div>' +
        '<div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">' +
          this.staffFact_('รหัสบุคลากร', s.employeeId || 'ยังไม่ระบุ', true) +
          this.staffFact_('ประเภท', s.employmentType || 'ยังไม่ระบุ') +
          this.staffFact_('สถานะบุคลากร', this.employmentStatusLabel_(s)) +
        '</div>' +
        '<details class="mt-3 rounded-xl border border-slate-200">' +
          '<summary class="min-h-11 px-3 flex items-center justify-between gap-2 text-sm font-semibold text-primary cursor-pointer">' +
            '<span>แก้ไขข้อมูลบุคลากร</span><span aria-hidden="true">⌄</span></summary>' +
          '<div class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">' +
            '<div class="rounded-xl bg-slate-50 p-3">' +
              '<label class="block text-xs font-medium text-slate-500 mb-1.5">ตำแหน่ง</label>' +
              '<div data-role="position-control"></div>' +
            '</div>' +
            '<div class="rounded-xl bg-slate-50 p-3">' +
              '<label class="block text-xs font-medium text-slate-500 mb-1.5">ประเภทบุคลากร</label>' +
              '<div data-role="employment-control"></div>' +
            '</div>' +
          '</div>' +
        '</details>' +
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
    });
  },

  staffFact_(label, value, mono) {
    return '<div class="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2">' +
      '<p class="text-[11px] text-slate-400">' + label + '</p>' +
      '<p class="mt-0.5 font-medium text-slate-700 break-words' + (mono ? ' font-mono' : '') + '">' + UI.escapeHtml(value) + '</p>' +
    '</div>';
  },

  employmentStatusLabel_(staff) {
    if (staff.employmentStatus === 'ACTIVE') return 'พร้อมใช้งาน';
    if (staff.employmentStatus) return 'หยุดใช้งาน';
    return 'ยังไม่เปิดใช้งาน';
  },

  bindingStatusLabel_(staff) {
    if (this.isReviewable_(staff)) return 'รอตรวจสอบ LINE';
    if (staff.bindingStatus === 'APPROVED') return 'ผูก LINE แล้ว';
    return 'ยังไม่ผูก LINE';
  },

  bindingStatusClass_(staff) {
    if (this.isReviewable_(staff)) return 'bg-amber-50 text-amber-700';
    if (staff.bindingStatus === 'APPROVED') return 'bg-emerald-50 text-emerald-700';
    return 'bg-slate-100 text-slate-600';
  },

  renderBindingCards_() {
    const wrap = UI.$('staffBindingCards');
    const pending = this.staffList.filter(staff => this.isReviewable_(staff));
    if (!pending.length) {
      wrap.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl px-4 py-12 text-center">' +
        '<p class="text-lg" aria-hidden="true">✓</p><p class="mt-2 font-semibold text-slate-700">ไม่มีรายการรอตรวจสอบ</p>' +
        '<p class="mt-1 text-sm text-slate-400">คำขอผูกบัญชีใหม่จะแสดงในหน้านี้</p></div>';
      return;
    }
    wrap.innerHTML = pending.map(staff =>
      '<article class="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0"><p class="font-semibold text-slate-800 break-words">' + UI.escapeHtml(staff.name) + '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500">ขอผูกกับ LINE: <span class="font-medium text-slate-700">' +
            UI.escapeHtml(staff.pendingLineDisplayName || 'ไม่พบชื่อแสดงผล') + '</span></p></div>' +
          '<span class="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">รอตรวจสอบ</span>' +
        '</div>' +
        '<div class="mt-3 grid grid-cols-2 gap-2 text-xs">' +
          this.staffFact_('รหัสบุคลากร', staff.employeeId || 'ยังไม่ระบุ', true) +
          this.staffFact_('กลุ่มงาน', staff.group || 'ยังไม่ระบุ') +
          this.staffFact_('ตำแหน่ง', staff.position || 'ยังไม่ระบุ') +
          this.staffFact_('ประเภท', staff.employmentType || 'ยังไม่ระบุ') +
        '</div>' +
        (staff.bindingRequestedAt ? '<p class="mt-2 text-xs text-slate-400">ส่งคำขอ ' + UI.escapeHtml(UI.formatThaiDateTime(staff.bindingRequestedAt)) + '</p>' : '') +
        '<div data-role="binding-actions" class="mt-4 grid grid-cols-2 gap-2"></div>' +
      '</article>').join('');
    pending.forEach((staff, index) => {
      const actions = wrap.children[index].querySelector('[data-role="binding-actions"]');
      ['reject', 'approve'].forEach(action => {
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'min-h-11 px-4 rounded-xl border text-sm font-semibold ' +
          (action === 'approve' ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700' :
            'border-red-200 bg-white text-red-700 hover:bg-red-50');
        reviewButton.textContent = action === 'approve' ? 'ตรวจสอบและอนุมัติ' : 'ปฏิเสธ';
        reviewButton.addEventListener('click', () => this.openReviewDialog_(staff, action));
        actions.appendChild(reviewButton);
      });
    });
  },

  bindReviewDialog_() {
    UI.$('staffReviewClose').addEventListener('click', () => this.closeReviewDialog_());
    UI.$('staffReviewCancel').addEventListener('click', () => this.closeReviewDialog_());
    UI.$('staffReviewSubmit').addEventListener('click', () => this.submitReview_());
    UI.$('staffReviewDialog').addEventListener('click', event => {
      if (event.target === UI.$('staffReviewDialog')) this.closeReviewDialog_();
    });
    UI.$('staffReviewDialog').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeReviewDialog_(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [UI.$('staffReviewClose'), UI.$('staffReviewReason'), UI.$('staffReviewCancel'), UI.$('staffReviewSubmit')];
      const current = focusable.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && current === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
    });
  },

  openReviewDialog_(staff, action) {
    this.reviewPreviousFocus = document.activeElement;
    this.reviewTarget = { staff: staff, action: action };
    const approve = action === 'approve';
    UI.$('staffReviewEyebrow').textContent = approve ? 'อนุมัติการผูกบัญชี' : 'ปฏิเสธคำขอผูกบัญชี';
    UI.$('staffReviewTitle').textContent = staff.name;
    UI.$('staffReviewDetails').innerHTML =
      '<div class="grid grid-cols-2 gap-2">' +
        this.staffFact_('รหัสบุคลากร', staff.employeeId || 'ยังไม่ระบุ', true) +
        this.staffFact_('ชื่อ LINE', staff.pendingLineDisplayName || 'ไม่พบชื่อแสดงผล') +
        this.staffFact_('ตำแหน่ง', staff.position || 'ยังไม่ระบุ') +
        this.staffFact_('กลุ่มงาน', staff.group || 'ยังไม่ระบุ') +
      '</div>';
    UI.$('staffReviewReason').value = approve ? 'ตรวจสอบชื่อและรหัสบุคลากรกับทำเนียบแล้ว' : '';
    UI.$('staffReviewReason').placeholder = approve ? 'ระบุวิธีที่ใช้ยืนยันตัวตน' : 'ระบุสาเหตุที่ปฏิเสธ';
    UI.$('staffReviewError').classList.add('hidden');
    UI.$('staffReviewEffect').textContent = approve
      ? 'เมื่ออนุมัติ บัญชี LINE นี้จะใช้สิทธิ์ของบุคลากรรายนี้ได้'
      : 'เมื่อปฏิเสธ ระบบจะล้างคำขอผูกบัญชีนี้ ผู้ใช้สามารถส่งคำขอใหม่ได้';
    const submit = UI.$('staffReviewSubmit');
    submit.textContent = approve ? 'ยืนยันการอนุมัติ' : 'ยืนยันการปฏิเสธ';
    submit.className = 'min-h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ' +
      (approve ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700');
    const dialog = UI.$('staffReviewDialog');
    dialog.classList.remove('hidden');
    dialog.classList.add('flex');
    UI.$('staffReviewReason').focus();
  },

  closeReviewDialog_() {
    this.reviewTarget = null;
    const dialog = UI.$('staffReviewDialog');
    dialog.classList.add('hidden');
    dialog.classList.remove('flex');
    if (this.reviewPreviousFocus && typeof this.reviewPreviousFocus.focus === 'function') {
      this.reviewPreviousFocus.focus();
    }
    this.reviewPreviousFocus = null;
  },

  async submitReview_() {
    if (!this.reviewTarget) return;
    const reason = UI.$('staffReviewReason').value.trim();
    const error = UI.$('staffReviewError');
    if (reason.length < 5) {
      error.textContent = 'กรุณาระบุหลักฐานหรือเหตุผลอย่างน้อย 5 ตัวอักษร';
      error.classList.remove('hidden');
      UI.$('staffReviewReason').focus();
      return;
    }
    error.classList.add('hidden');
    const target = this.reviewTarget;
    const button = UI.$('staffReviewSubmit');
    UI.setBusy(button, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call(target.action + '_staff_binding', {
        row: target.staff.row, version: target.staff.version, reason: reason,
      });
      UI.showToast(target.action === 'approve' ? 'อนุมัติการผูกบัญชีแล้ว' : 'ปฏิเสธและล้างคำขอแล้ว');
      this.closeReviewDialog_();
      await App.renderRoute();
    } catch (e) {
      error.textContent = e.message;
      error.classList.remove('hidden');
    } finally {
      UI.setBusy(button, false);
    }
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
        await App.renderRoute();
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
    del.className = 'ui-btn-danger sm:col-span-2 sm:justify-self-start';
    del.textContent = 'ลบกลุ่มผู้อนุมัติ';
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
    const accepted = await UI.confirm({
      title: 'บันทึกผู้อนุมัติทั้งหมด?',
      message: rows.length + ' กลุ่มงาน\nการบันทึกครั้งนี้จะแทนที่ตารางผู้อนุมัติเดิมทั้งหมด',
      confirmText: 'บันทึกผู้อนุมัติ',
    });
    if (!accepted) return;
    UI.setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await AdminAPI.call('save_approvers', {
        data: JSON.stringify(rows), version: this.approversVersion,
      });
      UI.showToast('บันทึกผู้อนุมัติแล้ว');
      await App.renderRoute(); // โหลดใหม่เพื่ออัปเดตเลขแถว/ลิสต์จริง
    } catch (e) {
      UI.showToast(e.message, true);
    } finally {
      UI.setBusy(btn, false);
    }
  },
};
