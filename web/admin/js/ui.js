// utility กลางที่ทุกหน้าใช้ร่วมกัน — ย้ายมาจากหน้าตั้งค่าเดิม (apps/webapp/Index.html)
// โหลดก่อน views ทุกไฟล์: ใช้ผ่าน global UI
'use strict';

// ทะเบียนหน้าของ SPA — ต้องประกาศที่นี่ (ไฟล์แรกๆ ที่โหลด) เพราะ views/*.js
// ลงทะเบียนตัวเองทันทีตอนโหลด ก่อน app.js (ตัวเดินหน้า) จะถูกโหลดท้ายสุด
const AdminViews = {};

const UI = {

  $(id) { return document.getElementById(id); },

  escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  THAI_MONTHS: [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ],

  showToast(message, isError) {
    const el = UI.$('toast');
    el.textContent = message;
    el.classList.remove('opacity-0', 'pointer-events-none', 'bg-slate-900', 'bg-red-600');
    el.classList.add('opacity-100', isError ? 'bg-red-600' : 'bg-slate-900');
    clearTimeout(UI.showToast._t);
    UI.showToast._t = setTimeout(() => {
      el.classList.remove('opacity-100');
      el.classList.add('opacity-0', 'pointer-events-none');
    }, 2600);
  },

  // สถานะ "กำลังทำงาน" ของปุ่ม — คืนค่าเดิมทุก path (ผู้เรียกต้องเรียกคืนใน finally)
  setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.origText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.classList.add('opacity-50', 'cursor-not-allowed');
      if (busyText) button.textContent = busyText;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('opacity-50', 'cursor-not-allowed');
      if (button.dataset.origText) button.textContent = button.dataset.origText;
      delete button.dataset.origText;
    }
  },

  todayStr_() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },

  daysBetween_(dateStrA, dateStrB) {
    const a = new Date(dateStrA + 'T00:00:00');
    const b = new Date(dateStrB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  },

  formatThaiDate(value) { return ThaiDate.format(value); },

  formatThaiDateRange(start, end) { return ThaiDate.range(start, end); },

  formatThaiDateTime(value) { return ThaiDate.formatDateTime(value); },

  badgeClasses(status) {
    const s = String(status || '');
    if (s.indexOf('success') === 0) return 'bg-emerald-50 text-emerald-700';
    if (s.indexOf('error') === 0) return 'bg-red-50 text-red-700';
    return 'bg-slate-100 text-slate-500';
  },

  /** สร้างปุ่ม/element พร้อมผูก event แบบปลอดภัย — ใช้แทนการฝัง payload ลง HTML string
   *  (pattern เดิมของหน้าเว็บ: createElement + addEventListener เท่านั้น) */
  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  },

  /** ดาวน์โหลด CSV เปิดใน Excel ภาษาไทยได้ — BOM กันไทยเพี้ยน + กัน formula injection
   *  (ค่าขึ้นต้น = + - @ ใส่ ' นำหน้า) + คั่น \r\n ตามสเปค CSV ของ Excel
   *  rows = array 2 มิติ (แถวแรกเป็นหัวตาราง) */
  downloadCsv(filename, rows) {
    const quote = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = rows.map(row => row.map(quote).join(','));
    // ﻿ (BOM) นำหน้า — Excel เข้าใจว่าไฟล์เป็น UTF-8 ไม่อ่านภาษาไทยเพี้ยน
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
