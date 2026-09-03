// ชั้นเรียก API ของหน้าผู้ดูแลใน direct mode
// POST body JSON แบบ text/plain (simple request ไม่เกิด CORS preflight) ใช้กับ Apps Script /exec
// ซึ่ง redirect ไป response URL อีกครั้ง — token อยู่ใน body ไม่ติด URL ตามแบบหน้าอื่นแล้ว
// __ADMIN_API_URL__ ถูกแทนที่ตอน build ด้วย URL /exec ของ Apps Script webapp
'use strict';

const ADMIN_CONFIG = {
  API_URL: '__ADMIN_API_URL__',
  MAIN_API_URL: '__API_URL__',
  // LIFF ของหน้านี้ (ตัวเลือก — ว่าง = ไม่โชว์ปุ่มล็อกอินด้วย LINE ใช้รหัสผู้ดูแลตามเดิม)
  ADMIN_LIFF_ID: '__ADMIN_LIFF_ID__',
};

const AdminAPI = {

  TOKEN_KEY: 'nn-admin-token',
  LINE_TOKEN_KEY: 'nn-admin-line-token',

  getToken() { return sessionStorage.getItem(this.TOKEN_KEY) || ''; },
  setToken(token) { sessionStorage.setItem(this.TOKEN_KEY, token); },
  getLineToken() { return sessionStorage.getItem(this.LINE_TOKEN_KEY) || ''; },
  setLineToken(token) { sessionStorage.setItem(this.LINE_TOKEN_KEY, token); },
  clearToken() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.LINE_TOKEN_KEY);
  },

  /** เรียก action หนึ่ง — คืน Promise<data เมื่อ ok> / throw Error(ข้อความไทย)
   *  token หมดอายุ/ผิด (UNAUTHORIZED) หรือระบบยังไม่ตั้ง ADMIN_TOKEN (UNCONFIGURED)
   *  → ล้าง token แล้วส่ง event ให้ app.js พากลับหน้า login */
  async call(action, params) {
    const payload = Object.assign({}, params || {}, { token: this.getToken() });
    if (this.getLineToken()) payload.accessToken = this.getLineToken();
    const data = await this._fetch(action, payload);
    if (data && data.ok === false && (data.code === 'UNAUTHORIZED' || data.code === 'UNCONFIGURED')) {
      this.clearToken();
      window.dispatchEvent(new CustomEvent('admin-auth-failed', { detail: data }));
    }
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || 'เกิดข้อผิดพลาด ลองอีกครั้ง');
    }
    return data;
  },

  /** คำสั่งจัดการใบลาต้องวิ่ง Apps Script หลัก เพราะมีสิทธิ์เขียน Notion และส่ง LINE */
  async callMain(action, params) {
    const payload = Object.assign({}, params || {}, { token: this.getToken() });
    if (this.getLineToken()) payload.accessToken = this.getLineToken();
    const data = await this._fetchAt(ADMIN_CONFIG.MAIN_API_URL, action, payload);
    if (data && data.ok === false && (data.code === 'UNAUTHORIZED' || data.code === 'UNCONFIGURED')) {
      this.clearToken();
      window.dispatchEvent(new CustomEvent('admin-auth-failed', { detail: data }));
    }
    if (!data || data.ok === false) throw new Error((data && data.error) || 'เกิดข้อผิดพลาด ลองอีกครั้ง');
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

  /** ล็อกอินด้วย LINE — เซิร์ฟเวอร์ตรวจสิทธิ์กับทำเนียบแล้วคืนชื่อผู้ใช้ (actor) กลับมา */
  async loginLine(accessToken) {
    return this._fetch('admin_login', { accessToken: accessToken });
  },

  async _fetch(action, params) {
    return this._fetchAt(ADMIN_CONFIG.API_URL, action, params);
  },

  async _fetchAt(url, action, params) {
    let res;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      // POST แบบ text/plain = "simple request" ไม่เกิด CORS preflight (Apps Script ตอบ OPTIONS ไม่ได้)
      // และย้าย token/พารามิเตอร์ออกจาก URL — URL พกข้อมูลรับรองไม่ได้ (ติด log/ถูกส่งต่อ)
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ apiAction: action }, params || {})),
        signal: controller.signal,
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
