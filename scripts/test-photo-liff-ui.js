'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'assertion failed');
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach(name => this.values.add(name));
  }

  remove(...names) {
    names.forEach(name => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled =
      force === undefined
        ? !this.values.has(name)
        : !!force;

    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }

    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(id) {
    this.id = id || '';
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild() {}
}

async function run() {
  const filename =
    path.resolve(
      __dirname,
      '../web/liff-photo/index.html'
    );

  const html =
    fs.readFileSync(filename, 'utf8');

  const scripts = [
    ...html.matchAll(
      /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
    ),
  ].map(match => match[1]);

  let source =
    scripts.find(script =>
      script.includes("'use strict';")
    );

  assert(
    source,
    'photo LIFF runtime script missing'
  );

  // ---------- Static security contract ----------

  [
    'liff.getAccessToken()',
    "apiAction: 'photoTicket'",
    'withLoginOnExternalBrowser: true',
    "'/v1/session'",
    'Authorization',
    'Bearer ',
  ].forEach(required => {
    assert(
      source.includes(required),
      'photo LIFF runtime missing: ' + required
    );
  });

  assert(
    !source.includes('atob('),
    'photo LIFF must not decode ticket claims'
  );

  assert(
    !/localStorage[\s\S]*ticket/i.test(source),
    'Photo Ticket must not be stored in localStorage'
  );

  assert(
    !/sessionStorage\.setItem\([^)]*ticket/i.test(source),
    'Photo Ticket must not be stored in sessionStorage'
  );

  // แทน boot() ท้ายไฟล์ด้วย test hook
  source = source.replace(
    /\n\s*boot\(\);\s*\n\s*\}\)\(\);\s*$/,
    `
  globalThis.__photoUiTest = {
    state,
    boot,
    requestPhotoTicket,
    photoApi,

    loadTopics:
      typeof loadTopics === 'function'
        ? loadTopics
        : null,

    selectTopic:
      typeof selectTopic === 'function'
        ? selectTopic
        : null,

    selectYear:
      typeof selectYear === 'function'
        ? selectYear
        : null,

    selectActivity:
      typeof selectActivity === 'function'
        ? selectActivity
        : null,

    buildActivityName:
      typeof buildActivityName === 'function'
        ? buildActivityName
        : null,

    createActivity:
      typeof createActivity === 'function'
        ? createActivity
        : null,
  };
})();`
  );

  assert(
    source.includes('__photoUiTest'),
    'could not install photo LIFF test hook'
  );

  const elements = new Map();

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, new FakeElement(id));
      }

      return elements.get(id);
    },

    querySelectorAll() {
      return [];
    },

    createElement(tag) {
      return new FakeElement(tag);
    },
  };

  const fetchCalls = [];
  const liffInitCalls = [];

  const bridgeActor = {
    sub: 'U123',
    staffKey: 'bridge-staff',
    role: 'user',
    exp: 2000,
  };

  const context = vm.createContext({
    console,
    document,

    window: {
      scrollTo() {},
    },

    location: {
      origin: 'https://9gotstory.github.io',
      pathname:
        '/notion-notify/web/liff-photo/',
      reload() {},
      replace() {},
    },

    sessionStorage: {
      values: new Map(),

      getItem(key) {
        return this.values.has(key)
          ? this.values.get(key)
          : null;
      },

      setItem(key, value) {
        this.values.set(
          String(key),
          String(value)
        );
      },

      removeItem(key) {
        this.values.delete(String(key));
      },
    },

    CONFIG: {
      LIFF_ID: '123456-testphoto',
      API_URL:
        'https://script.google.com/macros/s/test/exec',
      PHOTO_API_URL:
        'https://photo.example.test:8443',
    },

    liff: {
      async init(options) {
        liffInitCalls.push(options);
      },

      isLoggedIn() {
        return true;
      },

      isInClient() {
        return true;
      },

      getAccessToken() {
        return 'line-access-token';
      },

      logout() {},

      login() {
        throw new Error(
          'login must not be called in logged-in test'
        );
      },
    },

    AbortController,
    Date,
    JSON,
    Map,
    Set,
    Math,

    setTimeout() {
      return 1;
    },

    clearTimeout() {},

    async fetch(url, options = {}) {
      fetchCalls.push({
        url: String(url),
        method: String(
          options.method || 'GET'
        ).toUpperCase(),
        headers: options.headers || {},
        body:
          options.body == null
            ? ''
            : String(options.body),
      });

      if (fetchCalls.length === 1) {
        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,

              ticket:
                'runtime-photo-ticket',

              // ตั้งใจให้ต่างจาก Bridge
              // เพื่อพิสูจน์ว่า UI ไม่เชื่อ role นี้
              actor: {
                staffKey:
                  'issuer-staff',
                role: 'admin',
                exp: 9999,
              },
            };
          },
        };
      }

      if (fetchCalls.length === 2) {
        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              actor: bridgeActor,
            };
          },
        };
      }

      if (fetchCalls.length === 3) {
        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,

              topics: [
                {
                  name:
                    '80_งานกิจกรรมกลาง',
                  path:
                    '80_งานกิจกรรมกลาง',
                  type: 'topic',
                },
                {
                  name:
                    '90_ภาพองค์กร',
                  path:
                    '90_ภาพองค์กร',
                  type:
                    'organization',
                },
              ],
            };
          },
        };
      }

      if (
        fetchCalls.length === 4 ||
        fetchCalls.length === 5
      ) {
        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,

              activities: [
                {
                  name:
                    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
                  path:
                    '80_งานกิจกรรมกลาง/2569/' +
                    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
                },
                {
                  name:
                    '2569-01-15_กิจกรรมแรก',
                  path:
                    '80_งานกิจกรรมกลาง/2569/' +
                    '2569-01-15_กิจกรรมแรก',
                },
              ],
            };
          },
        };
      }

      if (fetchCalls.length === 6) {
        return {
          ok: true,
          status: 201,

          async json() {
            return {
              ok: true,
              created: true,

              activity: {
                name:
                  '2569-09-21_ทดสอบ Photo Bridge',
                path:
                  '80_งานกิจกรรมกลาง/2569/' +
                  '2569-09-21_ทดสอบ Photo Bridge',
              },
            };
          },
        };
      }

      throw new Error(
        'unexpected extra fetch: ' + url
      );
    },
  });

  context.globalThis = context;

  vm.runInContext(
    source,
    context,
    {
      filename:
        'liff-photo-inline.js',
    }
  );

  const ui =
    context.__photoUiTest;

  assert(
    ui,
    'photo LIFF test hook missing'
  );

  await ui.boot();

  // ---------- LIFF ----------

  assert(
    liffInitCalls.length === 1,
    'LIFF must initialize once'
  );

  assert(
    liffInitCalls[0].liffId ===
      '123456-testphoto',
    'LIFF ID mismatch'
  );

  assert(
    liffInitCalls[0]
      .withLoginOnExternalBrowser === true,
    'external browser login must be enabled'
  );

  // ---------- Apps Script issuer ----------

  assert(
    fetchCalls.length === 3,
    'boot must load selectable topics after verified session'
  );

  const issuer =
    fetchCalls[0];

  assert(
    issuer.url ===
      context.CONFIG.API_URL,
    'Photo Ticket must be requested from Apps Script'
  );

  assert(
    issuer.method === 'POST',
    'Photo Ticket issuer must use POST'
  );

  assert(
    issuer.headers['Content-Type'] ===
      'text/plain;charset=utf-8',
    'Apps Script request must remain a simple text/plain request'
  );

  const issuerBody =
    JSON.parse(issuer.body);

  assert(
    issuerBody.apiAction ===
      'photoTicket',
    'issuer apiAction mismatch'
  );

  assert(
    issuerBody.accessToken ===
      'line-access-token',
    'issuer must use fresh LIFF access token'
  );

  // ---------- Photo Bridge ----------

  const session =
    fetchCalls[1];

  assert(
    session.url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/session',
    'Photo Bridge session URL mismatch'
  );

  assert(
    session.method === 'GET',
    'Photo Bridge session must use GET'
  );

  assert(
    session.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'Photo Bridge must receive Photo Ticket as Bearer token'
  );

  // ---------- Topics ----------

  const topicsRequest =
    fetchCalls[2];

  assert(
    topicsRequest.url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/topics',
    'boot must load topics from Photo Bridge'
  );

  assert(
    topicsRequest.method === 'GET',
    'topics request must use GET'
  );

  assert(
    topicsRequest.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'topics request must use Photo Ticket'
  );

  assert(
    Array.isArray(ui.state.topics) &&
      ui.state.topics.length === 2,
    'boot must retain selectable topics'
  );

  // ---------- Runtime-only ticket ----------

  assert(
    ui.state.photoTicket ===
      'runtime-photo-ticket',
    'Photo Ticket must exist only in runtime state'
  );

  // ---------- Bridge is authority ----------

  assert(
    ui.state.actor &&
      ui.state.actor.role === 'user',
    'role must come from verified Photo Bridge session'
  );

  assert(
    ui.state.actor.staffKey ===
      'bridge-staff',
    'staffKey must come from verified Photo Bridge session'
  );

  assert(
    ui.state.actor.role !==
      'admin',
    'UI must not trust issuer actor as final authority'
  );

  // ---------- Create activity UI ----------

  [
    'id="activityDate"',
    'id="activityNameInput"',
    'id="createActivityButton"',
  ].forEach(required => {
    assert(
      html.includes(required),
      'create activity UI missing: ' + required
    );
  });

  // ---------- Destination selection ----------

  assert(
    typeof ui.loadTopics === 'function',
    'photo UI must provide loadTopics()'
  );

  assert(
    typeof ui.selectTopic === 'function',
    'photo UI must provide selectTopic()'
  );

  assert(
    typeof ui.selectYear === 'function',
    'photo UI must provide selectYear()'
  );

  assert(
    typeof ui.selectActivity === 'function',
    'photo UI must provide selectActivity()'
  );

  // 90_ภาพองค์กร จบที่ topic โดยตรง
  const beforeOrganization =
    fetchCalls.length;

  await ui.selectTopic(
    '90_ภาพองค์กร'
  );

  assert(
    fetchCalls.length ===
      beforeOrganization,
    'organization destination must not request activities'
  );

  assert(
    ui.state.destination &&
      ui.state.destination.type ===
        'organization' &&
      ui.state.destination.topic ===
        '90_ภาพองค์กร' &&
      ui.state.destination.path ===
        '90_ภาพองค์กร',
    'organization topic must become destination directly'
  );

  assert(
    !Object.prototype.hasOwnProperty.call(
      ui.state.destination,
      'year'
    ) &&
      !Object.prototype.hasOwnProperty.call(
        ui.state.destination,
        'activity'
      ),
    'organization destination must not contain year/activity'
  );

  // topic ปกติยังไม่เป็น destination
  await ui.selectTopic(
    '80_งานกิจกรรมกลาง'
  );

  assert(
    ui.state.destination === null,
    'normal topic requires year and activity'
  );

  assert(
    /^\d{4}$/.test(
      ui.state.selectedYear
    ),
    'normal topic must default to current Buddhist year'
  );

  assert(
    fetchCalls.length === 4,
    'normal topic must immediately load current-year activities'
  );

  assert(
    Array.isArray(ui.state.activities) &&
      ui.state.activities.length === 2,
    'current-year activities must be retained after topic selection'
  );

  // ปีผิดต้องหยุดที่ client และไม่ยิง API
  const beforeInvalidYear =
    fetchCalls.length;

  let invalidYearError = null;

  try {
    await ui.selectYear(
      '2026-09'
    );
  } catch (err) {
    invalidYearError = err;
  }

  assert(
    invalidYearError,
    'invalid Buddhist year must be rejected'
  );

  assert(
    fetchCalls.length ===
      beforeInvalidYear,
    'invalid year must not call Photo Bridge'
  );

  // ปี พ.ศ. ถูกต้อง → โหลดกิจกรรม
  await ui.selectYear(
    '2569'
  );

  assert(
    fetchCalls.length === 5,
    'valid year must load activities'
  );

  const activitiesRequest =
    fetchCalls[4];

  const expectedActivitiesUrl =
    context.CONFIG.PHOTO_API_URL +
    '/v1/activities?topic=' +
    encodeURIComponent(
      '80_งานกิจกรรมกลาง'
    ) +
    '&year=2569';

  assert(
    activitiesRequest.url ===
      expectedActivitiesUrl,
    'activities request URL mismatch'
  );

  assert(
    activitiesRequest.method === 'GET',
    'activities request must use GET'
  );

  assert(
    activitiesRequest.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'activities request must use Photo Ticket'
  );

  assert(
    Array.isArray(ui.state.activities) &&
      ui.state.activities.length === 2,
    'activities response must be retained'
  );

  // เลือก activity → destination พร้อม
  const activityName =
    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง';

  await ui.selectActivity(
    activityName
  );

  assert(
    ui.state.destination &&
      ui.state.destination.type ===
        'activity' &&
      ui.state.destination.topic ===
        '80_งานกิจกรรมกลาง' &&
      ui.state.destination.year ===
        '2569' &&
      ui.state.destination.activity ===
        activityName &&
      ui.state.destination.path ===
        '80_งานกิจกรรมกลาง/2569/' +
        activityName,
    'activity selection must produce canonical destination'
  );

  // ---------- Create activity ----------

  assert(
    typeof ui.buildActivityName ===
      'function',
    'photo UI must provide buildActivityName()'
  );

  assert(
    typeof ui.createActivity ===
      'function',
    'photo UI must provide createActivity()'
  );

  const canonicalName =
    ui.buildActivityName(
      '2026-09-21',
      '  ทดสอบ Photo Bridge  '
    );

  assert(
    canonicalName ===
      '2569-09-21_ทดสอบ Photo Bridge',
    'Gregorian activity date must become canonical Buddhist-year folder name'
  );

  // วันที่ต้องสัมพันธ์กับปี พ.ศ. ที่เลือก
  const beforeWrongYear =
    fetchCalls.length;

  let wrongYearError = null;

  try {
    await ui.createActivity(
      '2025-09-21',
      'ปีไม่ตรงกัน'
    );
  } catch (err) {
    wrongYearError = err;
  }

  assert(
    wrongYearError,
    'activity date outside selected Buddhist year must be rejected'
  );

  assert(
    fetchCalls.length ===
      beforeWrongYear,
    'invalid activity year must not call Photo Bridge'
  );

  // ชื่อที่มี path separator ต้องถูกปฏิเสธฝั่ง client
  const beforeUnsafeName =
    fetchCalls.length;

  let unsafeNameError = null;

  try {
    await ui.createActivity(
      '2026-09-21',
      '../unsafe'
    );
  } catch (err) {
    unsafeNameError = err;
  }

  assert(
    unsafeNameError,
    'unsafe activity name must be rejected'
  );

  assert(
    fetchCalls.length ===
      beforeUnsafeName,
    'unsafe activity name must not call Photo Bridge'
  );

  // สร้างกิจกรรมจริง
  const created =
    await ui.createActivity(
      '2026-09-21',
      'ทดสอบ Photo Bridge'
    );

  assert(
    fetchCalls.length === 6,
    'create activity must make exactly one POST request'
  );

  const createRequest =
    fetchCalls[5];

  assert(
    createRequest.url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/activities',
    'create activity endpoint mismatch'
  );

  assert(
    createRequest.method === 'POST',
    'create activity must use POST'
  );

  assert(
    createRequest.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'create activity must use Photo Ticket'
  );

  assert(
    createRequest.headers['Content-Type'] ===
      'application/json',
    'create activity must use application/json'
  );

  const createBody =
    JSON.parse(createRequest.body);

  assert(
    createBody.topic ===
      '80_งานกิจกรรมกลาง',
    'create activity topic mismatch'
  );

  assert(
    createBody.year === '2569',
    'create activity Buddhist year mismatch'
  );

  assert(
    createBody.activityName ===
      '2569-09-21_ทดสอบ Photo Bridge',
    'create activity canonical name mismatch'
  );

  assert(
    created &&
      created.name ===
        '2569-09-21_ทดสอบ Photo Bridge',
    'createActivity must return backend activity'
  );

  // backend response เป็น canonical authority
  assert(
    ui.state.destination &&
      ui.state.destination.type ===
        'activity' &&
      ui.state.destination.activity ===
        '2569-09-21_ทดสอบ Photo Bridge' &&
      ui.state.destination.path ===
        '80_งานกิจกรรมกลาง/2569/' +
        '2569-09-21_ทดสอบ Photo Bridge',
    'created backend activity must become selected destination'
  );

  assert(
    ui.state.activities.some(
      item =>
        item.name ===
          '2569-09-21_ทดสอบ Photo Bridge'
    ),
    'created activity must appear in current activity list'
  );

  console.log(
    'Photo LIFF create activity contract passed'
  );

}

run().catch(err => {
  console.error(
    err && err.stack
      ? err.stack
      : err
  );

  process.exitCode = 1;
});
