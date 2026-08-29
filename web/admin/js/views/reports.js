// หน้ารายงานวันลา — รายเดือน/รายปี + ดาวน์โหลด CSV (ย้ายจากแท็บ "รายงานวันลา" เดิม)
'use strict';

AdminViews.reports = {

  lastReport: null, // เก็บผลล่าสุดไว้ใช้กับปุ่ม CSV (ไม่ยิงเซิร์ฟเวอร์ซ้ำ)
  _isStale: null, // ตัวเช็คจาก app.js — ใช้หลัง await กันเขียน DOM หน้าที่เปลี่ยนไปแล้ว

  async render(root, isStale) {
    this._isStale = isStale;
    root.innerHTML =
      '<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4">' +
      '<div class="flex flex-wrap items-end gap-2">' +
      '<div><label for="r-year" class="block text-xs font-semibold text-slate-500 mb-1.5">ปี (พ.ศ.)</label>' +
      '<select id="r-year" class="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"></select></div>' +
      '<div><label for="r-month" class="block text-xs font-semibold text-slate-500 mb-1.5">เดือน</label>' +
      '<select id="r-month" class="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"><option value="">ทั้งปี</option></select></div>' +
      '<button id="btnRunReport" type="button" class="h-[38px] px-4 rounded-lg font-semibold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50">แสดง</button>' +
      '<button id="btnReportCsv" type="button" class="h-[38px] px-4 rounded-lg font-semibold text-sm text-primary bg-primary-light disabled:opacity-50 disabled:cursor-default">ดาวน์โหลด CSV</button>' +
      '</div>' +
      '<p class="text-xs text-slate-500 mt-3">สรุปเฉพาะใบลาสถานะ "อนุมัติ" เป็นวันทำการตามเดือนที่ใบเริ่ม (ใบคร่อมเดือนนับเดือนที่เริ่ม) ใช้ดูภาพกำลังคน ไม่ใช่เกณฑ์วินิจฉัยสิทธิ์คลอด/บวช</p>' +
      '</div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
      '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr id="reportHead" class="text-left text-xs text-slate-500 font-semibold"></tr></thead>' +
      '<tbody id="reportBody" class="divide-y divide-slate-200"></tbody>' +
      '<tfoot id="reportFoot" class="divide-y divide-slate-200 border-t-2 border-slate-200 font-semibold"></tfoot>' +
      '</table></div>' +
      '<p id="reportEmpty" class="hidden text-center text-slate-500 text-sm py-8"></p>' +
      '<p id="reportError" class="hidden text-sm text-red-700 bg-red-50 border-t border-red-200 p-4"></p>' +
      '</div>' +
      '<p class="text-xs text-slate-500 mt-3">ตารางนี้นับจากใบลาจริงเท่านั้น — ยอด "ยกมา/ใช้เพิ่ม" ของแต่ละคนอยู่ที่หน้า <b>สิทธิ์วันลา</b> (ระบบหน้า LIFF และคำเตือนสิทธิ์รวมรายการเหล่านั้นเข้ายอดแล้ว)</p>';

    this.initControls();
    UI.$('btnRunReport').addEventListener('click', () => this.load());
    UI.$('btnReportCsv').addEventListener('click', () => this.downloadCsv());
    UI.$('btnReportCsv').disabled = true;
    await this.load(); // เปิดหน้ามาแสดงเดือนปัจจุบันทันทีเหมือนเดิม
  },

  initControls() {
    const now = new Date();
    const beYear = now.getFullYear() + 543;
    const yearSel = UI.$('r-year');
    for (let y = beYear; y >= beYear - 3; y--) {
      const opt = document.createElement('option');
      opt.value = String(y - 543); // แสดง พ.ศ. ส่งเป็น ค.ศ. ตามสัญญาของ get_leave_report
      opt.textContent = String(y);
      yearSel.appendChild(opt);
    }
    const monthSel = UI.$('r-month');
    monthSel.innerHTML = '<option value="">ทั้งปี</option>';
    UI.THAI_MONTHS.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = name;
      monthSel.appendChild(opt);
    });
    monthSel.value = String(now.getMonth() + 1).padStart(2, '0'); // เลือกเดือนปัจจุบันเป็นค่าเริ่มต้น
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
      const res = await AdminAPI.call('get_leave_report', { year: year, month: month ? year + '-' + month : '' });
      if (this._isStale && this._isStale()) return; // หน้าเปลี่ยนระหว่างรอ API — ทิ้งผลเก่า
      this.lastReport = res;
      this.renderReport(res);
    } catch (e) {
      if (this._isStale && this._isStale()) return;
      this.showError(e.message);
    } finally {
      UI.setBusy(btn, false, 'แสดง');
    }
  },

  showError(message) {
    if (!UI.$('reportError')) return; // หน้าถูกเปลี่ยนไปแล้ว
    this.lastReport = null;
    UI.$('btnReportCsv').disabled = true;
    UI.$('reportHead').innerHTML = '';
    UI.$('reportBody').innerHTML = '';
    UI.$('reportFoot').innerHTML = '';
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

    const empty = UI.$('reportEmpty');
    if (!res.rows.length) {
      empty.textContent = 'ไม่มีข้อมูลวันลา' + (res.month ? 'เดือน ' + res.monthLabel : 'ปี ' + res.year) + ' — ลองเลือกช่วงอื่น';
      empty.classList.remove('hidden');
    }
  },

  downloadCsv() {
    const res = this.lastReport;
    if (!res || !res.rows) { UI.showToast('ยังไม่มีรายงานให้บันทึก กด "แสดง" ก่อน', true); return; }
    const rows = [];
    rows.push(['รายงานวันลา ' + res.monthLabel]);
    rows.push(['ชื่อ', 'กลุ่มงาน'].concat(res.types).concat(['รวม']));
    res.rows.forEach(row => {
      rows.push([row.name, row.group || ''].concat(row.cells.map(String)).concat([String(row.total)]));
    });
    rows.push(['รวมทุกคน', ''].concat(res.columnTotals.map(String)).concat([String(res.grandTotal)]));
    UI.downloadCsv('รายงานวันลา-' + (res.month ? res.month : res.year) + '.csv', rows);
  },
};
