// หน้ารายงานวันลา — รายเดือน/รายปี + ดาวน์โหลด CSV (ย้ายจากแท็บ "รายงานวันลา" เดิม)
'use strict';

AdminViews.reports = {

  lastReport: null, // เก็บผลล่าสุดไว้ใช้กับปุ่ม CSV (ไม่ยิงเซิร์ฟเวอร์ซ้ำ)
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  bangkokYearMonth_(date) {
    const values = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric',
    }).formatToParts(date).forEach(part => { values[part.type] = Number(part.value); });
    return { year: values.year, month: values.month };
  },

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML =
      UI.pageHeader('ตรวจสอบข้อมูล', 'รายงานวันลา', 'สรุปการลาที่อนุมัติแล้วตามปีงบประมาณหรือเดือน และดาวน์โหลดข้อมูลไปใช้งานต่อ') +
      '<div class="ui-card ui-card-body mb-4">' +
      '<div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">' +
      '<div><label for="r-year" class="ui-label">ปีงบประมาณ (พ.ศ.)</label>' +
      '<select id="r-year" class="ui-field"></select></div>' +
      '<div><label for="r-month" class="ui-label">เดือน</label>' +
      '<select id="r-month" class="ui-field"><option value="">ทั้งปี</option></select></div>' +
      '<button id="btnRunReport" type="button" class="ui-btn-primary col-span-2 sm:w-auto">สร้างรายงาน</button>' +
      '<button id="btnReportCsv" type="button" class="ui-btn-soft col-span-2 sm:w-auto">ดาวน์โหลด CSV</button>' +
      '</div>' +
      '<p class="ui-help">ปีงบประมาณเริ่ม 1 ตุลาคมและสิ้นสุด 30 กันยายน · สรุปเฉพาะใบลาสถานะ "อนุมัติ" เป็นวันทำการตามเดือนที่ใบเริ่ม (ใบคร่อมเดือนนับเดือนที่เริ่ม) ใช้ดูภาพกำลังคน ไม่ใช่เกณฑ์วินิจฉัยสิทธิ์คลอด/บวช</p>' +
      '</div>' +

      '<section id="reportSummary" class="hidden grid-cols-3 gap-2 mb-4" aria-label="สรุปรายงาน"></section>' +
      '<div class="ui-card overflow-hidden">' +
      '<div id="reportCards" class="divide-y divide-slate-100 sm:hidden"></div>' +
      '<div class="hidden overflow-x-auto sm:block"><table class="ui-data-table">' +
      '<thead><tr id="reportHead" class="text-left text-xs text-slate-500 font-semibold"></tr></thead>' +
      '<tbody id="reportBody" class="divide-y divide-slate-200"></tbody>' +
      '<tfoot id="reportFoot" class="divide-y divide-slate-200 border-t-2 border-slate-200 font-semibold"></tfoot>' +
      '</table></div>' +
      '<div id="reportEmpty" class="hidden"></div>' +
      '<p id="reportError" class="ui-alert ui-alert-danger hidden rounded-none border-x-0 border-b-0"></p>' +
      '</div>' +
      '<p class="ui-help mt-3">ตารางนี้นับจากใบลาจริงเท่านั้น — ยอด "ยกมา/ใช้เพิ่ม" ของแต่ละคนอยู่ที่หน้า <b>สิทธิ์วันลา</b> (ระบบหน้า LIFF และคำเตือนสิทธิ์รวมรายการเหล่านั้นเข้ายอดแล้ว)</p>';

    this.initControls();
    UI.$('btnRunReport').addEventListener('click', () => this.load());
    UI.$('btnReportCsv').addEventListener('click', () => this.downloadCsv());
    UI.$('btnReportCsv').disabled = true;
    await this.load(); // เปิดหน้ามาแสดงเดือนปัจจุบันทันทีเหมือนเดิม
  },

  initControls() {
    const now = this.bangkokYearMonth_(new Date());
    const fiscalYear = now.month >= 10 ? now.year + 1 : now.year;
    const beYear = fiscalYear + 543;
    const yearSel = UI.$('r-year');
    for (let y = beYear; y >= beYear - 3; y--) {
      const opt = document.createElement('option');
      opt.value = String(y - 543); // ปีงบประมาณ ค.ศ. ที่สิ้นสุด
      opt.textContent = String(y);
      yearSel.appendChild(opt);
    }
    const monthSel = UI.$('r-month');
    monthSel.innerHTML = '<option value="">ทั้งปี</option>';
    [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8].forEach(i => {
      const name = UI.THAI_MONTHS[i];
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = name;
      monthSel.appendChild(opt);
    });
    monthSel.value = String(now.month).padStart(2, '0'); // เลือกเดือนปัจจุบันตามเวลาไทย
  },

  reportDays_(value) {
    const num = Number(value || 0);
    return num === 0 ? '—' : String(num); // 0 แสดงเป็นขีดให้ไล่คนที่ยังไม่ลาง่ายขึ้น
  },

  async load() {
    const year = UI.$('r-year').value;
    const month = UI.$('r-month').value;
    if (!year) return;
    const btn = UI.$('btnRunReport');
    UI.setBusy(btn, true, 'กำลังโหลด…');
    UI.$('reportError').classList.add('hidden');
    UI.$('reportEmpty').classList.add('hidden');
    try {
      const monthNumber = Number(month || 0);
      const calendarYear = monthNumber >= 10 ? Number(year) - 1 : Number(year);
      const monthKey = month ? calendarYear + '-' + month : '';
      const res = await AdminAPI.call('get_leave_report', { year: year, month: monthKey });
      if (this._isStale && this._isStale()) return; // หน้าเปลี่ยนระหว่างรอ API — ทิ้งผลเก่า
      this.lastReport = res;
      this.renderReport(res);
    } catch (e) {
      if (this._isStale && this._isStale()) return;
      this.showError(e.message);
    } finally {
      UI.setBusy(btn, false, 'สร้างรายงาน');
    }
  },

  showError(message) {
    if (!UI.$('reportError')) return; // หน้าถูกเปลี่ยนไปแล้ว
    this.lastReport = null;
    UI.$('btnReportCsv').disabled = true;
    UI.$('reportHead').innerHTML = '';
    UI.$('reportBody').innerHTML = '';
    UI.$('reportFoot').innerHTML = '';
    UI.$('reportCards').innerHTML = '';
    UI.$('reportSummary').classList.add('hidden');
    UI.$('reportSummary').classList.remove('grid');
    const p = UI.$('reportError');
    p.textContent = message;
    p.classList.remove('hidden');
  },

  renderReport(res) {
    if (!UI.$('reportHead')) return; // ตารางไม่อยู่แล้ว (หน้าถูกเปลี่ยน)
    UI.$('btnReportCsv').disabled = false;
    UI.$('reportHead').innerHTML =
      '<th class="px-4 py-2.5">ชื่อ</th><th class="px-4 py-2.5">กลุ่มงาน</th>' +
      res.types.map(t => '<th class="px-4 py-2.5 text-right whitespace-nowrap">' + UI.escapeHtml(t) + '</th>').join('') +
      '<th class="px-4 py-2.5 text-right">รวม</th>';

    const body = UI.$('reportBody');
    body.innerHTML = res.rows.map(row =>
      '<tr>' +
      '<td class="px-4 py-2.5 whitespace-nowrap">' + UI.escapeHtml(row.name) + '</td>' +
      '<td class="px-4 py-2.5 text-slate-500">' + UI.escapeHtml(row.group || '-') + '</td>' +
      row.cells.map(c => '<td class="px-4 py-2.5 text-right font-mono text-xs">' + this.reportDays_(c) + '</td>').join('') +
      '<td class="px-4 py-2.5 text-right font-mono text-xs font-semibold">' + this.reportDays_(row.total) + '</td>' +
      '</tr>').join('');

    UI.$('reportFoot').innerHTML =
      '<tr class="bg-slate-50">' +
      '<td class="px-4 py-2.5" colspan="2">รวมทุกคน</td>' +
      res.columnTotals.map(c => '<td class="px-4 py-2.5 text-right font-mono text-xs">' + this.reportDays_(c) + '</td>').join('') +
      '<td class="px-4 py-2.5 text-right font-mono text-xs">' + this.reportDays_(res.grandTotal) + '</td>' +
      '</tr>';

    const usedTypeCount = (res.columnTotals || []).filter(Number).length;
    const summary = UI.$('reportSummary');
    summary.innerHTML = [
      ['บุคลากร', res.rows.length + ' คน'],
      ['วันลารวม', this.reportDays_(res.grandTotal)],
      ['ประเภทที่มีการลา', usedTypeCount + ' ประเภท'],
    ].map(item =>
      '<div class="ui-card p-3 text-center"><p class="text-lg font-bold text-text">' + UI.escapeHtml(item[1]) + '</p>' +
      '<p class="mt-0.5 text-[11px] text-text-muted">' + UI.escapeHtml(item[0]) + '</p></div>'
    ).join('');
    summary.classList.toggle('hidden', !res.rows.length);
    summary.classList.toggle('grid', !!res.rows.length);

    UI.$('reportCards').innerHTML = res.rows.map(row => {
      const used = res.types.map((type, index) => ({ type: type, value: Number(row.cells[index] || 0) }))
        .filter(item => item.value > 0);
      return '<article class="p-4">' +
        '<div class="flex items-start justify-between gap-3"><div class="min-w-0">' +
          '<p class="font-semibold text-text break-words">' + UI.escapeHtml(row.name) + '</p>' +
          '<p class="mt-0.5 text-[13px] text-text-muted">' + UI.escapeHtml(row.group || 'ไม่ระบุกลุ่มงาน') + '</p>' +
        '</div><span class="ui-badge ui-badge-info shrink-0">รวม ' + UI.escapeHtml(this.reportDays_(row.total)) + '</span></div>' +
        '<div class="mt-3 grid grid-cols-2 gap-2 text-[13px]">' +
          (used.length ? used.map(item =>
            '<div class="rounded-control bg-surface-subtle px-3 py-2"><p class="text-text-muted">' + UI.escapeHtml(item.type) + '</p>' +
            '<p class="mt-0.5 font-semibold text-text">' + UI.escapeHtml(this.reportDays_(item.value)) + ' วัน</p></div>'
          ).join('') : '<p class="col-span-2 text-text-muted">ไม่มีวันลาในช่วงนี้</p>') +
        '</div></article>';
    }).join('');

    const empty = UI.$('reportEmpty');
    if (!res.rows.length) {
      empty.innerHTML = UI.emptyState('ไม่มีข้อมูลวันลา ' + res.monthLabel, 'ลองเลือกเดือนหรือปีงบประมาณอื่น');
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
    }
  },

  downloadCsv() {
    const res = this.lastReport;
    if (!res || !res.rows) { UI.showToast('ยังไม่มีรายงานให้บันทึก กด "สร้างรายงาน" ก่อน', true); return; }
    const rows = [];
    rows.push(['รายงานวันลา ' + res.monthLabel]);
    rows.push(['ชื่อ', 'กลุ่มงาน'].concat(res.types).concat(['รวม']));
    res.rows.forEach(row => {
      rows.push([row.name, row.group || ''].concat(row.cells.map(String)).concat([String(row.total)]));
    });
    rows.push(['รวมทุกคน', ''].concat(res.columnTotals.map(String)).concat([String(res.grandTotal)]));
    UI.downloadCsv('รายงานวันลา-' + (res.month ? res.month : 'ปีงบประมาณ-' + (Number(res.year) + 543)) + '.csv', rows);
  },
};
