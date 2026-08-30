// รูปแบบวันที่แสดงผลกลางของทุกหน้าเว็บ: 30 ส.ค. 2569
'use strict';

const ThaiDate = Object.freeze({
  MONTHS_SHORT: [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ],

  parts_(value) {
    const match = String(value == null ? '' : value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return null;
    }
    return { year: year, month: month, day: day };
  },

  format(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const parts = this.parts_(text);
    return parts
      ? parts.day + ' ' + this.MONTHS_SHORT[parts.month - 1] + ' ' + (parts.year + 543)
      : text;
  },

  range(start, end) {
    const startParts = this.parts_(start);
    const endParts = this.parts_(end);
    if (!startParts) return this.format(start);
    if (!endParts || String(end).slice(0, 10) === String(start).slice(0, 10)) return this.format(start);
    if (startParts.year === endParts.year && startParts.month === endParts.month) {
      return startParts.day + '–' + endParts.day + ' ' + this.MONTHS_SHORT[startParts.month - 1] +
        ' ' + (startParts.year + 543);
    }
    return this.format(start) + ' – ' + this.format(end);
  },

  formatDateTime(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const dateLabel = this.format(text);
    const time = text.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!time) return dateLabel;
    return dateLabel + ' ' + time[1] + ':' + time[2] + (time[3] ? ':' + time[3] : '') + ' น.';
  },
});
