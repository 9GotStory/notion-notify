// ชั้นเรียก API ของหน้าผู้ดูแลใน direct mode
// GET + URLSearchParams ใช้กับ Apps Script /exec ซึ่ง redirect ไป response URL อีกครั้ง
// __ADMIN_API_URL__ ถูกแทนที่ตอน build ด้วย URL /exec ของ Apps Script webapp
'use strict';

const ADMIN_CONFIG = { API_URL: '__ADMIN_API_URL__' };

const AdminAPI = {

  TOKEN_KEY: 'nn-admin-token',

  getToken() { return sessionStorage.getItem(this.TOKEN_KEY) || ''; },
  setToken(token) { sessionStorage.setItem(this.TOKEN_KEY, token); },
  clearToken() { sessionStorage.removeItem(this.TOKEN_KEY); },

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
    const qs = new URLSearchParams(Object.assign({ apiAction: action }, params || {}));
    let res;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      res = await fetch(ADMIN_CONFIG.API_URL + '?' + qs.toString(), {
        method: 'GET', signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err && err.name === 'AbortError'
        ? 'ระบบใช้เวลาตอบกลับนานเกินไป กรุณาลองอีกครั้ง'
        : 'เชื่อมต่อระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    } finally {
      clearTimeout(timeout);
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
