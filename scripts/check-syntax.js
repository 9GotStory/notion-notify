'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === 'node_modules') return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function check(source, filename) {
  try {
    new vm.Script(source, { filename });
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

function checkAdminViewContracts() {
  const context = vm.createContext({ AdminViews: {}, AdminAPI: {}, UI: {} });
  const filename = 'web/admin/js/views/reports.js';
  try {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
    const reports = context.AdminViews.reports;
    if (!reports || reports.render.constructor.name !== 'AsyncFunction' || typeof reports.renderReport !== 'function') {
      throw new Error('Reports view must keep async render(root, isStale) separate from renderReport(data)');
    }
    const bangkokBoundary = reports.bangkokYearMonth_(new Date('2026-09-30T18:00:00Z'));
    if (bangkokBoundary.year !== 2026 || bangkokBoundary.month !== 10) {
      throw new Error('Reports view must derive the current month in Asia/Bangkok');
    }
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

function checkDirectModeContracts() {
  const contracts = [
    {
      file: 'web/liff-form/index.html',
      required: ["new URLSearchParams", "accessToken: accessToken", "CONFIG.API_URL + '?'", "method: 'GET'",
        'fiscalYearBEForDateStr(start) !== fiscalYearBEForDateStr(end)'],
      forbidden: ["'/api/liff'"],
    },
    {
      file: 'web/schedule/index.html',
      required: ["apiAction: 'schedule'", "CONFIG.API_URL + '?'", "method: 'GET'"],
      forbidden: ["'/api/schedule'"],
    },
    {
      file: 'web/admin/js/api.js',
      required: ["new URLSearchParams", 'this._fetchAt(ADMIN_CONFIG.API_URL',
        'ADMIN_CONFIG.MAIN_API_URL', "method: 'GET'", 'sessionStorage'],
      forbidden: ["'/api/admin'"],
    },
    {
      file: '.github/workflows/deploy-liff-form.yml',
      required: ['API_URL:', 'ADMIN_API_URL:', '__API_URL__', '__ADMIN_API_URL__'],
      forbidden: ['GATEWAY_URL'],
    },
  ];
  contracts.forEach(contract => {
    const source = fs.readFileSync(path.join(root, contract.file), 'utf8');
    const missing = contract.required.filter(value => !source.includes(value));
    const present = contract.forbidden.filter(value => source.includes(value));
    if (missing.length || present.length) {
      console.error(contract.file + ' direct-mode contract failed' +
        (missing.length ? '; missing: ' + missing.join(', ') : '') +
        (present.length ? '; forbidden: ' + present.join(', ') : ''));
      process.exitCode = 1;
    }
  });
}

function checkLiffFormUxContracts() {
  const filename = 'web/liff-form/index.html';
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const required = [
    'id="typeHelp"',
    'function refreshTypeHelp_()',
    'function leaveTypeLabel_(value)',
    "btn.setAttribute('aria-pressed', selected ? 'true' : 'false')",
    'const spanLast = types.length % 2 === 1 && index === types.length - 1',
    "spanLast ? 'col-span-2 ' : ''",
    'escapeHtml(leaveTypeLabel_(name))',
    'ลาช่วยเหลือภรรยาคลอดบุตร',
    'periodExplicit: false',
    'if (periodRequired && (!state.periodExplicit || !state.period))',
    "err.textContent = 'กรุณาเลือกช่วงวัน'",
  ];
  const forbidden = [
    "escapeHtml((TYPE_DESCRIPTIONS[name] || '') + quotaText)",
    'ระบบปิดการอนุมัติอยู่ — ยื่นแล้วบันทึกเป็นอนุมัติทันที',
    "name.length > 22 ? 'col-span-2 ' : ''",
  ];
  const missing = required.filter(value => !source.includes(value));
  const present = forbidden.filter(value => source.includes(value));
  if (missing.length || present.length) {
    console.error(filename + ' mobile UX contract failed' +
      (missing.length ? '; missing: ' + missing.join(', ') : '') +
      (present.length ? '; forbidden: ' + present.join(', ') : ''));
    process.exitCode = 1;
  }
}

function checkAdminStaffUxContracts() {
  const filename = 'web/admin/js/views/staff.js';
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const required = [
    'id="staffCards"',
    'this.renderStaffCards(this.staffPageItems_())',
    'id="staffSearch"',
    'id="staffStatusFilter"',
    "this.tabButton_('directory'",
    "this.tabButton_('bindings'",
    "this.tabButton_('approvers'",
    'id="staffBindingCards"',
    'id="staffReviewDialog"',
    'this.openReviewDialog_(staff, action)',
    'data-role="binding-actions"',
    'data-role="position-control"',
    'data-role="employment-control"',
    'id="staffPagination"',
    'staffPageSize: 10',
    'this.filteredStaff_().slice(start, start + this.staffPageSize)',
    'HR เตรียมข้อมูลทำเนียบและรหัสบุคลากรโดยเว้นสถานะทั้งสองช่อง',
    "if (staff.employmentStatus === 'ACTIVE') return 'พร้อมใช้งาน'",
    "if (this.isReviewable_(staff)) return 'รอตรวจสอบ LINE'",
    "'set_staff_position', 'position', 'ตำแหน่ง'",
    "'set_staff_employment_type', 'employmentType', 'ประเภทบุคลากร'",
    "button.classList.toggle('hidden', !select.value)",
    "reviewButton.textContent = action === 'approve' ? 'ตรวจสอบและอนุมัติ' : 'ปฏิเสธ'",
    "if (reason.length < 5)",
    "approversRes.staffOptions",
    "approversRes.groupOptions",
    "groupSelect.dataset.role = 'approver-group'",
    "checkbox.dataset.role = 'approver-name'",
    "row.querySelectorAll('[data-role=\"approver-name\"]:checked')",
    'เลือกกลุ่มงานและผู้อนุมัติจากทำเนียบ Staff โดยตรง',
  ];
  const forbidden = [
    'id="staffBody"',
    'renderStaffTable(staff)',
    'window.prompt(',
    "namesInput.type = 'text'",
    "document.createElement('datalist')",
  ];
  const missing = required.filter(value => !source.includes(value));
  const present = forbidden.filter(value => source.includes(value));
  if (missing.length || present.length) {
    console.error(filename + ' mobile staff UX contract failed' +
      (missing.length ? '; missing: ' + missing.join(', ') : '') +
      (present.length ? '; forbidden: ' + present.join(', ') : ''));
    process.exitCode = 1;
  }

  const context = vm.createContext({ AdminViews: {} });
  try {
    vm.runInContext(source, context, { filename });
    const staff = context.AdminViews.staff;
    staff.staffList = Array.from({ length: 23 }, (_, index) => ({ index }));
    staff.staffPage = 3;
    if (staff.staffPageCount_() !== 3 || staff.staffPageItems_().length !== 3 ||
        staff.staffPageItems_()[0].index !== 20) {
      throw new Error('Staff pagination must split 23 records into 10, 10, and 3');
    }
    staff.staffPage = 1;
    staff.staffList = [
      { name: 'สมชาย ทดสอบ', employeeId: 'EMP01', bindingStatus: 'PENDING' },
      { name: 'สมหญิง พร้อมใช้', employeeId: 'EMP02', bindingStatus: 'APPROVED', registered: true,
        position: 'พยาบาล', employmentType: 'ข้าราชการ' },
    ];
    staff.staffQuery = 'EMP02';
    staff.staffFilter = 'all';
    if (staff.filteredStaff_().length !== 1 || staff.filteredStaff_()[0].name !== 'สมหญิง พร้อมใช้') {
      throw new Error('Staff search must match employee ID');
    }
    staff.staffQuery = '';
    staff.staffFilter = 'pending';
    if (staff.filteredStaff_().length !== 1 || staff.filteredStaff_()[0].name !== 'สมชาย ทดสอบ') {
      throw new Error('Staff pending filter must use the binding review state');
    }
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }

  const backend = fs.readFileSync(path.join(root, 'apps/webapp/WebApp.gs'), 'utf8');
  const backendRequired = [
    'position: String(row[4]).trim()',
    'position: s.position',
    'positionOptions: String(settings.position_options',
    'set_staff_position: p => api_setStaffPosition(p.staffKey, p.position)',
    'sheet.getRange(3 + i, 5).setValue(value)',
    'function adminStaffRosterComplete_(values)',
    "employmentStatus && employmentStatus !== 'ACTIVE'",
    "approvedValues[5] = 'ACTIVE'",
    "approvedValues[6] = 'APPROVED'",
    'sheet.getRange(row, 6, 1, 12).setValues([approvedValues])',
    'function adminApproverDirectory_()',
    'groupOptions: Array.from(new Set(roster.map(staff => staff.group).filter(Boolean)))',
    "if (!groupOptions.has(group)) return { ok: false, error:",
  ];
  const backendMissing = backendRequired.filter(value => !backend.includes(value));
  const backendForbidden = [
    "if (!active) throw new Error('อนุมัติไม่ได้จนกว่าสถานะบุคลากรจะเป็น ACTIVE')",
  ].filter(value => backend.includes(value));
  if (backendMissing.length || backendForbidden.length) {
    console.error('Admin staff lifecycle contract failed' +
      (backendMissing.length ? '; missing: ' + backendMissing.join(', ') : '') +
      (backendForbidden.length ? '; forbidden: ' + backendForbidden.join(', ') : ''));
    process.exitCode = 1;
  }
}

function checkDesignSystemContracts() {
  const stylesFile = 'web/liff-form/src/styles.css';
  const styles = fs.readFileSync(path.join(root, stylesFile), 'utf8');
  const requiredStyles = [
    '--color-brand:', '--color-surface:', '--color-text:', '--color-success:', '--color-warning:',
    '--color-danger:', '--radius-control:', '--radius-card:', '.ui-page-header', '.ui-card', '.ui-field',
    '.ui-btn-primary', '.ui-btn-secondary', '.ui-btn-danger', '.ui-badge', '.ui-alert', '.ui-empty-state',
  ];
  const missingStyles = requiredStyles.filter(value => !styles.includes(value));
  if (missingStyles.length) {
    console.error(stylesFile + ' design-system contract failed; missing: ' + missingStyles.join(', '));
    process.exitCode = 1;
  }

  const adminViews = [
    'overview.js', 'staff.js', 'leave.js', 'leave-manage.js', 'holidays.js', 'reports.js', 'system.js',
  ].map(name => 'web/admin/js/views/' + name);
  adminViews.forEach(filename => {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const violations = [];
    if (!source.includes('UI.pageHeader(')) violations.push('missing UI.pageHeader');
    if (source.includes('h-[38px]')) violations.push('legacy 38px control');
    if (source.includes('window.confirm(') || source.includes('if (!confirm(')) violations.push('native confirm dialog');
    if (violations.length) {
      console.error(filename + ' design-system contract failed; ' + violations.join(', '));
      process.exitCode = 1;
    }
  });

  const responsiveContracts = [
    ['web/admin/js/views/holidays.js', 'id="hdCards"'],
    ['web/admin/js/views/leave.js', 'id="quotaCards"'],
    ['web/admin/js/views/leave.js', 'id="balanceCards"'],
    ['web/admin/js/views/reports.js', 'id="reportCards"'],
    ['web/admin/js/views/system.js', 'id="logCards"'],
  ];
  responsiveContracts.forEach(([filename, marker]) => {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    if (!source.includes(marker)) {
      console.error(filename + ' responsive data-view contract failed; missing: ' + marker);
      process.exitCode = 1;
    }
  });

  const holidaysSource = fs.readFileSync(path.join(root, 'web/admin/js/views/holidays.js'), 'utf8');
  [
    'id="hdDateTrigger"',
    'id="hdDateDisplay"',
    'class="absolute inset-0 h-full w-full opacity-0 pointer-events-none"',
    "UI.$('hdDateTrigger').addEventListener('click'",
    "typeof input.showPicker === 'function'",
    'UI.formatThaiDate(input.value)',
    'min-w-[132px] whitespace-nowrap',
    'ui-btn-danger whitespace-nowrap',
  ].forEach(marker => {
    if (!holidaysSource.includes(marker)) {
      console.error('web/admin/js/views/holidays.js responsive date/action contract failed; missing: ' + marker);
      process.exitCode = 1;
    }
  });
  if (holidaysSource.includes('fixed bottom-0 right-0')) {
    console.error('web/admin/js/views/holidays.js date picker anchor must stay on the visible date field');
    process.exitCode = 1;
  }
  try {
    let pickerCalls = 0;
    let clickCalls = 0;
    const elements = {
      hdDate: {
        value: '2026-09-01',
        showPicker: () => { pickerCalls += 1; },
        focus: () => {},
        click: () => { clickCalls += 1; },
      },
      hdDateDisplay: { textContent: '' },
    };
    const context = vm.createContext({
      AdminViews: {},
      UI: { $: id => elements[id], formatThaiDate: value => value === '2026-09-01' ? '1 ก.ย. 2569' : '' },
    });
    vm.runInContext(holidaysSource, context, { filename: 'web/admin/js/views/holidays.js' });
    context.AdminViews.holidays.refreshDateDisplay_();
    if (elements.hdDateDisplay.textContent !== '1 ก.ย. 2569') {
      throw new Error('holiday date field did not render the Thai display value');
    }
    elements.hdDate.value = '';
    context.AdminViews.holidays.refreshDateDisplay_();
    if (elements.hdDateDisplay.textContent !== '— เลือกวันที่ —') {
      throw new Error('holiday date field did not restore the empty label');
    }
    context.AdminViews.holidays.openDatePicker_();
    if (pickerCalls !== 1 || clickCalls !== 0) {
      throw new Error('holiday date trigger did not prefer the native showPicker API');
    }
    delete elements.hdDate.showPicker;
    context.AdminViews.holidays.openDatePicker_();
    if (clickCalls !== 1) {
      throw new Error('holiday date trigger did not fall back to native input click');
    }
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }

  const uiSource = fs.readFileSync(path.join(root, 'web/admin/js/ui.js'), 'utf8');
  ['confirm(options)', "setAttribute('aria-modal', 'true')", "event.key === 'Escape'", 'previousFocus.focus()']
    .forEach(marker => {
      if (!uiSource.includes(marker)) {
        console.error('web/admin/js/ui.js accessible dialog contract failed; missing: ' + marker);
        process.exitCode = 1;
      }
    });
}

function checkLogRetentionContracts() {
  const contracts = [
    {
      file: 'apps/main/Summary.gs',
      required: ['LOG_RETENTION_DAYS_DEFAULT = 90', "LOG_CLEANUP_TRIGGER_HANDLER = 'cleanupLogsDaily'",
        'function cleanupOldLogs_', 'function ensureLogCleanupTrigger_', '.everyDays(1)',
        'sheet.deleteRows(run.startRow, run.count)'],
    },
    {
      file: 'apps/main/Config.gs',
      required: ["['logs_retention_days', '90'"],
    },
    {
      file: 'web/admin/js/views/system.js',
      required: ['id="f-log-retention"', 'logs_retention_days:', 'ไม่ลบ AuditLog หรือ SecurityEvents'],
    },
  ];
  contracts.forEach(contract => {
    const source = fs.readFileSync(path.join(root, contract.file), 'utf8');
    const missing = contract.required.filter(value => !source.includes(value));
    if (missing.length) {
      console.error(contract.file + ' log-retention contract failed; missing: ' + missing.join(', '));
      process.exitCode = 1;
    }
  });
}

function checkAdminLogPaginationContracts() {
  const frontendFile = 'web/admin/js/views/system.js';
  const frontend = fs.readFileSync(path.join(root, frontendFile), 'utf8');
  const backendFile = 'apps/webapp/WebApp.gs';
  const backend = fs.readFileSync(path.join(root, backendFile), 'utf8');
  const frontendRequired = [
    'logPageSize: 15', 'id="logPagination"', 'id="logPrevBtn"', 'id="logNextBtn"',
    "AdminAPI.call('get_logs', { page: target, pageSize: this.logPageSize })",
    'logStatusMeta_(status)', 'วันที่อ้างอิง', 'ประเภทเหตุการณ์', 'aria-live="polite"',
  ];
  const backendRequired = [
    'get_logs: p => withOk_(api_getLogsPage(p.page, p.pageSize || p.limit))',
    'function logPageWindow_(page, pageSize, totalItems)',
    'function api_getLogsPage(page, pageSize)',
    'totalItems: window.totalItems', 'totalPages: window.totalPages',
  ];
  const frontendMissing = frontendRequired.filter(value => !frontend.includes(value));
  const backendMissing = backendRequired.filter(value => !backend.includes(value));
  if (frontendMissing.length || backendMissing.length) {
    console.error('Admin Logs pagination contract failed' +
      (frontendMissing.length ? '; frontend missing: ' + frontendMissing.join(', ') : '') +
      (backendMissing.length ? '; backend missing: ' + backendMissing.join(', ') : ''));
    process.exitCode = 1;
  }

  try {
    const context = vm.createContext({ AdminViews: {} });
    vm.runInContext(frontend, context, { filename: frontendFile });
    const logs = context.AdminViews.system;
    const errorMeta = logs.logStatusMeta_('leave-push-fail');
    const skipMeta = logs.logStatusMeta_('skip-leave');
    const successMeta = logs.logStatusMeta_('success');
    if (errorMeta.label !== 'ผิดพลาด' || !errorMeta.badge.includes('danger') ||
        skipMeta.label !== 'ข้ามการส่ง' || !skipMeta.badge.includes('warning') ||
        successMeta.label !== 'สำเร็จ' || !successMeta.badge.includes('success')) {
      throw new Error('Admin Logs status codes must map to readable result badges');
    }
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

function checkScheduleLifecycleContracts() {
  const contracts = [
    {
      file: 'apps/main/Notion.gs',
      required: [
        "const NOTION_SEND_STATUSES = ['ยืนยันแล้ว']",
        "const NOTION_SCHEDULE_STATUSES = ['ยืนยันแล้ว', 'เสร็จสิ้น']",
        'function updateNotionWorkStatus_(pageId, status)',
        "method: 'patch'",
      ],
    },
    {
      file: 'apps/main/Calendar.gs',
      required: [
        'function buildNotionQueryPayload_(todayStr, tomorrowStr, statuses)',
        'function buildPastConfirmedSchedulePayload_(todayStr)',
        'function scheduleItemEndedBefore_(item, todayStr)',
        'function completePastScheduleItems_(now, databaseId)',
        "updateNotionWorkStatus_(item.pageId, 'เสร็จสิ้น')",
        'bounds.to, NOTION_SCHEDULE_STATUSES)',
      ],
    },
    {
      file: 'apps/main/Summary.gs',
      required: [
        'const completed = completePastScheduleItems_(now, settings.notion_database_id)',
        "logResult_(now, 'schedule-status'",
        'function ensureLogCleanupTrigger_()',
        '.atHour(3)',
      ],
    },
    {
      file: 'apps/main/Config.gs',
      required: [
        "status.push('ติดตั้ง trigger บำรุงรักษารายวันเวลา 03:00 น.')",
        't.getHandlerFunction() === LOG_CLEANUP_TRIGGER_HANDLER',
        'งานที่พ้นวันจะไม่เปลี่ยนเป็นเสร็จสิ้นอัตโนมัติ',
      ],
    },
  ];
  contracts.forEach(contract => {
    const source = fs.readFileSync(path.join(root, contract.file), 'utf8');
    const missing = contract.required.filter(value => !source.includes(value));
    if (missing.length) {
      console.error(contract.file + ' schedule lifecycle contract failed; missing: ' + missing.join(', '));
      process.exitCode = 1;
    }
  });
}

function checkScheduleMineContracts() {
  const calendarFile = 'apps/main/Calendar.gs';
  const calendar = fs.readFileSync(path.join(root, calendarFile), 'utf8');
  const calendarRequired = [
    'viewer = staff.firstName',
    'if (viewer) result.viewer = viewer;',
    'function assigneeMatches_(assignees, firstName)',
    "name === firstName || name === 'ทุกคน'",
  ];
  const calendarMissing = calendarRequired.filter(value => !calendar.includes(value));
  if (calendarMissing.length) {
    console.error(calendarFile + ' schedule viewer contract failed; missing: ' + calendarMissing.join(', '));
    process.exitCode = 1;
  }
  // viewer เป็นชื่อรายบุคคล — cache โหมดเต็มแชร์กันทุกเจ้าหน้าที่ จึงต้องต่อท้าย "หลัง" cache.put เท่านั้น
  if (calendar.lastIndexOf('if (viewer) result.viewer = viewer;') < calendar.indexOf('cache.put(cacheKey')) {
    console.error(calendarFile + ' must attach viewer after cache.put so the shared full-mode cache stays name-free');
    process.exitCode = 1;
  }

  const pageFile = 'web/schedule/index.html';
  const page = fs.readFileSync(path.join(root, pageFile), 'utf8');
  const pageRequired = [
    'id="btnMine"',
    "btn.setAttribute('aria-pressed', state.mine ? 'true' : 'false')",
    "names.indexOf(state.viewer) !== -1 || names.indexOf('ทุกคน') !== -1",
    'row.name === state.viewer',
    'function prefetchNeighbors(month)',
    'monthAllowed(m) && !state.cache[cacheKey(m)]',
  ];
  const pageMissing = pageRequired.filter(value => !page.includes(value));
  if (pageMissing.length) {
    console.error(pageFile + ' mine-filter/prefetch contract failed; missing: ' + pageMissing.join(', '));
    process.exitCode = 1;
  }
}

function checkScheduleMonthPickerContracts() {
  const calendarFile = 'apps/main/Calendar.gs';
  const calendar = fs.readFileSync(path.join(root, calendarFile), 'utf8');
  // วงดูต้องมีสองระดับ (สาธารณะแคบ / เจ้าหน้าที่ ±12) และส่งค่าวงกลับไปกับ response
  // ให้หน้าเว็บอ่านจาก viewMonths — ห้ามกลับไปกำหนดเลขวงค้างไว้ฝั่งหน้าเว็บอีก
  const calendarRequired = [
    'const SCHEDULE_VIEW_BACK_PUBLIC = -1',
    'const SCHEDULE_VIEW_FWD_PUBLIC = 6',
    'const SCHEDULE_VIEW_BACK_FULL = -12',
    'const SCHEDULE_VIEW_FWD_FULL = 12',
    'scheduleMonthAllowed_(currentMonth, month, viewBack, viewFwd)',
    'viewMonths: { back: viewBack, fwd: viewFwd }',
  ];
  const calendarMissing = calendarRequired.filter(value => !calendar.includes(value));
  if (calendarMissing.length) {
    console.error(calendarFile + ' view-window contract failed; missing: ' + calendarMissing.join(', '));
    process.exitCode = 1;
  }

  const pageFile = 'web/schedule/index.html';
  const page = fs.readFileSync(path.join(root, pageFile), 'utf8');
  const required = [
    'id="btnMonth"',
    'id="monthPicker"',
    "setAttribute('aria-expanded', willOpen ? 'true' : 'false')",
    "$('btnMonth').disabled = loading",
    'function allowedMonths()',
    'for (let d = bounds.back; d <= bounds.fwd; d++)',
    'if (data.viewMonths) state.viewMonths = data.viewMonths',
    'const yearBE = Number(m.slice(0, 4)) + 543',
    "e.target.closest('[data-month]')",
  ];
  // ปุ่ม "ไปเดือนนี้" ถูกตัดออกโดยเจตนา: หน้าเลื่อนไปวันปัจจุบันเองอยู่แล้ว และป้าย "เดือนนี้"
  // ในรายการเลือกเดือนก็พากลับมาได้ในแตะเดียว
  const forbidden = ['btnToday'];
  const missing = required.filter(value => !page.includes(value));
  const present = forbidden.filter(value => page.includes(value));
  if (missing.length || present.length) {
    console.error(pageFile + ' month-picker contract failed' +
      (missing.length ? '; missing: ' + missing.join(', ') : '') +
      (present.length ? '; forbidden: ' + present.join(', ') : ''));
    process.exitCode = 1;
  }
}

function checkSchedulePhase1Contracts() {
  const pageFile = 'web/schedule/index.html';
  const page = fs.readFileSync(path.join(root, pageFile), 'utf8');
  const required = [
    "timeZone: 'Asia/Bangkok'", // "วันนี้"/เดือนปัจจุบันอิดเวลาไทย ไม่ใช่เวลาเครื่องผู้ใช้
    'function cacheKey(month)', // cache แยกโหมด มี/ไม่มี token เหมือนฝั่งเซิร์ฟเวอร์
    "if (state.token && data.full === false) state.token = ''", // token ตาย → self-heal เป็นสาธารณะ
    'id="btnRefresh"',
    "$('btnRefresh').disabled = loading",
    'delete state.cache[cacheKey(state.month)]',
  ];
  // รีเฟรชต้องล้าง cache ฝั่งหน้าเว็บเท่านั้น — ห้ามมีพารามิเตอร์ขอให้เซิร์ฟเวอร์ข้าม cache
  // (กันผู้ใช้นอกยิงรัวจนกระทบโควตา UrlFetch/Notion ที่ทั้งระบบใช้ร่วมกัน)
  const forbidden = ['bypass', 'nocache'];
  const missing = required.filter(value => !page.includes(value));
  const present = forbidden.filter(value => page.toLowerCase().includes(value));
  if (missing.length || present.length) {
    console.error(pageFile + ' phase-1 contract failed' +
      (missing.length ? '; missing: ' + missing.join(', ') : '') +
      (present.length ? '; forbidden: ' + present.join(', ') : ''));
    process.exitCode = 1;
  }
}

function checkSchedulePhase2Contracts() {
  const calendarFile = 'apps/main/Calendar.gs';
  const calendar = fs.readFileSync(path.join(root, calendarFile), 'utf8');
  const calendarRequired = [
    // หน้าเว็บดูได้ ±12 เดือน → หน้าต่าง query ของ apiSchedule_ ต้องกว้างกว่าของ digest (92 วัน)
    'const SCHEDULE_RANGE_PADDING_DAYS = 366',
    'shiftDateStr_(bounds.from, -SCHEDULE_RANGE_PADDING_DAYS)',
    // roster ที่อ่านไว้ตอนตรวจ token ต้องส่งต่อให้ส่วนดึงใบลา — กันการ์ดลาเพี้ยนเป็นชื่อเต็ม
    'roster = readStaffRoster_();',
    'getApprovedLeavesForRange_(new Date(), settings.leave_database_id, bounds.from, bounds.to, roster)',
  ];
  const calendarMissing = calendarRequired.filter(value => !calendar.includes(value));
  if (calendarMissing.length) {
    console.error(calendarFile + ' phase-2 contract failed; missing: ' + calendarMissing.join(', '));
    process.exitCode = 1;
  }

  const reportsFile = 'apps/main/LeaveReports.gs';
  const reports = fs.readFileSync(path.join(root, reportsFile), 'utf8');
  const reportsRequired = [
    'function getApprovedLeavesForRange_(now, leaveDatabaseId, fromStr, toStr, rosterFromCaller)',
    'let roster = rosterFromCaller || null;',
  ];
  const reportsMissing = reportsRequired.filter(value => !reports.includes(value));
  if (reportsMissing.length) {
    console.error(reportsFile + ' phase-2 contract failed; missing: ' + reportsMissing.join(', '));
    process.exitCode = 1;
  }
}

function checkThaiDateContracts() {
  const context = vm.createContext({
    console,
    setTimeout() { return 1; },
    clearTimeout() {},
    document: {
      createElement(tag) {
        return {
          tagName: tag,
          className: '',
          textContent: '',
          value: '',
          children: [],
          listeners: {},
          dataset: {},
          classList: { add() {}, remove() {} },
          setAttribute(name, value) { this[name] = String(value); },
          appendChild(child) { this.children.push(child); },
          addEventListener(type, listener) { this.listeners[type] = listener; },
        };
      },
    },
    Blob: function Blob() {},
    URL: {},
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'web/shared/date.js'), 'utf8'), context,
    { filename: 'web/shared/date.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'web/admin/js/ui.js'), 'utf8'), context,
    { filename: 'web/admin/js/ui.js' });
  const actual = vm.runInContext(`({
    date: UI.formatThaiDate('2026-08-30'),
    sameMonth: UI.formatThaiDateRange('2026-08-30', '2026-08-31'),
    crossMonth: UI.formatThaiDateRange('2026-09-30', '2026-10-01'),
    dateTime: UI.formatThaiDateTime('2026-08-30 08:30:00'),
  })`, context);
  const expected = {
    date: '30 ส.ค. 2569',
    sameMonth: '30–31 ส.ค. 2569',
    crossMonth: '30 ก.ย. 2569 – 1 ต.ค. 2569',
    dateTime: '30 ส.ค. 2569 08:30:00 น.',
  };
  Object.keys(expected).forEach(key => {
    if (actual[key] !== expected[key]) {
      console.error('Thai date format mismatch for ' + key + ': ' + actual[key]);
      process.exitCode = 1;
    }
  });

  const pageContracts = [
    ['web/liff-form/index.html', '../shared/date.js', 'ThaiDate.range(start, end)'],
    ['web/schedule/index.html', '../shared/date.js', 'ThaiDate.format(dateStr)'],
    ['web/admin/index.html', '../shared/date.js', 'js/ui.js'],
  ];
  pageContracts.forEach(([file, scriptPath, formatter]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (!source.includes(scriptPath) || !source.includes(formatter)) {
      console.error(file + ' does not use the shared Thai date formatter');
      process.exitCode = 1;
    }
  });

  const leaveManage = fs.readFileSync(path.join(root, 'web/admin/js/views/leave-manage.js'), 'utf8');
  const leaveManageRequired = [
    "dateField_('วันเริ่ม', leave.start)",
    "dateField_('วันสิ้นสุด', leave.end)",
    'UI.formatThaiDate(input.value)',
    "input.className = 'absolute inset-0 w-full h-full opacity-0 cursor-pointer'",
  ];
  const missing = leaveManageRequired.filter(value => !leaveManage.includes(value));
  if (missing.length) {
    console.error('Admin leave-management date field contract failed; missing: ' + missing.join(', '));
    process.exitCode = 1;
  }
  vm.runInContext(leaveManage, context, { filename: 'web/admin/js/views/leave-manage.js' });
  const field = vm.runInContext("AdminViews['leave-manage'].dateField_('วันเริ่ม', '2026-08-30')", context);
  if (field.input.type !== 'date' || field.display.textContent !== '30 ส.ค. 2569' ||
      field.input.className.indexOf('opacity-0') === -1) {
    console.error('Admin leave-management date field did not show the shared Thai format over the native picker');
    process.exitCode = 1;
  }
  field.input.value = '2026-08-31';
  field.input.listeners.change();
  if (field.display.textContent !== '31 ส.ค. 2569') {
    console.error('Admin leave-management date field did not refresh after date selection');
    process.exitCode = 1;
  }
}

walk(path.join(root, 'apps'))
  .filter(file => file.endsWith('.gs'))
  .forEach(file => check(fs.readFileSync(file, 'utf8'), path.relative(root, file)));

['gateway', 'scripts', 'web'].flatMap(dir => walk(path.join(root, dir)))
  .filter(file => file.endsWith('.js'))
  .forEach(file => check(fs.readFileSync(file, 'utf8'), path.relative(root, file)));

walk(path.join(root, 'web'))
  .filter(file => file.endsWith('.html'))
  .forEach(file => {
    const html = fs.readFileSync(file, 'utf8');
    const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let match;
    let index = 0;
    while ((match = scriptPattern.exec(html))) {
      if (match[1].trim()) check(match[1], path.relative(root, file) + '#script-' + (++index));
    }
  });

checkAdminViewContracts();
checkDirectModeContracts();
checkLiffFormUxContracts();
checkAdminStaffUxContracts();
checkDesignSystemContracts();
checkLogRetentionContracts();
checkAdminLogPaginationContracts();
checkScheduleLifecycleContracts();
checkScheduleMineContracts();
checkScheduleMonthPickerContracts();
checkSchedulePhase1Contracts();
checkSchedulePhase2Contracts();
checkThaiDateContracts();

if (!process.exitCode) console.log('Syntax, UI, admin view, and direct-mode contract checks passed');
