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

  /** รหัสคำขอสำหรับ idempotency ฝั่งเซิร์ฟเวอร์ — uuid ถ้ามี ไม่มีก็สุ่มแบบ v4 เอง
   *  (webview เก่าไม่มี crypto.randomUUID ต้องยังใช้งานได้ ไม่ throw) */
  requestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
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
    if (s.indexOf('success') === 0) return 'ui-badge ui-badge-success';
    if (s.indexOf('error') === 0) return 'ui-badge ui-badge-danger';
    return 'ui-badge ui-badge-neutral';
  },

  pageHeader(eyebrow, title, description) {
    return '<section class="ui-page-header">' +
      (eyebrow ? '<p class="ui-page-eyebrow">' + UI.escapeHtml(eyebrow) + '</p>' : '') +
      '<h2 class="ui-page-title">' + UI.escapeHtml(title) + '</h2>' +
      (description ? '<p class="ui-page-description">' + UI.escapeHtml(description) + '</p>' : '') +
      '</section>';
  },

  emptyState(title, description) {
    return '<div class="ui-empty-state">' +
      '<p class="font-semibold text-slate-700">' + UI.escapeHtml(title) + '</p>' +
      (description ? '<p class="mt-1 text-sm text-text-muted">' + UI.escapeHtml(description) + '</p>' : '') +
      '</div>';
  },

  /** dialog ยืนยันกลางสำหรับคำสั่งที่มีผลต่อข้อมูล — รองรับ keyboard และคืน focus */
  confirm(options) {
    const opts = Object.assign({
      title: 'ยืนยันรายการ', message: '', confirmText: 'ยืนยัน', cancelText: 'ยกเลิก', danger: false,
    }, options || {});
    const previousFocus = document.activeElement;
    return new Promise(resolve => {
      const overlay = UI.el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4');
      overlay.setAttribute('role', 'presentation');
      const dialog = UI.el('div', 'w-full max-w-md rounded-card bg-white p-5 shadow-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const title = UI.el('h2', 'text-lg font-bold text-text', opts.title);
      const message = UI.el('p', 'mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted', opts.message);
      const actions = UI.el('div', 'mt-5 grid grid-cols-2 gap-2');
      const cancel = UI.el('button', 'ui-btn-secondary', opts.cancelText);
      const confirm = UI.el('button', opts.danger ? 'ui-btn-danger' : 'ui-btn-primary', opts.confirmText);
      cancel.type = 'button'; confirm.type = 'button';
      const titleId = 'ui-confirm-' + Date.now();
      title.id = titleId;
      dialog.setAttribute('aria-labelledby', titleId);
      actions.appendChild(cancel); actions.appendChild(confirm);
      dialog.appendChild(title); dialog.appendChild(message); dialog.appendChild(actions);
      overlay.appendChild(dialog);

      const close = value => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(value);
      };
      const onKeydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
        if (event.key !== 'Tab') return;
        const focusable = [cancel, confirm];
        const current = focusable.indexOf(document.activeElement);
        if (event.shiftKey && current <= 0) { event.preventDefault(); confirm.focus(); }
        else if (!event.shiftKey && current === focusable.length - 1) { event.preventDefault(); cancel.focus(); }
      };
      cancel.addEventListener('click', () => close(false));
      confirm.addEventListener('click', () => close(true));
      overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(overlay);
      confirm.focus();
    });
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
