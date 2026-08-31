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
    'data-role="binding-actions"',
    'data-role="position-control"',
    'data-role="employment-control"',
    'id="staffPagination"',
    'staffPageSize: 10',
    'this.staffList.slice(start, start + this.staffPageSize)',
    'ตำแหน่ง:',
    'HR เตรียมข้อมูลทำเนียบและรหัสบุคลากรโดยเว้นสถานะทั้งสองช่อง',
    "s.employmentStatus || 'รอระบบยืนยัน'",
    "'set_staff_position', 'position', 'ตำแหน่ง'",
    "'set_staff_employment_type', 'employmentType', 'ประเภทบุคลากร'",
    "button.classList.toggle('hidden', !select.value)",
    "reviewButton.textContent = action === 'approve' ? 'อนุมัติผูก' : 'ปฏิเสธ'",
    "'min-h-11 flex-1 sm:flex-none",
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
checkLogRetentionContracts();
checkThaiDateContracts();

if (!process.exitCode) console.log('Syntax, UI, admin view, and direct-mode contract checks passed');
