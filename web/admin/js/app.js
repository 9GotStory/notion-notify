// ตัวเดินหน้าของหน้าผู้ดูแล — hash router + login gate (โหลดท้ายสุด หลัง views ทุกไฟล์)
// view contract: AdminViews.<name>.render(rootElement) → Promise (โหลดข้อมูลสดทุกครั้ง
// ที่เข้าหน้า — กันเลขแถวชีตเพี้ยนหลังคนอื่นแก้พร้อมกัน และกัน state ค้างจากหน้าก่อน)
// (ทะเบียน AdminViews ประกาศไว้ใน ui.js ซึ่งโหลดก่อน views)
'use strict';

const App = {

  _renderSeq: 0, // เลขกำกับการ render แต่ละครั้ง — ใช้ตรวจว่า render เก่ายัง "เป็นปัจจุบัน" อยู่ไหม

  _liffReady: false, // init liff สำเร็จแล้วในหน้านี้ — กันเรียก init ซ้ำ (เรียกใช้ผ่าน ensureLiffReady_)

  routes: ['overview', 'staff', 'leave', 'leave-manage', 'holidays', 'reports', 'system'],

  async boot() {
    // token หมดอายุ/ผิดกลางการใช้งาน → api.js ล้าง token แล้วส่ง event มาที่นี่
    window.addEventListener('admin-auth-failed', e => {
      App.showLogin((e.detail && e.detail.error) || 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบอีกครั้ง');
    });
    UI.$('loginBtn').addEventListener('click', () => App.login());
    UI.$('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') App.login(); });
    UI.$('loginLineBtn').addEventListener('click', () => App.loginLine());
    UI.$('logoutBtn').addEventListener('click', () => {
      AdminAPI.clearToken();
      // ล้างเซสชัน LIFF ด้วย ไม่งั้น refresh ถัดไป auto-login พากลับเข้าทันที (pattern เดียวกับฟอร์มลา)
      try { if (typeof liff !== 'undefined' && liff.isLoggedIn()) liff.logout(); } catch (err) { /* ไปต่อได้ */ }
      location.hash = '';
      App.showLogin();
    });
    document.querySelectorAll('.nav-btn').forEach(btn =>
      btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.route; }));
    window.addEventListener('hashchange', () => { if (UI.$('appShell').classList.contains('hidden')) return; App.renderRoute(); });

    // ปุ่มล็อกอินด้วย LINE โชว์เฉพาะเมื่อ deploy พร้อม LIFF ของหน้านี้ (ADMIN_LIFF_ID)
    const liffReady = String(ADMIN_CONFIG.ADMIN_LIFF_ID || '').trim() &&
      String(ADMIN_CONFIG.ADMIN_LIFF_ID).indexOf('__') !== 0 && typeof liff !== 'undefined';
    if (liffReady) {
      UI.$('loginLineBtn').classList.remove('hidden');
      UI.$('loginDivider').classList.remove('hidden');
    }

    if (!AdminAPI.getToken() && !AdminAPI.getLineSession()) {
      App.showLogin();
      // เพิ่งเด้งกลับจากหน้าล็อกอินของ LINE (มี code/state ติด URL มา) หรือเปิดในแอป LINE อยู่แล้ว
      // → ลองเข้าให้เอง ผู้ใช้ไม่ต้องกดปุ่มซ้ำหลัง "แตะดำเนินการต่อ"
      // (ถ้ายังไม่ได้ล็อกอิน LINE จะเงียบไว้ รอผู้ใช้กดปุ่มเอง)
      if (liffReady) App.loginLine(true);
      return;
    }
    // โหมด LINE: ต้อง init liff ก่อนเสมอ — token สำหรับ verifySession อ่านจาก SDK ได้ก็ต่อเมื่อ init แล้ว
    // (เดิม init เกิดแค่ใน loginLine ซึ่ง boot ไม่เรียกเมื่อมี session ค้าง → refresh ทุกครั้งโดนเตะ)
    // init ล้ม = best-effort ปล่อยต่อ ให้ verifySession เตะกลับหน้า login เอง
    if (AdminAPI.getLineSession() && liffReady) await App.ensureLiffReady_();
    // มีข้อมูลล็อกอินในเครื่อง (รหัสหรือ LINE) → ตรวจกับเซิร์ฟเวอร์ก่อนเข้า
    // (ถอนสิทธิ์/เปลี่ยนรหัส/เซสชัน LINE หมดอายุ = เตะออกทันที)
    AdminAPI.verifySession()
      .then(() => App.showShell())
      .catch(err => App.showLogin(err.message));
  },

  /** init liff + จับเวลา 5 วินาที (เคส init ค้างเคยเกิดกับหน้าฟอร์มลา/ตารางงาน ต้องไม่ค้างตลอดไป)
   *  คืน true เมื่อพร้อมใช้ — สำเร็จแล้วครั้งหนึ่งจำไว้ ไม่ init ซ้ำ; หมดเวลาไม่จำ (กดใหม่ = ลองใหม่) */
  async ensureLiffReady_() {
    if (this._liffReady) return true;
    if (typeof liff === 'undefined') return false;
    const ready = await Promise.race([
      liff.init({ liffId: String(ADMIN_CONFIG.ADMIN_LIFF_ID).trim() }).then(() => true),
      new Promise(resolve => { setTimeout(() => resolve(false), 5000); }),
    ]);
    if (ready) this._liffReady = true;
    return ready;
  },

  /** ล็อกอินด้วยบัญชี LINE ของผู้ได้รับสิทธิ์ (Settings > admin_staff) — ไม่ต้องจำรหัสกลางอีกต่อไป
   *  auto=true = เรียกเองตอนเปิดหน้า: ถ้ายังไม่ได้ล็อกอิน LINE ให้เงียบไว้ ไม่ดันไปหน้าล็อกอินของ LINE */
  async loginLine(auto) {
    const btn = UI.$('loginLineBtn');
    const err = UI.$('loginError');
    const notice = UI.$('loginNotice');
    err.classList.add('hidden');
    if (notice) notice.classList.add('hidden');
    UI.setBusy(btn, true, 'กำลังเชื่อมต่อ LINE…');
    try {
      if (typeof liff === 'undefined') throw new Error('โหลด LINE SDK ไม่สำเร็จ — ลองรีเฟรชหน้า');
      const ready = await App.ensureLiffReady_();
      if (!ready) throw new Error('เชื่อมต่อ LINE ช้าเกินไป — ลองกดอีกครั้ง หรือเปิดหน้านี้ในแอป LINE');
      if (!liff.isLoggedIn()) {
        if (auto) return; // ยังไม่ได้ล็อกอิน — รอผู้ใช้กดปุ่ม (ตอนนั้นจะพาไปหน้าล็อกอินของ LINE แล้วเด้งกลับ)
        liff.login();
        return;
      }
      const accessToken = liff.getAccessToken();
      if (!accessToken) throw new Error('ยังไม่ได้รับการยืนยันจาก LINE — กรุณากดเข้าสู่ระบบอีกครั้ง');
      const res = await AdminAPI.loginLine(accessToken);
      AdminAPI.setLineSession(); // ไม่เก็บสตริง token — คำขอถัดไปอ่านสดจาก SDK ทุกครั้ง
      App.showShell();
      UI.showToast('เข้าสู่ระบบสำเร็จ' + (res && res.actor ? ' — ' + res.actor : ''));
    } catch (e) {
      const unauthorized = e && e.code === 'UNAUTHORIZED';
      if (unauthorized && (e.message || '').indexOf('หมดอายุ') !== -1) {
        // เซสชัน LINE หมดอายุ (token LIFF อายุ 12 ชม.) — ล้างตัวเก่าแล้วขอใหม่ให้เองเลย
        // ผู้ใช้กดปุ่มครั้งเดียว ไม่ต้องมากดซ้ำหลังเจอ error (pattern หน้าตารางงาน)
        try { liff.logout(); } catch (_) { /* ไปต่อได้ */ }
        // ในแอป LINE ห้ามเรียก liff.login() (เอกสาร LINE) — รีโหลดให้ init ออก token ใหม่แทน (ทั้งโหมด auto/manual)
        if (typeof liff.isInClient === 'function' && liff.isInClient()) { location.reload(); return; }
        if (!auto) {
          try { liff.login(); return; } catch (_) { /* redirect ไม่เกิด — ไปแสดง notice ด้านล่างต่อ */ }
        }
      }
      if (unauthorized && notice) {
        // ปฏิเสธเรื่องสิทธิ์/เซสชัน → notice เหลืองทั้งโหมด auto/manual: ต้องบอกชัดว่าไม่มีสิทธิ์เข้าถึงหน้านี้
        // ไม่ใช่ error ระบบ — เงียบไว้ผู้ใช้ที่หลงเข้ามาจะคิดว่าระบบพัง
        notice.textContent = (e.message || 'บัญชี LINE นี้ไม่มีสิทธิ์เข้าถึงหน้านี้') +
          '\nหากคุณควรมีสิทธิ์เข้าถึงหน้านี้ ติดต่อผู้ดูแลระบบ — หรือเข้าสู่ระบบด้วยรหัสผู้ดูแลด้านล่าง';
        notice.classList.remove('hidden');
      } else if (!auto) {
        // error ทางเทคนิค (เน็ต/SDK/init ค้าง) แสดงเฉพาะที่ผู้ใช้กดเอง — โหมด auto เงียบ รอผู้ใช้กดปุ่ม
        err.textContent = e.message || 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ';
        err.classList.remove('hidden');
      }
    } finally {
      UI.setBusy(btn, false);
    }
  },

  async login() {
    const input = UI.$('tokenInput');
    const btn = UI.$('loginBtn');
    const err = UI.$('loginError');
    const token = input.value.trim();
    err.classList.add('hidden');
    if (!token) {
      err.textContent = 'กรุณากรอกรหัสผู้ดูแล';
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
      btn.className = 'nav-btn flex-1 min-h-11 min-w-[72px] py-2.5 px-2 rounded-lg text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' +
        (active ? 'bg-primary text-white' : 'text-slate-500');
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      if (active && window.innerWidth < 640) {
        requestAnimationFrame(() => btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
      }
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
