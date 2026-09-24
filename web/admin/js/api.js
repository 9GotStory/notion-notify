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

const ADMIN_READ_RETRY_DELAYS_MS = [250, 500];

const ADMIN_SAFE_READ_ACTIONS = new Set([
  'get_overview',
  'get_settings',
  'get_holidays',
  'get_logs',
  'get_leave_report',
  'get_balances',
  'get_quota_profiles',
  'get_approvers',
]);

const MAIN_SAFE_READ_ACTIONS = new Set([
  'adminLeaveList',
]);

const AdminAPI = {

  TOKEN_KEY: 'nn-admin-token',
  // โหมด LINE เก็บแค่ flag ไม่เก็บสตริง token — ตัว token จริงอ่านสดจาก liff SDK ทุกคำขอ
  // (LIFF token อายุ 12 ชม. และถูกเพิกถอนเมื่อปิดหน้า — จำตั้งแต่ login แล้วแท็บค้างนานจะส่งตัวตายวนไป)
  LINE_MODE_KEY: 'nn-admin-line',

  getToken() { return sessionStorage.getItem(this.TOKEN_KEY) || ''; },
  getLineSession() { return !!sessionStorage.getItem(this.LINE_MODE_KEY); },
  // เซสชันเดียวโหมดเดียว: ตั้งโหมดใหม่ต้องล้างอีกโหมดด้วย — กันส่ง token สองแบบปนกัน
  // (เซิร์ฟเวอร์ prefer accessToken เมื่อมี ถ้า LINE token หมดอายุแต่ยังติดไป
  //  รหัส ADMIN_TOKEN ที่ยังใช้ได้ก็จะโดนปฏิเสธไปด้วย)
  setToken(token) {
    sessionStorage.setItem(this.TOKEN_KEY, token);
    sessionStorage.removeItem(this.LINE_MODE_KEY);
  },
  setLineSession() {
    sessionStorage.setItem(this.LINE_MODE_KEY, '1');
    sessionStorage.removeItem(this.TOKEN_KEY);
  },
  clearToken() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.LINE_MODE_KEY);
  },

  /** token LINE สดจาก liff SDK สำหรับคำขอนี้ — '' เมื่อไม่ได้อยู่โหมด LINE / SDK ยังไม่ init /
   *  ยังไม่ล็อกอิน (pattern เดียวกับ currentToken() ของหน้าตารางงาน — อ่านใหม่ทุกครั้ง) */
  currentLineToken() {
    if (!this.getLineSession()) return '';
    try {
      if (typeof liff === 'undefined' || typeof liff.isLoggedIn !== 'function' || !liff.isLoggedIn()) return '';
      return liff.getAccessToken() || '';
    } catch (err) { return ''; }
  },

  /** เรียก action หนึ่ง — คืน Promise<data เมื่อ ok> / throw Error(ข้อความไทย)
   *  เฉพาะ token หมดอายุ/ผิด (UNAUTHORIZED) เท่านั้นที่ล้าง credential และส่ง
   *  admin-auth-failed; UNCONFIGURED/outage/upstream error ต้องเก็บ session เดิมไว้ */
  async call(action, params) {
    const payload = Object.assign({}, params || {}, { token: this.getToken() });
    const lineToken = this.currentLineToken();
    if (lineToken) payload.accessToken = lineToken;
    const data = await this._fetch(
      action,
      payload,
      { retryTransient: ADMIN_SAFE_READ_ACTIONS.has(action) }
    );
    this._handleAuthFailure(data);

    if (!data || data.ok === false) {
      throw this._apiError(
        data,
        'เกิดข้อผิดพลาด ลองอีกครั้ง'
      );
    }

    return data;
  },

  /** คำสั่งจัดการใบลาต้องวิ่ง Apps Script หลัก เพราะมีสิทธิ์เขียน Notion และส่ง LINE */
  async callMain(action, params) {
    const payload = Object.assign({}, params || {}, { token: this.getToken() });
    const lineToken = this.currentLineToken();
    if (lineToken) payload.accessToken = lineToken;
    const data = await this._fetchAt(
      ADMIN_CONFIG.MAIN_API_URL,
      action,
      payload,
      { retryTransient: MAIN_SAFE_READ_ACTIONS.has(action) }
    );
    this._handleAuthFailure(data);

    if (!data || data.ok === false) {
      throw this._apiError(
        data,
        'เกิดข้อผิดพลาด ลองอีกครั้ง'
      );
    }

    return data;
  },

  _apiError(data, fallbackMessage) {
    const error = new Error(
      (data && data.error) ||
      fallbackMessage ||
      'เกิดข้อผิดพลาด ลองอีกครั้ง'
    );

    if (data && data.code) {
      error.code = data.code;
    }

    return error;
  },

  _handleAuthFailure(data) {
    if (
      !data ||
      data.ok !== false ||
      data.code !== 'UNAUTHORIZED'
    ) {
      return;
    }

    this.clearToken();

    window.dispatchEvent(
      new CustomEvent(
        'admin-auth-failed',
        { detail: data }
      )
    );
  },

  /** ตรวจรหัสที่ผู้ใช้พิมพ์ตอนกดปุ่มเข้าสู่ระบบด้วยรหัส — ใช้ token จาก argument (ยังไม่เก็บ)
   *  ไม่แนบ accessToken (กัน stale LINE token ที่ค้างในเครื่องไป block การล็อกอินด้วยรหัส)
   *  และไม่เตะกลับหน้า login */
  async verify(token) {
    const data = await this._fetch(
      'get_overview',
      { token: token },
      { retryTransient: true }
    );
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || 'เชื่อมต่อไม่สำเร็จ');
    }
    return data;
  },

  /** ตรวจสิ่งที่ล็อกอินค้างไว้ในเครื่องตอนเปิดหน้า — รหัสหรือโหมด LINE อันไหนมีส่งอันนั้น
   *  (mirror call()) — LINE admin refresh หน้าแล้วต้องเข้าต่อได้ ไม่โดนเตะกลับหน้า login
   *  (โหมด LINE: app.js ต้อง ensureLiffReady_ ก่อน — currentLineToken อ่านได้เมื่อ init แล้ว) */
  async verifySession() {
    const payload = { token: this.getToken() };
    const lineToken = this.currentLineToken();
    if (lineToken) payload.accessToken = lineToken;
    const data = await this._fetch(
      'get_overview',
      payload,
      { retryTransient: true }
    );
    if (data && data.ok === false && data.code === 'UNAUTHORIZED') {
      this.clearToken(); // เซิร์ฟเวอร์ยืนยันตัวรับรองไม่ผ่าน — ล้างกันวนซ้ำ (เคสเน็ตหลุด/HTTP error ไม่ล้าง)
    }
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || 'เชื่อมต่อไม่สำเร็จ');
    }
    return data;
  },

  /** ล็อกอินด้วย LINE — เซิร์ฟเวอร์ตรวจสิทธิ์กับทำเนียบแล้วคืนชื่อผู้ใช้ (actor) กลับมา
   *  โดนปฏิเสธ (ไม่มีสิทธิ์/เซสชันหมดอายุ) = throw พร้อม code ให้หน้า login แยกเคสแสดงผล */
  async loginLine(accessToken) {
    const data = await this._fetch(
      'admin_login',
      { accessToken: accessToken },
      { retryTransient: true }
    );
    if (!data || data.ok === false) {
      const err = new Error((data && data.error) || 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ');
      err.code = data && data.code;
      throw err;
    }
    return data;
  },

  async _fetch(action, params, options) {
    return this._fetchAt(
      ADMIN_CONFIG.API_URL,
      action,
      params,
      options
    );
  },

  _waitForRetry(delayMs) {
    return new Promise(resolve => {
      setTimeout(resolve, delayMs);
    });
  },

  _transportError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    if (status != null) error.status = Number(status);
    return error;
  },

  _isRetryableTransportError(error) {
    if (!error) return false;

    if (
      error.code === 'NETWORK_ERROR' ||
      error.code === 'NETWORK_TIMEOUT' ||
      error.code === 'LINE_UNAVAILABLE' ||
      error.code === 'UPSTREAM_ERROR'
    ) {
      return true;
    }

    const status = Number(error.status);

    return (
      status === 408 ||
      status === 429 ||
      (status >= 500 && status <= 599)
    );
  },

  _isRetryableDataResponse(data) {
    if (!data || data.ok !== false) return false;

    return (
      data.code === 'LINE_UNAVAILABLE' ||
      data.code === 'UPSTREAM_ERROR'
    );
  },

  async _fetchAt(url, action, params, options) {
    const retryTransient =
      !!(options && options.retryTransient === true);

    const maxAttempts =
      retryTransient ? 3 : 1;

    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt += 1
    ) {
      let res = null;
      let data = null;
      let error = null;

      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        20000
      );

      try {
        // POST แบบ text/plain = "simple request" ไม่เกิด CORS preflight
        // (Apps Script ตอบ OPTIONS ไม่ได้)
        //
        // token/params อยู่ใน body ไม่ติด URL/log/referrer
        res = await fetch(url, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type':
              'text/plain;charset=utf-8',
          },
          body: JSON.stringify(
            Object.assign(
              { apiAction: action },
              params || {}
            )
          ),
          signal: controller.signal,
        });
      } catch (err) {
        const timedOut =
          !!(
            err &&
            err.name === 'AbortError'
          );

        error = this._transportError(
          timedOut
            ? 'ระบบใช้เวลาตอบกลับนานเกินไป กรุณาลองอีกครั้ง'
            : 'เชื่อมต่อระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
          timedOut
            ? 'NETWORK_TIMEOUT'
            : 'NETWORK_ERROR'
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!error) {
        try {
          data = await res.json();
        } catch (err) {
          data = null;
        }

        if (!res.ok) {
          error = this._transportError(
            'เชื่อมต่อระบบไม่สำเร็จ (HTTP ' +
              res.status +
              ') ลองอีกครั้ง',
            'UPSTREAM_ERROR',
            res.status
          );
        } else if (!data) {
          error = this._transportError(
            'เชื่อมต่อระบบไม่สำเร็จ (HTTP ' +
              res.status +
              ') ลองอีกครั้ง',
            'UPSTREAM_ERROR',
            res.status
          );
        }
      }

      const hasNextAttempt =
        attempt < maxAttempts;

      if (
        !error &&
        retryTransient &&
        hasNextAttempt &&
        this._isRetryableDataResponse(data)
      ) {
        await this._waitForRetry(
          ADMIN_READ_RETRY_DELAYS_MS[
            attempt - 1
          ]
        );

        continue;
      }

      if (
        error &&
        retryTransient &&
        hasNextAttempt &&
        this._isRetryableTransportError(error)
      ) {
        await this._waitForRetry(
          ADMIN_READ_RETRY_DELAYS_MS[
            attempt - 1
          ]
        );

        continue;
      }

      if (error) throw error;

      return data;
    }

    throw this._transportError(
      'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง',
      'UPSTREAM_ERROR'
    );
  },
};
