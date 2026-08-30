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
      required: ["new URLSearchParams", "ADMIN_CONFIG.API_URL + '?'", "method: 'GET'", 'sessionStorage'],
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
checkLogRetentionContracts();

if (!process.exitCode) console.log('Syntax, UI, admin view, and direct-mode contract checks passed');
