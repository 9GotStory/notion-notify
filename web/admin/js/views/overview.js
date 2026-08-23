// หน้าภาพรวม — สถานะการทำงานล่าสุด + ตัวเลขเด่นของทั้งระบบ + ทางลัดไปแต่ละหน้า
'use strict';

AdminViews.overview = {

  async render(root) {
    const res = await AdminAPI.call('get_overview');
    const log = res.log;
    const c = res.counts;

    // สถานะ: error ล่าสุด หรือไม่มีการทำงาน ≥2 วัน = เหลือง (logic เดียวกับหน้าเว็บเดิม)
    let dotClass = 'bg-emerald-300';
    let statusText = 'ยังไม่มีประวัติการทำงาน';
    if (log) {
      const stale = String(log.status).indexOf('error') === 0 ||
        UI.daysBetween_(log.date, UI.todayStr_()) >= 2;
      dotClass = stale ? 'bg-amber-400' : 'bg-emerald-300';
      statusText = 'เช็คล่าสุด ' + log.date + ' — ' + log.status;
    }

    const tile = (label, value, route) =>
      '<button type="button" data-route="' + route + '" class="nav-jump text-left bg-white border border-slate-200 rounded-xl p-3.5 hover:border-primary">' +
      '<p class="text-xs text-slate-500 mb-1">' + label + '</p>' +
      '<p class="text-xl font-semibold text-slate-900">' + value + '</p></button>';

    root.innerHTML =
      '<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4 flex items-center gap-2.5">' +
      '<span class="w-2 h-2 rounded-full flex-none ' + dotClass + '"></span>' +
      '<span class="text-sm text-slate-700">' + UI.escapeHtml(statusText) + '</span>' +
      '</div>' +

      '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">' +
      tile('เจ้าหน้าที่ในทำเนียบ', c.staff, 'staff') +
      tile('ลงทะเบียนแล้ว', c.registered + '/' + c.staff, 'staff') +
      tile('กลุ่มงาน (ผู้อนุมัติ)', c.groups, 'staff') +
      tile('โควตาตามประเภทบุคลากร', c.quotaProfiles, 'leave') +
      tile('รายการปรับยอดวันลา', c.balances, 'leave') +
      tile('วันหยุดที่กำลังจะมาถึง', c.upcomingHolidays, 'holidays') +
      '</div>' +

      '<div class="bg-white border border-slate-200 rounded-2xl p-4">' +
      '<p class="text-sm font-semibold text-slate-600 mb-2">การตั้งค่าหลัก</p>' +
      '<dl class="text-sm divide-y divide-slate-100">' +
      '<div class="flex justify-between py-2"><dt class="text-slate-500">ระบบแจ้งเตือน</dt><dd class="font-medium">' +
      (String(res.settings.enabled).toUpperCase() === 'FALSE' ? '🔴 ปิดอยู่' : '🟢 เปิดใช้งาน') + '</dd></div>' +
      '<div class="flex justify-between py-2"><dt class="text-slate-500">เวลาส่งข้อความเช้า</dt><dd class="font-medium font-mono">' + UI.escapeHtml(res.settings.notify_time || '-') + '</dd></div>' +
      '<div class="flex justify-between py-2"><dt class="text-slate-500">รูปแบบข้อความ</dt><dd class="font-medium">' + UI.escapeHtml(res.settings.message_format || '-') + '</dd></div>' +
      '</dl>' +
      '<p class="text-xs text-slate-400 mt-3">แก้ไขค่าอื่นได้ที่หน้า "ระบบ"</p>' +
      '</div>';

    root.querySelectorAll('.nav-jump').forEach(btn =>
      btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.route; }));
  },
};
