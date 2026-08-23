// ชั้นเรียก API ของหน้าตั้งค้าผู้ดูแล — pattern เดียวกับ web/liff-form (ต้นแบบที่ใช้งานจริงใน production)
//
// GET + URLSearchParams เท่านั้น: /exec ของ Apps Script ตอบ 302 แล้ว browser/WebView รุ่นเก่า
// rewrite POST→GET ตาม spec ทำให้ body หาย — ทุก action (รวม save_*) จึงส่งเป็น query params
// object/array ส่งเป็น JSON string ในพารามิเตอร์ data แล้วเซิร์ฟเวอร์ parseJsonParam_ ให้
//
// __ADMIN_API_URL__ ถูกแทนที่ตอน build โดย GitHub Actions (Environment "liff" > ADMIN_API_URL)
'use strict';

const ADMIN_CONFIG = { API_URL: '__ADMIN_API_URL__' };

const AdminAPI = {

  TOKEN_KEY: 'nn-admin-token',

  getToken() { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  setToken(token) { localStorage.setItem(this.TOKEN_KEY, token); },
  clearToken() { localStorage.removeItem(this.TOKEN_KEY); },

  /** เรียก action หนึ่ง — คืน Promise<data เมื่อ ok> / throw Error(ข้อความไทย)
   *  token หมดอายุ/ผิด (UNAUTHORIZED) หรือระบบยังไม่ตั้ง ADMIN_TOKEN (UNCONFIGURED)
   *  → ล้าง token แล้วส่ง event ให้ app.js พากลับหน้า login */
  async call(action, params) {
    const data = await this._fetch(action, Object.assign({}, params || {}, { token: this.getToken() }));
    if (data && data.ok === false && (data.code === 'UNAUTHORIZED' || data.code === 'UNCONFIGURED')) {
      this.clearToken();
      window.dispatchEvent(new CustomEvent('admin-auth-failed', { detail: data }));
    }
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || 'เกิดข้อผิดพลาด ลองอีกครั้ง');
    }
    return data;
  },

  /** ตรวจ token ตอนกดปุ่มเข้าสู่ระบบ — ใช้ token จาก argument (ยังไม่เก็บ) และไม่เตะกลับหน้า login */
  async verify(token) {
    const data = await this._fetch('get_overview', { token: token });
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || 'เชื่อมต่อไม่สำเร็จ');
    }
    return data;
  },

  async _fetch(action, params) {
    const qs = new URLSearchParams(Object.assign({ apiAction: action }, params));
    let res;
    try {
      res = await fetch(ADMIN_CONFIG.API_URL + '?' + qs.toString(), { method: 'GET' });
    } catch (err) {
      throw new Error('เชื่อมต่อระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null; // เซิร์ฟเวอร์ตอบ HTML error page — ให้เด้งไปข้อความสาธารณะด้านล่าง
    }
    if (!res.ok || !data) {
      throw new Error('เชื่อมต่อระบบไม่สำเร็จ (HTTP ' + res.status + ') ลองอีกครั้ง');
    }
    return data;
  },
};
