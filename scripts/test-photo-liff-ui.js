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

    uploadFiles:
      typeof uploadFiles === 'function'
        ? uploadFiles
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

  // Contract สำหรับ Photo Ticket หมดอายุ:
  // request แรกได้ 401 -> ขอ ticket ใหม่ -> retry เดิม 1 ครั้ง
  let renewalMode = 'off';

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
        rawBody: (options && options.body),
      });

      const requestUrl =
        String(url);

      // จำลอง Photo Ticket หมดอายุใน request จริง
      if (
        renewalMode === 'expire-next' &&
        requestUrl.startsWith(
          'https://photo.example.test:8443/'
        )
      ) {
        renewalMode = 'issuer';

        return {
          ok: false,
          status: 401,

          async json() {
            return {
              ok: false,
              error: 'Photo ticket expired',
            };
          },
        };
      }

      // หลัง 401 ต้องกลับไปขอ Photo Ticket ใหม่
      // โดยใช้ LINE access token สด
      if (
        renewalMode === 'issuer' &&
        requestUrl ===
          'https://script.google.com/macros/s/test/exec'
      ) {
        renewalMode = 'retry';

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              ticket:
                'renewed-photo-ticket',
            };
          },
        };
      }

      // request เดิมหลัง renew ต้องถูก retry
      // ด้วย ticket ใหม่
      if (
        renewalMode === 'retry' &&
        requestUrl.startsWith(
          'https://photo.example.test:8443/'
        )
      ) {
        renewalMode = 'done';

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

      if (
        url.includes('/v1/uploads?') ||
        url.includes('/v1/organization/uploads?')
      ) {
        const parsed =
          new URL(url);

        const filename =
          parsed.searchParams.get('filename');

        if (filename === 'bad.jpg') {
          return {
            ok: false,
            status: 409,

            async json() {
              return {
                ok: false,
                error:
                  'A file with this name already exists',
              };
            },
          };
        }

        return {
          ok: true,
          status: 201,

          async json() {
            return {
              ok: true,

              file: {
                name:
                  filename === 'photo.png'
                    ? 'photo.jpg'
                    : filename,

                path:
                  (
                    url.includes(
                      '/v1/organization/uploads?'
                    )
                      ? '90_ภาพองค์กร/'
                      : (
                          '80_งานกิจกรรมกลาง/2569/' +
                          '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง/'
                        )
                  ) +
                  (
                    filename === 'photo.png'
                      ? 'photo.jpg'
                      : filename
                  ),

                mime:
                  'image/jpeg',

                size:
                  options &&
                  options.body &&
                  typeof options.body.size ===
                    'number'
                    ? options.body.size
                    : 3,
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

  // ---------- Upload UI ----------

  [
    'id="photoInput"',
    'id="uploadButton"',
    'id="uploadStatus"',
    'id="uploadResults"',
  ].forEach(required => {
    assert(
      html.includes(required),
      'upload UI missing: ' + required
    );
  });

  assert(
    /id="photoInput"[^>]*multiple/s.test(
      html
    ),
    'photo input must support multiple files'
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

  // ---------- Multi-file upload ----------

  assert(
    typeof ui.uploadFiles === 'function',
    'photo UI must provide uploadFiles()'
  );

  // ไม่มี destination ต้องไม่ยิง API
  ui.state.destination = null;

  const beforeNoDestination =
    fetchCalls.length;

  let noDestinationError = null;

  try {
    await ui.uploadFiles([
      {
        name: 'photo.jpg',
        size: 3,
        type: 'image/jpeg',
      },
    ]);
  } catch (err) {
    noDestinationError = err;
  }

  assert(
    noDestinationError,
    'upload without destination must be rejected'
  );

  assert(
    fetchCalls.length ===
      beforeNoDestination,
    'upload without destination must not call Photo Bridge'
  );

  // เกิน 25 MiB ต้องหยุดฝั่ง browser
  ui.state.destination = {
    type: 'activity',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activity:
      '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
    path:
      '80_งานกิจกรรมกลาง/2569/' +
      '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
  };

  const beforeOversize =
    fetchCalls.length;

  const oversizeResults =
    await ui.uploadFiles([
      {
        name: 'too-large.jpg',
        size: 26214401,
        type: 'image/jpeg',
      },
    ]);

  assert(
    fetchCalls.length ===
      beforeOversize,
    'file over 25 MiB must not call Photo Bridge'
  );

  assert(
    Array.isArray(oversizeResults) &&
      oversizeResults.length === 1 &&
      oversizeResults[0].ok === false,
    'oversize file must return per-file failure result'
  );

  // activity: หลายไฟล์ + failure หนึ่งไฟล์
  // ต้องทำไฟล์ถัดไปต่อ ไม่ abort ทั้ง batch
  const activityStart =
    fetchCalls.length;

  const activityFiles = [
    {
      name: 'photo.png',
      size: 3,
      type: 'image/png',
    },
    {
      name: 'bad.jpg',
      size: 3,
      type: 'image/jpeg',
    },
    {
      name: 'third.jpg',
      size: 3,
      type: 'image/jpeg',
    },
  ];

  const activityResults =
    await ui.uploadFiles(
      activityFiles
    );

  assert(
    fetchCalls.length ===
      activityStart + 3,
    'activity upload must attempt every valid file'
  );

  assert(
    activityResults.length === 3 &&
      activityResults[0].ok === true &&
      activityResults[1].ok === false &&
      activityResults[2].ok === true,
    'one failed upload must not cancel remaining files'
  );

  const firstActivityUpload =
    fetchCalls[activityStart];

  const expectedActivityUrl =
    context.CONFIG.PHOTO_API_URL +
    '/v1/uploads?topic=' +
    encodeURIComponent(
      '80_งานกิจกรรมกลาง'
    ) +
    '&year=2569' +
    '&activity=' +
    encodeURIComponent(
      '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง'
    ) +
    '&filename=' +
    encodeURIComponent(
      'photo.png'
    );

  assert(
    firstActivityUpload.url ===
      expectedActivityUrl,
    'activity upload URL mismatch'
  );

  assert(
    firstActivityUpload.method ===
      'POST',
    'activity upload must use POST'
  );

  assert(
    firstActivityUpload.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'activity upload must use Photo Ticket'
  );

  assert(
    firstActivityUpload.rawBody ===
      activityFiles[0],
    'browser must send raw file body'
  );

  // Backend magic bytes เป็น authority:
  // browser ต้องยอมรับชื่อ normalize ที่ server คืนมา
  assert(
    activityResults[0].file &&
      activityResults[0].file.name ===
        'photo.jpg',
    'upload result must use backend normalized filename'
  );

  // 90_ภาพองค์กร ใช้ endpoint แยก
  ui.state.destination = {
    type: 'organization',
    topic: '90_ภาพองค์กร',
    path: '90_ภาพองค์กร',
  };

  const organizationStart =
    fetchCalls.length;

  const organizationFile = {
    name: 'logo.png',
    size: 3,
    type: 'image/png',
  };

  const organizationResults =
    await ui.uploadFiles([
      organizationFile,
    ]);

  assert(
    fetchCalls.length ===
      organizationStart + 1,
    'organization upload must make one request'
  );

  const organizationUpload =
    fetchCalls[organizationStart];

  assert(
    organizationUpload.url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/organization/uploads?filename=' +
        encodeURIComponent(
          'logo.png'
        ),
    'organization upload endpoint mismatch'
  );

  assert(
    organizationUpload.method ===
      'POST',
    'organization upload must use POST'
  );

  assert(
    organizationUpload.headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'organization upload must use Photo Ticket'
  );

  assert(
    organizationUpload.rawBody ===
      organizationFile,
    'organization upload must send raw file body'
  );

  assert(
    organizationResults.length === 1 &&
      organizationResults[0].ok ===
        true,
    'organization upload must return per-file success'
  );

  // ---------- Expired Photo Ticket renewal ----------

  const beforeRenewal =
    fetchCalls.length;

  renewalMode = 'expire-next';

  const renewedSession =
    await ui.photoApi(
      '/v1/session'
    );

  const renewalCalls =
    fetchCalls.slice(
      beforeRenewal
    );

  assert(
    renewalMode === 'done',
    'expired Photo Ticket must be renewed and retried once'
  );

  assert(
    renewalCalls.length === 3,
    'expired ticket flow must perform original request, issuer request, and one retry'
  );

  assert(
    renewalCalls[0].url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/session',
    'expired-ticket original request mismatch'
  );

  assert(
    renewalCalls[0].headers.Authorization ===
      'Bearer runtime-photo-ticket',
    'first request must use original Photo Ticket'
  );

  assert(
    renewalCalls[1].url ===
      context.CONFIG.API_URL,
    '401 must request a new Photo Ticket from Apps Script'
  );

  const renewalIssuerBody =
    JSON.parse(
      renewalCalls[1].body
    );

  assert(
    renewalIssuerBody.apiAction ===
      'photoTicket' &&
      renewalIssuerBody.accessToken ===
        'line-access-token',
    'renewal must use a fresh LIFF access token'
  );

  assert(
    renewalCalls[2].url ===
      context.CONFIG.PHOTO_API_URL +
        '/v1/session',
    'original Photo Bridge request must be retried'
  );

  assert(
    renewalCalls[2].headers.Authorization ===
      'Bearer renewed-photo-ticket',
    'retry must use renewed Photo Ticket'
  );

  assert(
    ui.state.photoTicket ===
      'renewed-photo-ticket',
    'renewed Photo Ticket must replace old runtime ticket'
  );

  assert(
    renewedSession &&
      renewedSession.actor &&
      renewedSession.actor.staffKey ===
        'bridge-staff',
    'retried request must return normal Photo Bridge response'
  );

  console.log(
    'Photo LIFF upload + ticket renewal contract passed'
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
