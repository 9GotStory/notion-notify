// ตัวเดินหน้าของหน้าผู้ดูแล — hash router + login gate (โหลดท้ายสุด หลัง views ทุกไฟล์)
// view contract: AdminViews.<name>.render(rootElement) → Promise (โหลดข้อมูลสดทุกครั้ง
// ที่เข้าหน้า — กันเลขแถวชีตเพี้ยนหลังคนอื่นแก้พร้อมกัน และกัน state ค้างจากหน้าก่อน)
// (ทะเบียน AdminViews ประกาศไว้ใน ui.js ซึ่งโหลดก่อน views)
'use strict';

const App = {

  _renderSeq: 0, // เลขกำกับการ render แต่ละครั้ง — ใช้ตรวจว่า render เก่ายัง "เป็นปัจจุบัน" อยู่ไหม

  routes: ['overview', 'staff', 'leave', 'holidays', 'reports', 'system'],

  boot() {
    // token หมดอายุ/ผิดกลางการใช้งาน → api.js ล้าง token แล้วส่ง event มาที่นี่
    window.addEventListener('admin-auth-failed', e => {
      App.showLogin((e.detail && e.detail.error) || 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบอีกครั้ง');
    });
    UI.$('loginBtn').addEventListener('click', () => App.login());
    UI.$('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') App.login(); });
    UI.$('logoutBtn').addEventListener('click', () => {
      AdminAPI.clearToken();
      location.hash = '';
      App.showLogin();
    });
    document.querySelectorAll('.nav-btn').forEach(btn =>
      btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.route; }));
    window.addEventListener('hashchange', () => { if (UI.$('appShell').classList.contains('hidden')) return; App.renderRoute(); });

    if (!AdminAPI.getToken()) { App.showLogin(); return; }
    // มี token ในเครื่อง → ตรวจกับเซิร์ฟเวอร์ก่อนเข้า (เปลี่ยน token ที่ Script Properties = เตะออกทันที)
    AdminAPI.verify(AdminAPI.getToken())
      .then(() => App.showShell())
      .catch(err => App.showLogin(err.message));
  },

  async login() {
    const input = UI.$('tokenInput');
    const btn = UI.$('loginBtn');
    const err = UI.$('loginError');
    const token = input.value.trim();
    err.classList.add('hidden');
    if (!token) {
      err.textContent = 'กรุณากรอก token';
      err.classList.remove('hidden');
      return;
    }
    UI.setBusy(btn, true, 'กำลังตรวจสอบ…');
    try {
      await AdminAPI.verify(token);
      AdminAPI.setToken(token);
      input.value = '';
      App.showShell();
      UI.showToast('เข้าสู่ระบบสำเร็จ');
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    } finally {
      UI.setBusy(btn, false);
    }
  },

  showLogin(message) {
    UI.$('appShell').classList.add('hidden');
    UI.$('loginView').classList.remove('hidden');
    if (message) {
      const err = UI.$('loginError');
      err.textContent = message;
      err.classList.remove('hidden');
    }
  },

  showShell() {
    UI.$('loginView').classList.add('hidden');
    UI.$('appShell').classList.remove('hidden');
    // MDN: การ assign location.hash ก็ fired hashchange เสมอ — เมื่อยังไม่มี hash ให้พึ่ง event
    // จะได้ไม่ render ซ้ำสองรอบ (assign + เรียกเอง) ส่วนกรณีรีเฟรชที่ hash มีอยู่แล้ว
    // (ค่าเดิม = ไม่เกิด event) ต้อง render เอง
    const hadHash = !!location.hash;
    if (!hadHash) location.hash = '#/overview';
    if (hadHash) App.renderRoute();
  },

  async renderRoute() {
    const seq = ++this._renderSeq; // การกดเปลี่ยนหน้าระหว่างที่หน้าเก่ากำลังโหลด = หน้าเก่าต้องยอมแพ้เงียบๆ
    const name = (location.hash || '').replace(/^#\//, '') || 'overview';
    const view = AdminViews[this.routes.includes(name) ? name : 'overview'];
    const root = UI.$('view');
    root.innerHTML = '<div class="text-center text-slate-400 text-sm py-10">กำลังโหลด…</div>';
    document.querySelectorAll('.nav-btn').forEach(btn => {
      const active = btn.dataset.route === name || (!this.routes.includes(name) && btn.dataset.route === 'overview');
      btn.className = 'nav-btn flex-1 min-w-[72px] py-2.5 px-2 rounded-lg text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' +
        (active ? 'bg-primary text-white' : 'text-slate-500');
    });
    // isStale ให้ view เช็คหลังทุก await: ถ้าผู้ใช้ไปหน้าอื่นแล้วให้หยุดเขียน DOM ทันที
    // (กันอาการ "render เก่าตื่นมาเขียนทับหน้าใหม่" และ null.innerHTML จาก element ที่ถูกแทนไปแล้ว)
    const isStale = () => seq !== this._renderSeq;
    try {
      await view.render(root, isStale);
    } catch (err) {
      if (isStale()) return; // error ของ render ที่ตายไปแล้ว — ไม่ต้องแสดง
      // view โหลดไม่ได้ (เช่นเครือข่ายหลุด) — แสดงจุดว่าง + toast แทนหน้าดำ
      root.innerHTML =
        '<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">' +
        UI.escapeHtml(err.message) + '</div>';
      UI.showToast(err.message, true);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.boot());
