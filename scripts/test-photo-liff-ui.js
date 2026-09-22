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
    this.clickCalls = 0;
    this.focusCalls = 0;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.clickCalls += 1;
  }

  focus() {
    this.focusCalls += 1;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(
      this.attributes,
      name
    )
      ? this.attributes[name]
      : null;
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

    retryFailedFiles:
      typeof retryFailedFiles === 'function'
        ? retryFailedFiles
        : null,

    renderIdentity:
      typeof renderIdentity_ === 'function'
        ? renderIdentity_
        : null,

    setDestinationMode:
      typeof setDestinationMode_ === 'function'
        ? setDestinationMode_
        : null,

    setActivitySearchQuery:
      typeof setActivitySearchQuery_ === 'function'
        ? setActivitySearchQuery_
        : null,

    setCreateActivityOpen:
      typeof setCreateActivityOpen_ === 'function'
        ? setCreateActivityOpen_
        : null,

    renderCreateActivityPreview:
      typeof renderCreateActivityPreview_ === 'function'
        ? renderCreateActivityPreview_
        : null,

    addSelectedFiles:
      typeof addSelectedFiles_ === 'function'
        ? addSelectedFiles_
        : null,

    removeSelectedFile:
      typeof removeSelectedFile_ === 'function'
        ? removeSelectedFile_
        : null,

    renderSelectedFiles:
      typeof renderSelectedFiles_ === 'function'
        ? renderSelectedFiles_
        : null,

    prepareUploadQueue:
      typeof prepareUploadQueue_ === 'function'
        ? prepareUploadQueue_
        : null,

    renderUploadQueue:
      typeof renderUploadQueue_ === 'function'
        ? renderUploadQueue_
        : null,

    showRecoverableError:
      typeof showRecoverableError_ === 'function'
        ? showRecoverableError_
        : null,

    clearRecoverableError:
      typeof clearRecoverableError_ === 'function'
        ? clearRecoverableError_
        : null,

    friendlyTopicLabel:
      typeof friendlyTopicLabel_ === 'function'
        ? friendlyTopicLabel_
        : null,

    destinationDisplayLabel:
      typeof destinationDisplayLabel_ === 'function'
        ? destinationDisplayLabel_
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

  const objectUrlCalls = {
    created: [],
    revoked: [],
  };

  // Contract สำหรับ Photo Ticket หมดอายุ:
  // request แรกได้ 401 -> ขอ ticket ใหม่ -> retry เดิม 1 ครั้ง
  let renewalMode = 'off';

  // PHOTO-REL-P01-A runtime reliability probes.
  let runtimeReliabilityMode = 'off';
  let runtimeReliabilityAttempts = 0;

  const runtimeReliabilityCalls = {
    logout: 0,
    login: 0,
    reload: 0,
  };

  const runtimeBackoffDelays = [];

  // UX-P01 contract:
  // ระหว่าง batch จะจงใจเปลี่ยน state.destination
  // หลัง request แรก เพื่อพิสูจน์ว่า upload ต้องใช้
  // destination snapshot เดิมตลอดทั้ง batch
  let destinationMutationMode = 'off';

  // UX-P02 async-state probes
  let pauseUploadMode = false;
  let releasePausedUpload = null;

  let pauseActivitiesMode = false;
  let releasePausedActivities = null;

  let pauseCreateActivityMode = false;
  let releasePausedCreateActivity = null;

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
      reload() {
        runtimeReliabilityCalls.reload += 1;
      },

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

      logout() {
        runtimeReliabilityCalls.logout += 1;
      },

      login() {
        runtimeReliabilityCalls.login += 1;

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

    URL: {
      createObjectURL(file) {
        const value =
          'blob:photo-preview-' +
          String(
            objectUrlCalls.created.length +
            1
          );

        objectUrlCalls.created.push({
          file,
          url: value,
        });

        return value;
      },

      revokeObjectURL(value) {
        objectUrlCalls.revoked.push(
          String(value)
        );
      },
    },

    setTimeout(callback, delay) {
      const ms = Number(delay || 0);

      // Request watchdogs use 20,000 ms and must remain dormant
      // in this deterministic harness.
      //
      // Retry backoff uses short delays; record and resolve
      // them immediately so tests stay fast.
      if (
        ms > 0 &&
        ms < 20000
      ) {
        runtimeBackoffDelays.push(ms);

        if (
          typeof callback === 'function'
        ) {
          callback();
        }
      }

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

      // ------------------------------------------------------
      // PHOTO-REL-P01-A:
      // deterministic Apps Script / boot reliability probes
      // ------------------------------------------------------

      if (
        requestUrl ===
          'https://script.google.com/macros/s/test/exec' &&
        runtimeReliabilityMode ===
          'issuer-line-unavailable-once'
      ) {
        runtimeReliabilityAttempts += 1;

        if (runtimeReliabilityAttempts === 1) {
          return {
            ok: true,
            status: 200,

            async json() {
              return {
                ok: false,
                code: 'LINE_UNAVAILABLE',
                error:
                  'ระบบ LINE ขัดข้องชั่วคราว กรุณาลองอีกครั้ง',
              };
            },
          };
        }

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              ticket:
                'recovered-line-photo-ticket',
            };
          },
        };
      }

      if (
        requestUrl ===
          'https://script.google.com/macros/s/test/exec' &&
        runtimeReliabilityMode ===
          'issuer-network-fail-once'
      ) {
        runtimeReliabilityAttempts += 1;

        if (runtimeReliabilityAttempts === 1) {
          throw new Error(
            'simulated transient network failure'
          );
        }

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              ticket:
                'recovered-network-photo-ticket',
            };
          },
        };
      }

      if (
        requestUrl ===
          'https://script.google.com/macros/s/test/exec' &&
        runtimeReliabilityMode ===
          'issuer-line-unavailable-always'
      ) {
        runtimeReliabilityAttempts += 1;

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: false,
              code: 'LINE_UNAVAILABLE',
              error:
                'ระบบ LINE ขัดข้องชั่วคราว กรุณาลองอีกครั้ง',
            };
          },
        };
      }

      if (
        runtimeReliabilityMode ===
          'boot-success-reset'
      ) {
        if (
          requestUrl ===
            'https://script.google.com/macros/s/test/exec'
        ) {
          runtimeReliabilityAttempts += 1;

          return {
            ok: true,
            status: 200,

            async json() {
              return {
                ok: true,
                ticket:
                  'boot-recovery-photo-ticket',
              };
            },
          };
        }

        if (
          requestUrl ===
            'https://photo.example.test:8443/v1/session'
        ) {
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

        if (
          requestUrl ===
            'https://photo.example.test:8443/v1/topics'
        ) {
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
      }

      if (
        requestUrl ===
          'https://script.google.com/macros/s/test/exec' &&
        runtimeReliabilityMode ===
          'boot-auth-expired'
      ) {
        runtimeReliabilityAttempts += 1;

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: false,
              code: 'UNAUTHORIZED',
              error:
                'เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่',
            };
          },
        };
      }

      // UX-P02:
      // ------------------------------------------------------
      // PHOTO-REL-P02-A:
      // Photo Bridge transient-read recovery probes
      // ------------------------------------------------------

      if (
        runtimeReliabilityMode ===
          'bridge-session-network-fail-once' &&
        requestUrl ===
          'https://photo.example.test:8443/v1/session'
      ) {
        runtimeReliabilityAttempts += 1;

        if (runtimeReliabilityAttempts === 1) {
          throw new Error(
            'simulated Photo Bridge network failure'
          );
        }

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

      if (
        runtimeReliabilityMode ===
          'bridge-topics-503-once' &&
        requestUrl ===
          'https://photo.example.test:8443/v1/topics'
      ) {
        runtimeReliabilityAttempts += 1;

        if (runtimeReliabilityAttempts === 1) {
          return {
            ok: false,
            status: 503,

            async json() {
              return {
                ok: false,
                error:
                  'Photo Bridge temporarily unavailable',
              };
            },
          };
        }

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              topics: [],
            };
          },
        };
      }

      if (
        runtimeReliabilityMode ===
          'bridge-activities-503-always' &&
        requestUrl.includes(
          '/v1/activities?'
        )
      ) {
        runtimeReliabilityAttempts += 1;

        return {
          ok: false,
          status: 503,

          async json() {
            return {
              ok: false,
              error:
                'Photo Bridge temporarily unavailable',
            };
          },
        };
      }

      // Write request:
      // network failure must NOT trigger automatic retry.
      if (
        runtimeReliabilityMode ===
          'bridge-post-network-fail' &&
        requestUrl ===
          'https://photo.example.test:8443/v1/activities' &&
        String(
          options.method || 'GET'
        ).toUpperCase() === 'POST'
      ) {
        runtimeReliabilityAttempts += 1;

        throw new Error(
          'simulated write response loss'
        );
      }

      // delay activities response เพื่อพิสูจน์ loading state
      if (
        pauseActivitiesMode &&
        requestUrl.includes(
          '/v1/activities?'
        )
      ) {
        pauseActivitiesMode = false;

        await new Promise(resolve => {
          releasePausedActivities =
            resolve;
        });

        return {
          ok: true,
          status: 200,

          async json() {
            return {
              ok: true,
              activities: [
                {
                  name:
                    '2569-09-22_UI State Foundation',
                  path:
                    '80_งานกิจกรรมกลาง/2569/' +
                    '2569-09-22_UI State Foundation',
                },
              ],
            };
          },
        };
      }

      // UX-P02:
      // delay create response เพื่อพิสูจน์ creating state
      if (
        pauseCreateActivityMode &&
        requestUrl ===
          'https://photo.example.test:8443/v1/activities' &&
        String(
          options.method || 'GET'
        ).toUpperCase() === 'POST'
      ) {
        pauseCreateActivityMode = false;

        await new Promise(resolve => {
          releasePausedCreateActivity =
            resolve;
        });

        return {
          ok: true,
          status: 201,

          async json() {
            return {
              ok: true,
              created: true,

              activity: {
                name:
                  '2569-09-22_UI State Foundation',
                path:
                  '80_งานกิจกรรมกลาง/2569/' +
                  '2569-09-22_UI State Foundation',
              },
            };
          },
        };
      }

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

      // Generic create-activity response for later UX contracts.
      //
      // Baseline create test above intentionally keeps its original
      // positional response. P02 also has its own delayed one-shot probe.
      // Any later POST /v1/activities must remain deterministic instead
      // of falling through to the unexpected-network guard.
      if (
        requestUrl ===
          'https://photo.example.test:8443/v1/activities' &&
        String(
          options.method || 'GET'
        ).toUpperCase() === 'POST'
      ) {
        let body = {};

        try {
          body = JSON.parse(
            String(options.body || '{}')
          );
        } catch (err) {
          body = {};
        }

        const activityName =
          String(
            body.activityName || ''
          );

        const topic =
          String(
            body.topic || ''
          );

        const year =
          String(
            body.year || ''
          );

        return {
          ok: true,
          status: 201,

          async json() {
            return {
              ok: true,
              created: true,

              activity: {
                name:
                  activityName,

                path:
                  topic +
                  '/' +
                  year +
                  '/' +
                  activityName,
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

        // UX-P01 destination-snapshot probe:
        // หลัง request แรกถูกสร้างแล้ว จงใจเปลี่ยน
        // live destination ก่อน upload ไฟล์ถัดไป
        if (
          destinationMutationMode === 'after-first' &&
          filename === 'snapshot-first.jpg'
        ) {
          destinationMutationMode = 'done';

          const testUi =
            context.__photoUiTest;

          if (
            testUi &&
            testUi.state
          ) {
            testUi.state.destination = {
              type: 'organization',
              topic: '90_ภาพองค์กร',
              path: '90_ภาพองค์กร',
            };
          }
        }

        if (
          pauseUploadMode &&
          filename ===
            'state-pause.jpg'
        ) {
          pauseUploadMode = false;

          await new Promise(resolve => {
            releasePausedUpload =
              resolve;
          });
        }

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

  const uxP01RedFailures = [];
  const uxP02RedFailures = [];
  const uxP03RedFailures = [];
  const uxP04RedFailures = [];
  const uxP05RedFailures = [];
  const uxP06RedFailures = [];
  const uxP07RedFailures = [];
  const uxP08RedFailures = [];
  const uxP09RedFailures = [];

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

  // ---------- UX-P01: Destination snapshot ----------

  const snapshotActivity =
    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง';

  ui.state.destination = {
    type: 'activity',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activity: snapshotActivity,
    path:
      '80_งานกิจกรรมกลาง/2569/' +
      snapshotActivity,
  };

  destinationMutationMode =
    'after-first';

  const snapshotStart =
    fetchCalls.length;

  await ui.uploadFiles([
    {
      name: 'snapshot-first.jpg',
      size: 3,
      type: 'image/jpeg',
    },
    {
      name: 'snapshot-second.jpg',
      size: 3,
      type: 'image/jpeg',
    },
  ]);

  const snapshotCalls =
    fetchCalls.slice(snapshotStart);

  const snapshotDestinationOk =
    destinationMutationMode === 'done' &&
    snapshotCalls.length === 2 &&
    snapshotCalls.every(call => {
      if (
        !call.url.includes(
          '/v1/uploads?'
        )
      ) {
        return false;
      }

      const parsed =
        new URL(call.url);

      return (
        parsed.searchParams.get('topic') ===
          '80_งานกิจกรรมกลาง' &&
        parsed.searchParams.get('year') ===
          '2569' &&
        parsed.searchParams.get('activity') ===
          snapshotActivity
      );
    });

  if (!snapshotDestinationOk) {
    uxP01RedFailures.push(
      'destination snapshot: every file in one batch must use the destination captured when the batch started'
    );
  }

  // ---------- UX-P01: Retry failed only ----------

  ui.state.destination = {
    type: 'activity',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activity: snapshotActivity,
    path:
      '80_งานกิจกรรมกลาง/2569/' +
      snapshotActivity,
  };

  const retryFiles = [
    {
      name: 'retry-ok-a.jpg',
      size: 3,
      type: 'image/jpeg',
    },
    {
      name: 'bad.jpg',
      size: 3,
      type: 'image/jpeg',
    },
    {
      name: 'retry-ok-c.jpg',
      size: 3,
      type: 'image/jpeg',
    },
  ];

  const retryBatchResults =
    await ui.uploadFiles(
      retryFiles
    );

  assert(
    retryBatchResults.length === 3 &&
      retryBatchResults[0].ok === true &&
      retryBatchResults[1].ok === false &&
      retryBatchResults[2].ok === true,
    'retry contract setup must produce success/failure/success'
  );

  let retryFailedOnlyOk =
    Array.isArray(
      ui.state.failedFiles
    ) &&
    ui.state.failedFiles.length === 1 &&
    ui.state.failedFiles[0] ===
      retryFiles[1] &&
    typeof ui.retryFailedFiles ===
      'function';

  if (retryFailedOnlyOk) {
    const retryStart =
      fetchCalls.length;

    await ui.retryFailedFiles();

    const retryCalls =
      fetchCalls.slice(retryStart);

    retryFailedOnlyOk =
      retryCalls.length === 1 &&
      new URL(
        retryCalls[0].url
      ).searchParams.get(
        'filename'
      ) === 'bad.jpg' &&
      retryCalls[0].rawBody ===
        retryFiles[1];
  }

  if (!retryFailedOnlyOk) {
    uxP01RedFailures.push(
      'retry failed only: successful files must leave the pending queue and retry must resend only failed files'
    );
  }

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

  assert(
    uxP01RedFailures.length === 0,
    'UX-P01 RED contracts failed:\n- ' +
      uxP01RedFailures.join('\n- ')
  );

  // ---------- UX-P02: Initial UI state ----------

  const initialUiStateOk =
    Array.isArray(
      ui.state.selectedFiles
    ) &&
    ui.state.selectedFiles.length === 0 &&
    ui.state.uploading === false &&
    ui.state.activitiesLoading === false &&
    ui.state.creatingActivity === false;

  if (!initialUiStateOk) {
    uxP02RedFailures.push(
      'initial state: selectedFiles must start empty and async flags must start false'
    );
  }

  // ---------- UX-P02: selectedFiles ----------

  const photoInput =
    elements.get('photoInput');

  const selectedFileA = {
    name: 'selected-a.jpg',
    size: 3,
    type: 'image/jpeg',
  };

  const selectedFileB = {
    name: 'selected-b.jpg',
    size: 4,
    type: 'image/jpeg',
  };

  if (photoInput) {
    photoInput.files = [
      selectedFileA,
      selectedFileB,
    ];

    const changeListener =
      photoInput.listeners.change;

    if (
      typeof changeListener ===
        'function'
    ) {
      await Promise.resolve(
        changeListener({
          target: photoInput,
        })
      );
    }
  }

  const selectedFilesOk =
    Array.isArray(
      ui.state.selectedFiles
    ) &&
    ui.state.selectedFiles.length === 2 &&
    ui.state.selectedFiles[0] ===
      selectedFileA &&
    ui.state.selectedFiles[1] ===
      selectedFileB;

  if (!selectedFilesOk) {
    uxP02RedFailures.push(
      'selectedFiles: file-input change must copy the selected File objects into runtime state'
    );
  }

  // ---------- UX-P02: uploading ----------

  const stateActivity =
    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง';

  ui.state.destination = {
    type: 'activity',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activity: stateActivity,
    path:
      '80_งานกิจกรรมกลาง/2569/' +
      stateActivity,
  };

  pauseUploadMode = true;
  releasePausedUpload = null;

  const pausedUploadPromise =
    ui.uploadFiles([
      {
        name: 'state-pause.jpg',
        size: 3,
        type: 'image/jpeg',
      },
    ]);

  const uploadingDuring =
    ui.state.uploading === true;

  assert(
    typeof releasePausedUpload ===
      'function',
    'UX-P02 upload pause probe did not activate'
  );

  releasePausedUpload();

  await pausedUploadPromise;

  const uploadingAfter =
    ui.state.uploading === false;

  if (
    !uploadingDuring ||
    !uploadingAfter
  ) {
    uxP02RedFailures.push(
      'uploading: must be true while a batch is active and false after it settles'
    );
  }

  // ---------- UX-P02: activitiesLoading ----------

  ui.state.selectedTopic =
    ui.state.topics.find(
      item =>
        item &&
        item.name ===
          '80_งานกิจกรรมกลาง'
    );

  pauseActivitiesMode = true;
  releasePausedActivities = null;

  const pausedActivitiesPromise =
    ui.selectYear('2569');

  const activitiesLoadingDuring =
    ui.state.activitiesLoading ===
      true;

  assert(
    typeof releasePausedActivities ===
      'function',
    'UX-P02 activities pause probe did not activate'
  );

  releasePausedActivities();

  await pausedActivitiesPromise;

  const activitiesLoadingAfter =
    ui.state.activitiesLoading ===
      false;

  if (
    !activitiesLoadingDuring ||
    !activitiesLoadingAfter
  ) {
    uxP02RedFailures.push(
      'activitiesLoading: must be true while activities are loading and false after completion'
    );
  }

  // ---------- UX-P02: creatingActivity ----------

  ui.state.selectedTopic =
    ui.state.topics.find(
      item =>
        item &&
        item.name ===
          '80_งานกิจกรรมกลาง'
    );

  ui.state.selectedYear =
    '2569';

  pauseCreateActivityMode = true;
  releasePausedCreateActivity = null;

  const pausedCreatePromise =
    ui.createActivity(
      '2026-09-22',
      'UI State Foundation'
    );

  const creatingDuring =
    ui.state.creatingActivity ===
      true;

  assert(
    typeof releasePausedCreateActivity ===
      'function',
    'UX-P02 create-activity pause probe did not activate'
  );

  releasePausedCreateActivity();

  await pausedCreatePromise;

  const creatingAfter =
    ui.state.creatingActivity ===
      false;

  if (
    !creatingDuring ||
    !creatingAfter
  ) {
    uxP02RedFailures.push(
      'creatingActivity: must be true while create is active and false after completion'
    );
  }

  assert(
    uxP02RedFailures.length === 0,
    'UX-P02 RED contracts failed:\n- ' +
      uxP02RedFailures.join('\n- ')
  );

  // ---------- UX-P03: Compact app shell ----------

  const compactHeaderOk =
    /<h1[^>]*>[\s\n]*คลังภาพ สสอ\.สอง[\s\n]*<\/h1>/s.test(
      html
    ) &&
    html.includes(
      'อัปโหลดและจัดเก็บภาพกิจกรรม'
    );

  if (!compactHeaderOk) {
    uxP03RedFailures.push(
      'app shell: header must use "คลังภาพ สสอ.สอง" with the compact upload description'
    );
  }

  // success banner + large access-status card
  // ต้องไม่กินพื้นที่หลักอีกต่อไป
  const legacyIdentityUiGone =
    !html.includes(
      'ยืนยันตัวตนสำเร็จ พร้อมใช้งานคลังภาพ'
    ) &&
    !html.includes(
      'สถานะการเข้าใช้งาน'
    );

  if (!legacyIdentityUiGone) {
    uxP03RedFailures.push(
      'app shell: legacy success banner and full access-status card must be removed'
    );
  }

  // ---------- UX-P03: Compact identity ----------

  const compactIdentityMarkupOk =
    html.includes(
      'id="identityDisclosure"'
    ) &&
    html.includes(
      'id="actorStaff"'
    ) &&
    html.includes(
      'id="actorRole"'
    ) &&
    typeof ui.renderIdentity ===
      'function';

  if (!compactIdentityMarkupOk) {
    uxP03RedFailures.push(
      'identity: compact disclosure and renderIdentity() contract must exist'
    );
  }

  if (
    typeof ui.renderIdentity ===
      'function'
  ) {
    const actorRole =
      elements.get('actorRole');

    const identityDisclosure =
      elements.get(
        'identityDisclosure'
      );

    // normal user:
    // identity detail available via disclosure,
    // role badge must not occupy primary UI
    ui.state.actor = {
      staffKey: 'normal-user',
      role: 'user',
    };

    ui.renderIdentity();

    const normalUserIdentityOk =
      actorRole &&
      actorRole.classList.contains(
        'hidden'
      ) &&
      identityDisclosure &&
      !identityDisclosure.classList.contains(
        'hidden'
      );

    if (!normalUserIdentityOk) {
      uxP03RedFailures.push(
        'identity: normal user must hide the role badge while keeping identity disclosure available'
      );
    }

    // manager/admin อาจมี compact role badge
    ui.state.actor = {
      staffKey: 'manager-user',
      role: 'manager',
    };

    ui.renderIdentity();

    const managerIdentityOk =
      actorRole &&
      !actorRole.classList.contains(
        'hidden'
      ) &&
      actorRole.textContent ===
        'ผู้จัดการคลังภาพ';

    if (!managerIdentityOk) {
      uxP03RedFailures.push(
        'identity: manager must receive the compact manager role badge'
      );
    }

    ui.state.actor = {
      staffKey: 'admin-user',
      role: 'admin',
    };

    ui.renderIdentity();

    const adminIdentityOk =
      actorRole &&
      !actorRole.classList.contains(
        'hidden'
      ) &&
      actorRole.textContent ===
        'ผู้ดูแลระบบ';

    if (!adminIdentityOk) {
      uxP03RedFailures.push(
        'identity: admin must receive the compact admin role badge'
      );
    }
  }

  // ---------- UX-P03: Safe area ----------

  const safeAreaOk =
    html.includes(
      'env(safe-area-inset-top)'
    ) &&
    html.includes(
      'env(safe-area-inset-bottom)'
    );

  if (!safeAreaOk) {
    uxP03RedFailures.push(
      'safe area: app shell must account for both top and bottom device safe-area insets'
    );
  }

  assert(
    uxP03RedFailures.length === 0,
    'UX-P03 RED contracts failed:\n- ' +
      uxP03RedFailures.join('\n- ')
  );

  // ---------- UX-P04: Destination modes ----------

  const modeMarkupOk =
    html.includes(
      'id="destinationModeActivity"'
    ) &&
    html.includes(
      'id="destinationModeOrganization"'
    ) &&
    html.includes(
      'id="activityDestinationFields"'
    ) &&
    typeof ui.setDestinationMode ===
      'function';

  if (!modeMarkupOk) {
    uxP04RedFailures.push(
      'destination mode: explicit Activity/Organization controls and setDestinationMode() must exist'
    );
  }

  const initialModeOk =
    ui.state.mode === 'activity';

  if (!initialModeOk) {
    uxP04RedFailures.push(
      'destination mode: initial mode must be activity'
    );
  }

  // Activity category selector must contain only
  // normal activity topics — organization is its own mode.
  const topicSelect =
    elements.get('topicSelect');

  const activityTopicsOnly =
    topicSelect &&
    !String(
      topicSelect.innerHTML || ''
    ).includes(
      '90_ภาพองค์กร'
    );

  if (!activityTopicsOnly) {
    uxP04RedFailures.push(
      'destination mode: organization must not appear as an activity category option'
    );
  }

  // ---------- UX-P04: Organization mode ----------

  if (
    typeof ui.setDestinationMode ===
      'function'
  ) {
    await Promise.resolve(
      ui.setDestinationMode(
        'organization'
      )
    );

    const activityFields =
      elements.get(
        'activityDestinationFields'
      );

    const destinationSummary =
      elements.get(
        'destinationSummary'
      );

    const destinationLabel =
      elements.get(
        'destinationLabel'
      );

    const organizationStateOk =
      ui.state.mode ===
        'organization' &&
      ui.state.selectedTopic &&
      ui.state.selectedTopic.type ===
        'organization' &&
      ui.state.selectedTopic.name ===
        '90_ภาพองค์กร' &&
      ui.state.destination &&
      ui.state.destination.type ===
        'organization' &&
      ui.state.destination.topic ===
        '90_ภาพองค์กร' &&
      ui.state.destination.path ===
        '90_ภาพองค์กร';

    if (!organizationStateOk) {
      uxP04RedFailures.push(
        'organization mode: must resolve directly to canonical 90_ภาพองค์กร destination'
      );
    }

    const organizationUiOk =
      activityFields &&
      activityFields.classList.contains(
        'hidden'
      ) &&
      destinationSummary &&
      !destinationSummary.classList.contains(
        'hidden'
      );

    if (!organizationUiOk) {
      uxP04RedFailures.push(
        'organization mode: activity-only controls must be hidden and destination confirmation shown'
      );
    }

    const organizationSummary =
      destinationLabel
        ? String(
            destinationLabel.textContent ||
            ''
          ).trim()
        : '';

    const friendlyOrganizationSummaryOk =
      organizationSummary ===
        'ภาพองค์กร' &&
      !organizationSummary.includes(
        '/'
      ) &&
      organizationSummary !==
        ui.state.destination.path;

    if (!friendlyOrganizationSummaryOk) {
      uxP04RedFailures.push(
        'destination summary: organization must display friendly "ภาพองค์กร" instead of canonical path'
      );
    }

    // ---------- UX-P04: Back to Activity ----------

    await Promise.resolve(
      ui.setDestinationMode(
        'activity'
      )
    );

    const activityModeOk =
      ui.state.mode === 'activity' &&
      ui.state.destination === null &&
      ui.state.selectedTopic === null &&
      activityFields &&
      !activityFields.classList.contains(
        'hidden'
      );

    if (!activityModeOk) {
      uxP04RedFailures.push(
        'activity mode: switching from organization must clear the old destination and reveal activity controls'
      );
    }

    const summaryHiddenAgain =
      destinationSummary &&
      destinationSummary.classList.contains(
        'hidden'
      );

    if (!summaryHiddenAgain) {
      uxP04RedFailures.push(
        'destination summary: must hide again when activity mode has no confirmed destination'
      );
    }
  }

  assert(
    uxP04RedFailures.length === 0,
    'UX-P04 RED contracts failed:\n- ' +
      uxP04RedFailures.join('\n- ')
  );

  // ---------- UX-P05: Activity discovery ----------

  const discoveryMarkupOk =
    html.includes(
      'id="activitySearchInput"'
    ) &&
    html.includes(
      'id="activityDiscoveryList"'
    ) &&
    typeof ui.setActivitySearchQuery ===
      'function';

  if (!discoveryMarkupOk) {
    uxP05RedFailures.push(
      'activity discovery: search input, discovery list, and client-side search action must exist'
    );
  }

  const initialSearchStateOk =
    ui.state.activitySearchQuery === '';

  if (!initialSearchStateOk) {
    uxP05RedFailures.push(
      'activity discovery: search query must start empty'
    );
  }

  // Behavior contracts run once the discovery action exists.
  if (
    typeof ui.setActivitySearchQuery ===
      'function'
  ) {
    const discoveryList =
      elements.get(
        'activityDiscoveryList'
      );

    ui.state.mode = 'activity';

    ui.state.activities = [
      {
        name:
          '2569-08-28_อบรมการใช้งานระบบ',
        path:
          '80_งานกิจกรรมกลาง/2569/' +
          '2569-08-28_อบรมการใช้งานระบบ',
      },
      {
        name:
          '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
        path:
          '80_งานกิจกรรมกลาง/2569/' +
          '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
      },
      {
        name:
          '2569-09-20_ประชุมประจำเดือน',
        path:
          '80_งานกิจกรรมกลาง/2569/' +
          '2569-09-20_ประชุมประจำเดือน',
      },
    ];

    const recentFetchStart =
      fetchCalls.length;

    const recentActivities =
      ui.setActivitySearchQuery('');

    const recentFetchEnd =
      fetchCalls.length;

    const recentHtml =
      discoveryList
        ? String(
            discoveryList.innerHTML ||
            ''
          )
        : '';

    const recentListOk =
      Array.isArray(
        recentActivities
      ) &&
      recentActivities.length === 3 &&
      recentActivities[0].name ===
        '2569-09-20_ประชุมประจำเดือน' &&
      recentActivities[1].name ===
        '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง' &&
      recentFetchEnd ===
        recentFetchStart;

    if (!recentListOk) {
      uxP05RedFailures.push(
        'activity discovery: empty search must show recent activities newest-first without calling the backend'
      );
    }

    const friendlyRecentUiOk =
      recentHtml.includes(
        'ประชุมประจำเดือน'
      ) &&
      recentHtml.includes(
        'ออกหน่วยรับบริจาคโลหิตอำเภอสอง'
      ) &&
      (
        recentHtml.includes(
          'min-h-11'
        ) ||
        recentHtml.includes(
          'min-h-[44px]'
        )
      ) &&
      !/>[^<]*2569-09-20_/.test(
        recentHtml
      );

    if (!friendlyRecentUiOk) {
      uxP05RedFailures.push(
        'activity discovery: recent activity rows must use friendly labels and touch targets of about 44px'
      );
    }

    const searchFetchStart =
      fetchCalls.length;

    const filteredActivities =
      ui.setActivitySearchQuery(
        'บริจาค'
      );

    const searchFetchEnd =
      fetchCalls.length;

    const filteredHtml =
      discoveryList
        ? String(
            discoveryList.innerHTML ||
            ''
          )
        : '';

    const clientFilterOk =
      ui.state.activitySearchQuery ===
        'บริจาค' &&
      Array.isArray(
        filteredActivities
      ) &&
      filteredActivities.length === 1 &&
      filteredActivities[0].name ===
        '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง' &&
      filteredHtml.includes(
        'ออกหน่วยรับบริจาคโลหิตอำเภอสอง'
      ) &&
      !filteredHtml.includes(
        'ประชุมประจำเดือน'
      ) &&
      searchFetchEnd ===
        searchFetchStart;

    if (!clientFilterOk) {
      uxP05RedFailures.push(
        'activity discovery: search must filter state.activities client-side and must not introduce a backend search request'
      );
    }

    const noResultActivities =
      ui.setActivitySearchQuery(
        'ไม่มีกิจกรรมนี้'
      );

    const noResultHtml =
      discoveryList
        ? String(
            discoveryList.innerHTML ||
            ''
          )
        : '';

    const emptyStateOk =
      Array.isArray(
        noResultActivities
      ) &&
      noResultActivities.length === 0 &&
      noResultHtml.includes(
        'ไม่พบกิจกรรม'
      );

    if (!emptyStateOk) {
      uxP05RedFailures.push(
        'activity discovery: unmatched search must preserve context with an inline empty state'
      );
    }
  }

  assert(
    uxP05RedFailures.length === 0,
    'UX-P05 RED contracts failed:\n- ' +
      uxP05RedFailures.join('\n- ')
  );

  // ---------- UX-P06: Create Activity v2 ----------

  const createV2MarkupOk =
    html.includes(
      'id="createActivityToggle"'
    ) &&
    html.includes(
      'id="createActivityForm"'
    ) &&
    html.includes(
      'id="activityNamePreview"'
    ) &&
    html.includes(
      'id="cancelCreateActivityButton"'
    ) &&
    typeof ui.setCreateActivityOpen ===
      'function' &&
    typeof ui.renderCreateActivityPreview ===
      'function';

  if (!createV2MarkupOk) {
    uxP06RedFailures.push(
      'create activity: collapsible form, canonical preview, cancel action, and UI helpers must exist'
    );
  }

  const initialCreateStateOk =
    ui.state.createActivityOpen === false;

  if (!initialCreateStateOk) {
    uxP06RedFailures.push(
      'create activity: form must start collapsed'
    );
  }

  // Behavior checks activate once the P06 helpers exist.
  if (
    typeof ui.setCreateActivityOpen ===
      'function' &&
    typeof ui.renderCreateActivityPreview ===
      'function'
  ) {
    const toggle =
      elements.get(
        'createActivityToggle'
      );

    const form =
      elements.get(
        'createActivityForm'
      );

    const dateInput =
      elements.get(
        'activityDate'
      );

    const nameInput =
      elements.get(
        'activityNameInput'
      );

    const preview =
      document.getElementById(
        'activityNamePreview'
      );

    ui.setCreateActivityOpen(true);

    const openedOk =
      ui.state.createActivityOpen ===
        true &&
      form &&
      !form.classList.contains(
        'hidden'
      );

    if (!openedOk) {
      uxP06RedFailures.push(
        'create activity: opening must reveal the secondary form'
      );
    }

    if (toggle) {
      const expanded =
        typeof toggle.getAttribute ===
          'function'
          ? toggle.getAttribute(
              'aria-expanded'
            )
          : null;

      if (expanded !== 'true') {
        uxP06RedFailures.push(
          'create activity: toggle must expose aria-expanded state'
        );
      }
    }

    // Canonical preview must use the same naming contract
    // as createActivity().
    if (dateInput) {
      dateInput.value =
        '2026-09-22';
    }

    if (nameInput) {
      nameInput.value =
        'UI State Foundation';
    }

    const previewValue =
      ui.renderCreateActivityPreview();

    const previewOk =
      previewValue ===
        '2569-09-22_UI State Foundation' &&
      preview &&
      String(
        preview.textContent || ''
      ).includes(
        '2569-09-22_UI State Foundation'
      );

    if (!previewOk) {
      uxP06RedFailures.push(
        'create activity: preview must show the canonical activity name before creation'
      );
    }

    // Cancel collapses without creating anything.
    const beforeCancelFetches =
      fetchCalls.length;

    ui.setCreateActivityOpen(false);

    const cancelOk =
      ui.state.createActivityOpen ===
        false &&
      form &&
      form.classList.contains(
        'hidden'
      ) &&
      fetchCalls.length ===
        beforeCancelFetches;

    if (!cancelOk) {
      uxP06RedFailures.push(
        'create activity: cancel must collapse the form without an API request'
      );
    }

    // Create + select + collapse + focus back to discovery.
    ui.state.mode = 'activity';

    ui.state.selectedTopic =
      ui.state.topics.find(
        item =>
          item &&
          item.name ===
            '80_งานกิจกรรมกลาง'
      );

    ui.state.selectedYear =
      '2569';

    ui.setCreateActivityOpen(true);

    let discoveryFocusCount = 0;

    const searchInput =
      elements.get(
        'activitySearchInput'
      );

    if (searchInput) {
      searchInput.focus = () => {
        discoveryFocusCount += 1;
      };
    }

    const created =
      await ui.createActivity(
        '2026-09-22',
        'UI State Foundation'
      );

    const createAndSelectOk =
      created &&
      ui.state.selectedActivity &&
      ui.state.selectedActivity.name ===
        created.name &&
      ui.state.destination &&
      ui.state.destination.type ===
        'activity' &&
      ui.state.destination.activity ===
        created.name &&
      ui.state.createActivityOpen ===
        false &&
      form &&
      form.classList.contains(
        'hidden'
      ) &&
      discoveryFocusCount === 1;

    if (!createAndSelectOk) {
      uxP06RedFailures.push(
        'create activity: successful creation must auto-select, collapse the form, and return focus to activity discovery'
      );
    }
  }

  assert(
    uxP06RedFailures.length === 0,
    'UX-P06 RED contracts failed:\n- ' +
      uxP06RedFailures.join('\n- ')
  );

  // ---------- UX-P07: Photo Picker v2 ----------

  const pickerMarkupOk =
    html.includes(
      'id="photoPickerButton"'
    ) &&
    html.includes(
      'id="selectedPhotoSummary"'
    ) &&
    html.includes(
      'id="selectedPhotoList"'
    ) &&
    html.includes(
      'id="addMorePhotosButton"'
    );

  const pickerHelpersOk =
    typeof ui.addSelectedFiles ===
      'function' &&
    typeof ui.removeSelectedFile ===
      'function' &&
    typeof ui.renderSelectedFiles ===
      'function';

  if (
    !pickerMarkupOk ||
    !pickerHelpersOk
  ) {
    uxP07RedFailures.push(
      'photo picker: custom picker, selected-file summary/list, add-more action, and picker helpers must exist'
    );
  }

  const selectedFilesStartEmpty =
    Array.isArray(
      ui.state.selectedFiles
    ) &&
    ui.state.selectedFiles.length === 0;

  if (!selectedFilesStartEmpty) {
    uxP07RedFailures.push(
      'photo picker: selected files must start empty'
    );
  }

  // P07 behavior checks activate once all helpers exist.
  if (pickerHelpersOk) {
    const photoInput =
      document.getElementById(
        'photoInput'
      );

    const pickerButton =
      document.getElementById(
        'photoPickerButton'
      );

    const addMoreButton =
      document.getElementById(
        'addMorePhotosButton'
      );

    const summary =
      document.getElementById(
        'selectedPhotoSummary'
      );

    const list =
      document.getElementById(
        'selectedPhotoList'
      );

    // Primary picker and "add more" must both reopen
    // the same native multiple-file chooser.
    const beforePickerClicks =
      photoInput.clickCalls;

    if (
      pickerButton &&
      pickerButton.listeners &&
      typeof pickerButton.listeners.click ===
        'function'
    ) {
      pickerButton.listeners.click({
        preventDefault() {},
      });
    }

    if (
      addMoreButton &&
      addMoreButton.listeners &&
      typeof addMoreButton.listeners.click ===
        'function'
    ) {
      addMoreButton.listeners.click({
        preventDefault() {},
      });
    }

    const pickerActionsOk =
      photoInput.clickCalls ===
        beforePickerClicks + 2;

    if (!pickerActionsOk) {
      uxP07RedFailures.push(
        'photo picker: primary and add-more actions must reopen the native file chooser'
      );
    }

    const jpegFile = {
      name: 'photo.jpg',
      size: 1024 * 1024,
      type: 'image/jpeg',
    };

    const heicFile = {
      name: 'iphone.heic',
      size: 2 * 1024 * 1024,
      type: 'image/heic',
    };

    const avifFile = {
      name: 'camera.avif',
      size: 2 * 1024 * 1024,
      type: 'image/avif',
    };

    ui.state.selectedFiles = [];

    objectUrlCalls.created.length = 0;
    objectUrlCalls.revoked.length = 0;

    ui.addSelectedFiles([
      jpegFile,
      heicFile,
      avifFile,
    ]);

    const selectedHtml =
      String(
        list.innerHTML || ''
      );

    const summaryText =
      String(
        summary.textContent || ''
      );

    const selectionSummaryOk =
      ui.state.selectedFiles.length === 3 &&
      summaryText.includes(
        '3 รูป'
      ) &&
      /5(?:\.0)?\s*MB/i.test(
        summaryText
      );

    if (!selectionSummaryOk) {
      uxP07RedFailures.push(
        'photo picker: selected-file summary must show file count and total size'
      );
    }

    const thumbnailAndFallbackOk =
      objectUrlCalls.created.length === 1 &&
      objectUrlCalls.created[0].file ===
        jpegFile &&
      selectedHtml.includes(
        'photo.jpg'
      ) &&
      selectedHtml.includes(
        'iphone.heic'
      ) &&
      selectedHtml.includes(
        'camera.avif'
      ) &&
      selectedHtml.includes(
        objectUrlCalls.created[0].url
      );

    if (!thumbnailAndFallbackOk) {
      uxP07RedFailures.push(
        'photo picker: previewable images need thumbnails while HEIC/AVIF remain visible with fallback UI'
      );
    }

    const jpegPreviewUrl =
      objectUrlCalls.created.length
        ? objectUrlCalls.created[0].url
        : '';

    ui.removeSelectedFile(0);

    const removeOk =
      ui.state.selectedFiles.length === 2 &&
      !ui.state.selectedFiles.some(
        file =>
          file &&
          file.name ===
            'photo.jpg'
      ) &&
      (
        !jpegPreviewUrl ||
        objectUrlCalls.revoked.includes(
          jpegPreviewUrl
        )
      );

    if (!removeOk) {
      uxP07RedFailures.push(
        'photo picker: removing a file must update selectedFiles and revoke its object URL'
      );
    }

    const pngFile = {
      name: 'more.png',
      size: 1024,
      type: 'image/png',
    };

    ui.addSelectedFiles([
      pngFile,
    ]);

    const addMoreOk =
      ui.state.selectedFiles.length === 3 &&
      ui.state.selectedFiles[0] ===
        heicFile &&
      ui.state.selectedFiles[1] ===
        avifFile &&
      ui.state.selectedFiles[2] ===
        pngFile;

    if (!addMoreOk) {
      uxP07RedFailures.push(
        'photo picker: selecting more files must append instead of replacing the existing selection'
      );
    }

    const conversionApiUsed =
      source.includes(
        'toDataURL('
      ) ||
      source.includes(
        'convertToBlob('
      ) ||
      source.includes(
        'OffscreenCanvas'
      );

    if (conversionApiUsed) {
      uxP07RedFailures.push(
        'photo picker: HEIC/AVIF fallback must not convert image files in the browser'
      );
    }
  }

  assert(
    uxP07RedFailures.length === 0,
    'UX-P07 RED contracts failed:\n- ' +
      uxP07RedFailures.join('\n- ')
  );

  // ---------- UX-P08: Upload queue & confidence ----------

  const uploadQueueMarkupOk =
    html.includes(
      'id="uploadProgress"'
    ) &&
    html.includes(
      'id="uploadQueue"'
    ) &&
    html.includes(
      'id="retryFailedButton"'
    );

  const uploadQueueHelpersOk =
    typeof ui.prepareUploadQueue ===
      'function' &&
    typeof ui.renderUploadQueue ===
      'function';

  if (
    !uploadQueueMarkupOk ||
    !uploadQueueHelpersOk
  ) {
    uxP08RedFailures.push(
      'upload queue: progress, file-level queue, explicit retry action, and queue helpers must exist'
    );
  }

  const initialQueueOk =
    Array.isArray(
      ui.state.uploadQueue
    ) &&
    ui.state.uploadQueue.length === 0;

  if (!initialQueueOk) {
    uxP08RedFailures.push(
      'upload queue: queue must start empty'
    );
  }

  if (uploadQueueHelpersOk) {
    const queueFiles = [
      {
        name: 'one.jpg',
        size: 100,
        type: 'image/jpeg',
      },
      {
        name: 'two.jpg',
        size: 200,
        type: 'image/jpeg',
      },
      {
        name: 'three.jpg',
        size: 300,
        type: 'image/jpeg',
      },
    ];

    ui.prepareUploadQueue(
      queueFiles
    );

    const progress =
      document.getElementById(
        'uploadProgress'
      );

    const queue =
      document.getElementById(
        'uploadQueue'
      );

    const retryButton =
      document.getElementById(
        'retryFailedButton'
      );

    const queueUploadButton =
      document.getElementById(
        'uploadButton'
      );

    const initialQueueStateOk =
      ui.state.uploadQueue.length === 3 &&
      ui.state.uploadQueue.every(
        item =>
          item &&
          item.status === 'pending'
      );

    if (!initialQueueStateOk) {
      uxP08RedFailures.push(
        'upload queue: preparing a batch must create one pending queue item per file'
      );
    }

    ui.renderUploadQueue();

    const initialProgressText =
      String(
        progress.textContent || ''
      );

    const initialQueueHtml =
      String(
        queue.innerHTML || ''
      );

    const realProgressOk =
      initialProgressText.includes(
        '0/3'
      ) &&
      !initialProgressText.includes(
        '%'
      ) &&
      initialQueueHtml.includes(
        'one.jpg'
      ) &&
      initialQueueHtml.includes(
        'two.jpg'
      ) &&
      initialQueueHtml.includes(
        'three.jpg'
      );

    if (!realProgressOk) {
      uxP08RedFailures.push(
        'upload queue: progress must use completed/total file counts and show every queued filename without fake percentages'
      );
    }

    // Simulate one success, one failure, one still pending.
    ui.state.uploadQueue[0].status =
      'success';

    ui.state.uploadQueue[1].status =
      'failed';

    ui.state.uploadQueue[1].error =
      'ชื่อไฟล์ซ้ำ';

    ui.renderUploadQueue();

    const mixedProgressText =
      String(
        progress.textContent || ''
      );

    const mixedQueueHtml =
      String(
        queue.innerHTML || ''
      );

    const fileStatusOk =
      mixedProgressText.includes(
        '2/3'
      ) &&
      mixedQueueHtml.includes(
        'สำเร็จ'
      ) &&
      mixedQueueHtml.includes(
        'ไม่สำเร็จ'
      ) &&
      mixedQueueHtml.includes(
        'ชื่อไฟล์ซ้ำ'
      );

    if (!fileStatusOk) {
      uxP08RedFailures.push(
        'upload queue: each file must expose pending/success/failed state and progress must count completed files'
      );
    }

    // Retry must not become actionable while the
    // current sequential batch is still running.
    ui.state.uploading = true;
    ui.renderUploadQueue();

    const retryHiddenWhileUploading =
      retryButton &&
      retryButton.classList.contains(
        'hidden'
      ) &&
      queueUploadButton &&
      queueUploadButton.disabled === true;

    if (!retryHiddenWhileUploading) {
      uxP08RedFailures.push(
        'upload queue: retry action must remain hidden until the active batch has finished'
      );
    }

    ui.state.uploading = false;
    ui.renderUploadQueue();

    const retryVisibilityOk =
      retryButton &&
      !retryButton.classList.contains(
        'hidden'
      ) &&
      queueUploadButton &&
      queueUploadButton.disabled === true;

    if (!retryVisibilityOk) {
      uxP08RedFailures.push(
        'upload queue: failed batch must disable primary upload and expose the explicit retry-failed-only action'
      );
    }

    ui.state.uploadQueue[1].status =
      'success';

    ui.state.uploadQueue[2].status =
      'success';

    ui.renderUploadQueue();

    const completeProgressText =
      String(
        progress.textContent || ''
      );

    const retryHiddenWhenComplete =
      retryButton &&
      retryButton.classList.contains(
        'hidden'
      );

    if (
      !completeProgressText.includes(
        '3/3'
      ) ||
      !retryHiddenWhenComplete ||
      !queueUploadButton ||
      queueUploadButton.disabled !== false
    ) {
      uxP08RedFailures.push(
        'upload queue: completed batch must show total completion and hide retry when no failures remain'
      );
    }
  }

  assert(
    uxP08RedFailures.length === 0,
    'UX-P08 RED contracts failed:\n- ' +
      uxP08RedFailures.join('\n- ')
  );

  // ---------- UX-P09: Errors, recovery & accessibility ----------

  const recoverableErrorMarkupOk =
    html.includes(
      'id="recoverableError"'
    ) &&
    html.includes(
      'role="alert"'
    ) &&
    html.includes(
      'aria-live="assertive"'
    ) &&
    html.includes(
      'tabindex="-1"'
    );

  const recoverableErrorHelpersOk =
    typeof ui.showRecoverableError ===
      'function' &&
    typeof ui.clearRecoverableError ===
      'function';

  if (
    !recoverableErrorMarkupOk ||
    !recoverableErrorHelpersOk
  ) {
    uxP09RedFailures.push(
      'recoverable errors: inline accessible alert and recovery helpers must exist'
    );
  }

  if (recoverableErrorHelpersOk) {
    const recoverableError =
      document.getElementById(
        'recoverableError'
      );

    const preservedDestination = {
      type: 'activity',
      topic: '80_งานกิจกรรมกลาง',
      year: '2569',
      activity:
        '2569-09-22_P09 Recovery',
      path:
        '80_งานกิจกรรมกลาง/2569/' +
        '2569-09-22_P09 Recovery',
    };

    const preservedFile = {
      name: 'keep-context.jpg',
      size: 1234,
      type: 'image/jpeg',
    };

    const preservedQueueItem = {
      file: preservedFile,
      status: 'failed',
      error: 'ชื่อไฟล์ซ้ำ',
    };

    ui.state.destination =
      preservedDestination;

    ui.state.selectedFiles = [
      preservedFile,
    ];

    ui.state.uploadQueue = [
      preservedQueueItem,
    ];

    const focusBefore =
      recoverableError
        ? recoverableError.focusCalls
        : 0;

    ui.showRecoverableError(
      'อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง'
    );

    const inlineErrorOk =
      recoverableError &&
      !recoverableError.classList.contains(
        'hidden'
      ) &&
      String(
        recoverableError.textContent || ''
      ).includes(
        'อัปโหลดไม่สำเร็จ'
      ) &&
      recoverableError.focusCalls ===
        focusBefore + 1;

    if (!inlineErrorOk) {
      uxP09RedFailures.push(
        'recoverable errors: showing an inline error must reveal and focus the alert'
      );
    }

    const contextPreservedOk =
      ui.state.destination ===
        preservedDestination &&
      ui.state.selectedFiles.length === 1 &&
      ui.state.selectedFiles[0] ===
        preservedFile &&
      ui.state.uploadQueue.length === 1 &&
      ui.state.uploadQueue[0] ===
        preservedQueueItem;

    if (!contextPreservedOk) {
      uxP09RedFailures.push(
        'recoverable errors: destination, selected files, and upload queue context must be preserved'
      );
    }

    ui.clearRecoverableError();

    const clearErrorOk =
      recoverableError &&
      recoverableError.classList.contains(
        'hidden'
      ) &&
      String(
        recoverableError.textContent || ''
      ) === '';

    if (!clearErrorOk) {
      uxP09RedFailures.push(
        'recoverable errors: clearing the alert must hide it without resetting workflow state'
      );
    }

    const contextStillPreservedOk =
      ui.state.destination ===
        preservedDestination &&
      ui.state.selectedFiles[0] ===
        preservedFile &&
      ui.state.uploadQueue[0] ===
        preservedQueueItem;

    if (!contextStillPreservedOk) {
      uxP09RedFailures.push(
        'recoverable errors: clearing an error must not discard workflow context'
      );
    }
    // A successful new interaction must clear stale
    // recoverable feedback automatically.
    ui.showRecoverableError(
      'ข้อผิดพลาดเดิม'
    );

    const organizationButton =
      document.getElementById(
        'destinationModeOrganization'
      );

    const organizationClick =
      organizationButton &&
      organizationButton.listeners &&
      organizationButton.listeners.click;

    const selectedFilesBeforeRecovery =
      ui.state.selectedFiles.slice();

    const uploadQueueBeforeRecovery =
      ui.state.uploadQueue.slice();

    if (
      typeof organizationClick ===
        'function'
    ) {
      organizationClick();
    }

    const staleErrorRecoveredOk =
      recoverableError &&
      recoverableError.classList.contains(
        'hidden'
      ) &&
      String(
        recoverableError.textContent || ''
      ) === '' &&
      ui.state.selectedFiles.length ===
        selectedFilesBeforeRecovery.length &&
      ui.state.selectedFiles[0] ===
        selectedFilesBeforeRecovery[0] &&
      ui.state.uploadQueue.length ===
        uploadQueueBeforeRecovery.length &&
      ui.state.uploadQueue[0] ===
        uploadQueueBeforeRecovery[0];

    if (!staleErrorRecoveredOk) {
      uxP09RedFailures.push(
        'recoverable errors: a successful new interaction must clear stale feedback without discarding selected files or upload queue'
      );
    }

    // Clearing the current topic is also a successful
    // recovery interaction and must remove stale feedback.
    ui.showRecoverableError(
      'ข้อผิดพลาดเดิมหลังเลือกหัวข้อ'
    );

    const topicSelect =
      document.getElementById(
        'topicSelect'
      );

    const topicChange =
      topicSelect &&
      topicSelect.listeners &&
      topicSelect.listeners.change;

    const filesBeforeTopicClear =
      ui.state.selectedFiles.slice();

    const queueBeforeTopicClear =
      ui.state.uploadQueue.slice();

    if (
      typeof topicChange ===
        'function'
    ) {
      await topicChange({
        target: {
          value: '',
        },
      });
    }

    const topicClearRecoveryOk =
      recoverableError &&
      recoverableError.classList.contains(
        'hidden'
      ) &&
      String(
        recoverableError.textContent || ''
      ) === '' &&
      ui.state.selectedFiles.length ===
        filesBeforeTopicClear.length &&
      ui.state.selectedFiles[0] ===
        filesBeforeTopicClear[0] &&
      ui.state.uploadQueue.length ===
        queueBeforeTopicClear.length &&
      ui.state.uploadQueue[0] ===
        queueBeforeTopicClear[0];

    if (!topicClearRecoveryOk) {
      uxP09RedFailures.push(
        'recoverable errors: clearing the topic must clear stale feedback without discarding selected files or upload queue'
      );
    }
  }

  // Full-page error remains available for fatal boot/auth/session
  // failures, but routine recoverable operations must get their
  // own inline surface instead of replacing the whole app.
  const fatalSurfaceStillExists =
    html.includes(
      'id="view-error"'
    ) &&
    html.includes(
      'id="errorMessage"'
    ) &&
    html.includes(
      'id="retryButton"'
    ) &&
    source.includes(
      "show('error')"
    );

  if (!fatalSurfaceStillExists) {
    uxP09RedFailures.push(
      'fatal errors: the existing full-page error surface must remain available for unrecoverable initialization failures'
    );
  }

  assert(
    uxP09RedFailures.length === 0,
    'UX-P09 RED contracts failed:\n- ' +
      uxP09RedFailures.join('\n- ')
  );

  // ---------- PHOTO-REL-P01-A: Runtime recovery ----------

  const runtimeReliabilityFailures = [];

  // Transient LINE upstream failure must recover without
  // destroying the LIFF login/session.
  runtimeReliabilityMode =
    'issuer-line-unavailable-once';
  runtimeReliabilityAttempts = 0;

  runtimeReliabilityCalls.logout = 0;
  runtimeReliabilityCalls.login = 0;
  runtimeReliabilityCalls.reload = 0;

  let lineRecoveryTicket = null;
  let lineRecoveryError = null;

  try {
    lineRecoveryTicket =
      await ui.requestPhotoTicket();
  } catch (err) {
    lineRecoveryError = err;
  }

  if (
    lineRecoveryError ||
    lineRecoveryTicket !==
      'recovered-line-photo-ticket' ||
    runtimeReliabilityAttempts !== 2 ||
    runtimeReliabilityCalls.logout !== 0 ||
    runtimeReliabilityCalls.login !== 0 ||
    runtimeReliabilityCalls.reload !== 0
  ) {
    runtimeReliabilityFailures.push(
      'Photo Ticket: one LINE_UNAVAILABLE response must retry once and recover without logout/login/reload'
    );
  }

  // A one-shot network transport failure to Apps Script is
  // also transient and should recover automatically.
  runtimeReliabilityMode =
    'issuer-network-fail-once';
  runtimeReliabilityAttempts = 0;

  runtimeReliabilityCalls.logout = 0;
  runtimeReliabilityCalls.login = 0;
  runtimeReliabilityCalls.reload = 0;

  let networkRecoveryTicket = null;
  let networkRecoveryError = null;

  try {
    networkRecoveryTicket =
      await ui.requestPhotoTicket();
  } catch (err) {
    networkRecoveryError = err;
  }

  if (
    networkRecoveryError ||
    networkRecoveryTicket !==
      'recovered-network-photo-ticket' ||
    runtimeReliabilityAttempts !== 2 ||
    runtimeReliabilityCalls.logout !== 0 ||
    runtimeReliabilityCalls.login !== 0 ||
    runtimeReliabilityCalls.reload !== 0
  ) {
    runtimeReliabilityFailures.push(
      'Photo Ticket: one transient network failure must retry once and recover without resetting LIFF auth'
    );
  }

  // Retry must be bounded. When transient failure persists,
  // preserve the machine-readable server code so boot can
  // distinguish it from an expired authentication session.
  runtimeReliabilityMode =
    'issuer-line-unavailable-always';
  runtimeReliabilityAttempts = 0;

  let exhaustedTransientError = null;

  try {
    await ui.requestPhotoTicket();
  } catch (err) {
    exhaustedTransientError = err;
  }

  const exhaustedTransientOk =
    exhaustedTransientError &&
    exhaustedTransientError.code ===
      'LINE_UNAVAILABLE' &&
    runtimeReliabilityAttempts === 3;

  if (!exhaustedTransientOk) {
    runtimeReliabilityFailures.push(
      'Photo Ticket: persistent transient failure must stop after 3 total attempts and preserve code LINE_UNAVAILABLE'
    );
  }

  // A successful boot is proof that authentication recovered.
  // Old relogin-loop counters must not poison later retries.
  context.sessionStorage.setItem(
    'photoReloginAttempts',
    '2'
  );

  context.sessionStorage.setItem(
    'photoReloginSince',
    String(Date.now())
  );

  runtimeReliabilityMode =
    'boot-success-reset';
  runtimeReliabilityAttempts = 0;

  await ui.boot();

  if (
    context.sessionStorage.getItem(
      'photoReloginAttempts'
    ) !== null ||
    context.sessionStorage.getItem(
      'photoReloginSince'
    ) !== null
  ) {
    runtimeReliabilityFailures.push(
      'boot recovery: successful boot must clear photoReloginAttempts and photoReloginSince'
    );
  }

  // Genuine auth expiry inside the LINE LIFF client may
  // reload to obtain a fresh LIFF session, but must not
  // explicitly logout first.
  context.sessionStorage.removeItem(
    'photoReloginAttempts'
  );

  context.sessionStorage.removeItem(
    'photoReloginSince'
  );

  runtimeReliabilityMode =
    'boot-auth-expired';
  runtimeReliabilityAttempts = 0;

  runtimeReliabilityCalls.logout = 0;
  runtimeReliabilityCalls.login = 0;
  runtimeReliabilityCalls.reload = 0;

  await ui.boot();

  if (
    runtimeReliabilityCalls.reload !== 1 ||
    runtimeReliabilityCalls.logout !== 0 ||
    runtimeReliabilityCalls.login !== 0
  ) {
    runtimeReliabilityFailures.push(
      'LIFF auth recovery: expired session inside LINE must reload without calling liff.logout() or liff.login()'
    );
  }

  runtimeReliabilityMode = 'off';

  assert(
    runtimeReliabilityFailures.length === 0,
    'PHOTO-REL-P01-A RED contracts failed:\n- ' +
      runtimeReliabilityFailures.join('\n- ')
  );

  // ---------- PHOTO-REL-P02-A: Bridge GET recovery ----------

  const bridgeReliabilityFailures = [];

  ui.state.photoTicket =
    'bridge-reliability-ticket';

  // GET /v1/session:
  // transient network failure should recover.
  runtimeReliabilityMode =
    'bridge-session-network-fail-once';

  runtimeReliabilityAttempts = 0;

  let recoveredSession = null;
  let recoveredSessionError = null;

  try {
    recoveredSession =
      await ui.photoApi('/v1/session');
  } catch (err) {
    recoveredSessionError = err;
  }

  if (
    recoveredSessionError ||
    !recoveredSession ||
    !recoveredSession.actor ||
    recoveredSession.actor.staffKey !==
      'bridge-staff' ||
    runtimeReliabilityAttempts !== 2
  ) {
    bridgeReliabilityFailures.push(
      'Photo Bridge GET: /v1/session must retry one transient network failure and recover'
    );
  }

  // GET /v1/topics:
  // transient 503 should recover.
  runtimeReliabilityMode =
    'bridge-topics-503-once';

  runtimeReliabilityAttempts = 0;

  let recoveredTopics = null;
  let recoveredTopicsError = null;

  try {
    recoveredTopics =
      await ui.photoApi('/v1/topics');
  } catch (err) {
    recoveredTopicsError = err;
  }

  if (
    recoveredTopicsError ||
    !recoveredTopics ||
    !Array.isArray(
      recoveredTopics.topics
    ) ||
    runtimeReliabilityAttempts !== 2
  ) {
    bridgeReliabilityFailures.push(
      'Photo Bridge GET: /v1/topics must retry one HTTP 503 response and recover'
    );
  }

  // Persistent transient GET:
  // retry must stop after 3 total attempts.
  runtimeReliabilityMode =
    'bridge-activities-503-always';

  runtimeReliabilityAttempts = 0;

  let exhaustedBridgeError = null;

  try {
    await ui.photoApi(
      '/v1/activities?topic=' +
      encodeURIComponent(
        '80_งานกิจกรรมกลาง'
      ) +
      '&year=2569'
    );
  } catch (err) {
    exhaustedBridgeError = err;
  }

  if (
    !exhaustedBridgeError ||
    runtimeReliabilityAttempts !== 3
  ) {
    bridgeReliabilityFailures.push(
      'Photo Bridge GET: persistent transient failure must stop after 3 total attempts'
    );
  }

  // POST is deliberately NOT auto-retried.
  runtimeReliabilityMode =
    'bridge-post-network-fail';

  runtimeReliabilityAttempts = 0;

  let writeFailure = null;

  try {
    await ui.photoApi(
      '/v1/activities',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify({
          topic:
            '80_งานกิจกรรมกลาง',

          year: '2569',

          activityName:
            '2569-09-22_No Auto Retry',
        }),
      }
    );
  } catch (err) {
    writeFailure = err;
  }

  if (
    !writeFailure ||
    runtimeReliabilityAttempts !== 1
  ) {
    bridgeReliabilityFailures.push(
      'Photo Bridge write: POST requests must not be automatically retried after ambiguous network failure'
    );
  }

  runtimeReliabilityMode = 'off';

  assert(
    bridgeReliabilityFailures.length === 0,
    'PHOTO-REL-P02-A RED contracts failed:\n- ' +
      bridgeReliabilityFailures.join('\n- ')
  );

  // ---------- PHOTO-REL-P03: Retry-button recovery ----------

  const retryRecoveryFailures = [];

  const errorView =
    document.getElementById(
      'view-error'
    );

  const readyView =
    document.getElementById(
      'view-ready'
    );

  const retryConnectionButton =
    document.getElementById(
      'retryButton'
    );

  const retryConnection =
    retryConnectionButton &&
    retryConnectionButton.listeners
      ? retryConnectionButton.listeners.click
      : null;

  // First boot:
  // Apps Script remains transiently unavailable for all
  // bounded attempts. App may show the full boot error,
  // but must not destroy the LIFF login session.
  runtimeReliabilityMode =
    'issuer-line-unavailable-always';

  runtimeReliabilityAttempts = 0;

  runtimeReliabilityCalls.logout = 0;
  runtimeReliabilityCalls.login = 0;
  runtimeReliabilityCalls.reload = 0;

  await ui.boot();

  const firstBootFailedSafely =
    ui.state.ready === false &&
    errorView &&
    !errorView.classList.contains(
      'hidden'
    ) &&
    readyView &&
    readyView.classList.contains(
      'hidden'
    ) &&
    runtimeReliabilityAttempts === 3 &&
    runtimeReliabilityCalls.logout === 0 &&
    runtimeReliabilityCalls.login === 0 &&
    runtimeReliabilityCalls.reload === 0;

  if (!firstBootFailedSafely) {
    retryRecoveryFailures.push(
      'retry recovery: exhausted transient boot failure must show retryable error without logout/login/reload'
    );
  }

  if (
    typeof retryConnection !== 'function'
  ) {
    retryRecoveryFailures.push(
      'retry recovery: retryButton must remain wired to a recovery action'
    );
  }

  // Simulate the upstream becoming healthy before the user
  // presses "ลองเชื่อมอีกครั้ง".
  runtimeReliabilityMode =
    'boot-success-reset';

  runtimeReliabilityAttempts = 0;

  context.sessionStorage.setItem(
    'photoReloginAttempts',
    '2'
  );

  context.sessionStorage.setItem(
    'photoReloginSince',
    String(Date.now())
  );

  if (
    typeof retryConnection === 'function'
  ) {
    await retryConnection();
  }

  const retryRecovered =
    ui.state.ready === true &&
    readyView &&
    !readyView.classList.contains(
      'hidden'
    ) &&
    errorView &&
    errorView.classList.contains(
      'hidden'
    ) &&
    ui.state.actor &&
    ui.state.actor.staffKey ===
      'bridge-staff' &&
    Array.isArray(ui.state.topics) &&
    ui.state.topics.length === 2 &&
    runtimeReliabilityAttempts === 1 &&
    runtimeReliabilityCalls.logout === 0 &&
    runtimeReliabilityCalls.login === 0 &&
    runtimeReliabilityCalls.reload === 0 &&
    context.sessionStorage.getItem(
      'photoReloginAttempts'
    ) === null &&
    context.sessionStorage.getItem(
      'photoReloginSince'
    ) === null;

  if (!retryRecovered) {
    retryRecoveryFailures.push(
      'retry recovery: retryButton must recover from a transient boot failure without closing/reloading LIFF'
    );
  }

  runtimeReliabilityMode = 'off';

  assert(
    retryRecoveryFailures.length === 0,
    'PHOTO-REL-P03 recovery contracts failed:\n- ' +
      retryRecoveryFailures.join('\n- ')
  );

  // ---------- PHOTO-REL-P04-A: Retry backoff ----------

  const retryBackoffFailures = [];

  // Apps Script Photo Ticket transient failures:
  // 3 total attempts = 2 bounded delays.
  runtimeReliabilityMode =
    'issuer-line-unavailable-always';

  runtimeReliabilityAttempts = 0;
  runtimeBackoffDelays.length = 0;

  try {
    await ui.requestPhotoTicket();
  } catch (err) {
    // Persistent transient failure is expected here.
  }

  const issuerBackoffOk =
    runtimeReliabilityAttempts === 3 &&
    runtimeBackoffDelays.length === 2 &&
    runtimeBackoffDelays[0] === 250 &&
    runtimeBackoffDelays[1] === 500;

  if (!issuerBackoffOk) {
    retryBackoffFailures.push(
      'Photo Ticket retries must use bounded backoff of 250ms then 500ms'
    );
  }

  // Photo Bridge safe GET transient failures:
  // same bounded retry policy.
  ui.state.photoTicket =
    'bridge-reliability-ticket';

  runtimeReliabilityMode =
    'bridge-activities-503-always';

  runtimeReliabilityAttempts = 0;
  runtimeBackoffDelays.length = 0;

  try {
    await ui.photoApi(
      '/v1/activities?topic=' +
      encodeURIComponent(
        '80_งานกิจกรรมกลาง'
      ) +
      '&year=2569'
    );
  } catch (err) {
    // Persistent 503 is expected here.
  }

  const bridgeBackoffOk =
    runtimeReliabilityAttempts === 3 &&
    runtimeBackoffDelays.length === 2 &&
    runtimeBackoffDelays[0] === 250 &&
    runtimeBackoffDelays[1] === 500;

  if (!bridgeBackoffOk) {
    retryBackoffFailures.push(
      'Photo Bridge GET retries must use bounded backoff of 250ms then 500ms'
    );
  }

  // POST/write remains single-shot:
  // no retry and therefore no retry backoff.
  runtimeReliabilityMode =
    'bridge-post-network-fail';

  runtimeReliabilityAttempts = 0;
  runtimeBackoffDelays.length = 0;

  try {
    await ui.photoApi(
      '/v1/activities',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify({
          topic:
            '80_งานกิจกรรมกลาง',

          year: '2569',

          activityName:
            '2569-09-22_No Backoff',
        }),
      }
    );
  } catch (err) {
    // Expected ambiguous write failure.
  }

  if (
    runtimeReliabilityAttempts !== 1 ||
    runtimeBackoffDelays.length !== 0
  ) {
    retryBackoffFailures.push(
      'Photo Bridge POST must remain single-shot with no automatic retry backoff'
    );
  }

  runtimeReliabilityMode = 'off';
  runtimeBackoffDelays.length = 0;

  assert(
    retryBackoffFailures.length === 0,
    'PHOTO-REL-P04-A RED contracts failed:\n- ' +
      retryBackoffFailures.join('\n- ')
  );

  // ---------- UX-F01-A: Friendly category labels ----------

  const friendlyCategoryFailures = [];

  assert(
    typeof ui.friendlyTopicLabel === 'function',
    'UX-F01: friendlyTopicLabel_ test hook missing'
  );

  const friendlyTopicCases = [
    [
      '80_กิจกรรมกลาง',
      'กิจกรรมกลาง',
    ],
    [
      '80_งานกิจกรรมกลาง',
      'กิจกรรมกลาง',
    ],
    [
      '10_งานบริหาร',
      'งานบริหาร',
    ],
    [
      '90_ภาพองค์กร',
      'ภาพองค์กร',
    ],
  ];

  friendlyTopicCases.forEach(
    ([canonical, expected]) => {
      const actual =
        ui.friendlyTopicLabel(
          canonical
        );

      if (actual !== expected) {
        friendlyCategoryFailures.push(
          canonical +
          ' must display as "' +
          expected +
          '" but got "' +
          actual +
          '"'
        );
      }
    }
  );

  // Dropdown must preserve canonical value for API/state,
  // while rendering the friendly label to the user.
  const topicOptionUsesCanonicalValue =
    /option\.value\s*=\s*topic\.name\s*;/.test(
      source
    );

  const topicOptionUsesFriendlyLabel =
    /option\.textContent\s*=\s*friendlyTopicLabel_\(\s*topic\.name\s*\)\s*;/.test(
      source
    );

  if (!topicOptionUsesCanonicalValue) {
    friendlyCategoryFailures.push(
      'topic option value must remain canonical topic.name'
    );
  }

  if (!topicOptionUsesFriendlyLabel) {
    friendlyCategoryFailures.push(
      'topic dropdown must display friendlyTopicLabel_(topic.name)'
    );
  }

  assert(
    friendlyCategoryFailures.length === 0,
    'UX-F01-A RED contracts failed:\n- ' +
      friendlyCategoryFailures.join('\n- ')
  );

  // ---------- UX-F02-A: Contextual create activity ----------

  const contextualCreateFailures = [];

  const createActivityPanel =
    document.getElementById(
      'createActivityPanel'
    );

  const createPanelStartsHidden =
    /id="createActivityPanel"[\s\S]{0,160}class="[^"]*\bhidden\b/.test(
      html
    );

  if (!createPanelStartsHidden) {
    contextualCreateFailures.push(
      'create activity panel must start hidden before activity context is ready'
    );
  }

  ui.state.mode = 'activity';

  ui.state.selectedTopic = {
    type: 'topic',
    name: '80_งานกิจกรรมกลาง',
    path: '80_งานกิจกรรมกลาง',
  };

  ui.state.selectedYear = '2569';

  ui.state.activities = [
    {
      name:
        '2569-09-22_ประชุมประจำเดือน',
      path:
        '80_งานกิจกรรมกลาง/2569/2569-09-22_ประชุมประจำเดือน',
    },
    {
      name:
        '2569-09-20_อบรมเจ้าหน้าที่',
      path:
        '80_งานกิจกรรมกลาง/2569/2569-09-20_อบรมเจ้าหน้าที่',
    },
  ];

  ui.state.activitiesLoading = false;
  ui.state.createActivityOpen = false;

  // Existing activities + no search:
  // normal discovery should be primary UX.
  createActivityPanel.classList.add(
    'hidden'
  );

  ui.setActivitySearchQuery('');

  if (
    !createActivityPanel.classList.contains(
      'hidden'
    )
  ) {
    contextualCreateFailures.push(
      'create activity panel must stay hidden when activities already exist and search is empty'
    );
  }

  // Search with no result:
  // offer create as contextual fallback.
  createActivityPanel.classList.add(
    'hidden'
  );

  ui.setActivitySearchQuery(
    'กิจกรรมที่ไม่มีอยู่แน่นอน'
  );

  if (
    createActivityPanel.classList.contains(
      'hidden'
    )
  ) {
    contextualCreateFailures.push(
      'no-result activity search must reveal create activity panel'
    );
  }

  // If create form is already open and the search starts
  // matching an existing activity again, hide and close it.
  ui.setCreateActivityOpen(true);

  ui.setActivitySearchQuery(
    'ประชุม'
  );

  if (
    !createActivityPanel.classList.contains(
      'hidden'
    ) ||
    ui.state.createActivityOpen !== false
  ) {
    contextualCreateFailures.push(
      'matching search result must hide create panel and close its open form'
    );
  }

  // No activities in selected year:
  // create becomes the useful next action.
  ui.state.activities = [];
  ui.state.activitiesLoading = false;

  createActivityPanel.classList.add(
    'hidden'
  );

  ui.setActivitySearchQuery('');

  if (
    createActivityPanel.classList.contains(
      'hidden'
    )
  ) {
    contextualCreateFailures.push(
      'an empty selected year must reveal create activity panel'
    );
  }

  // While the year is still loading, do not flash the create
  // affordance before we know whether activities exist.
  ui.state.activitiesLoading = true;

  createActivityPanel.classList.add(
    'hidden'
  );

  ui.setActivitySearchQuery('');

  if (
    !createActivityPanel.classList.contains(
      'hidden'
    )
  ) {
    contextualCreateFailures.push(
      'create activity panel must remain hidden while activities are loading'
    );
  }

  assert(
    contextualCreateFailures.length === 0,
    'UX-F02-A RED contracts failed:\n- ' +
      contextualCreateFailures.join('\n- ')
  );

  // ---------- UX-F03-A: Destination breadcrumb ----------

  const destinationBreadcrumbFailures = [];

  assert(
    typeof ui.destinationDisplayLabel === 'function',
    'UX-F03: destinationDisplayLabel_ test hook missing'
  );

  const canonicalDestination = {
    type: 'activity',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activity:
      '2569-09-22_ประชุมประจำเดือน',
    path:
      '80_งานกิจกรรมกลาง/2569/2569-09-22_ประชุมประจำเดือน',
  };

  ui.state.destination =
    Object.assign(
      {},
      canonicalDestination
    );

  const activityBreadcrumb =
    ui.destinationDisplayLabel();

  const expectedBreadcrumb =
    'กิจกรรมกลาง / พ.ศ. 2569 / ประชุมประจำเดือน';

  if (
    activityBreadcrumb !==
      expectedBreadcrumb
  ) {
    destinationBreadcrumbFailures.push(
      'activity destination must display "' +
      expectedBreadcrumb +
      '" but got "' +
      activityBreadcrumb +
      '"'
    );
  }

  // Presentation must never mutate canonical routing data.
  [
    'topic',
    'year',
    'activity',
    'path',
  ].forEach(key => {
    if (
      ui.state.destination[key] !==
        canonicalDestination[key]
    ) {
      destinationBreadcrumbFailures.push(
        'destination display must not mutate canonical ' +
        key
      );
    }
  });

  ui.state.destination = {
    type: 'organization',
    topic: '90_ภาพองค์กร',
    path: '90_ภาพองค์กร',
  };

  if (
    ui.destinationDisplayLabel() !==
      'ภาพองค์กร'
  ) {
    destinationBreadcrumbFailures.push(
      'organization destination must remain "ภาพองค์กร"'
    );
  }

  assert(
    destinationBreadcrumbFailures.length === 0,
    'UX-F03-A RED contracts failed:\n- ' +
      destinationBreadcrumbFailures.join('\n- ')
  );

  // ---------- UX-F04-A: Accessible inline validation ----------

  const inlineValidationFailures = [];

  // Static accessibility surface:
  // error descriptions exist, but fields are not invalid
  // before the user attempts submission.
  const dateHasDescription =
    /id="activityDate"[\s\S]{0,260}aria-describedby="activityDateError"/.test(
      html
    );

  const nameHasDescription =
    /id="activityNameInput"[\s\S]{0,260}aria-describedby="activityNameError"/.test(
      html
    );

  const dateErrorExists =
    /id="activityDateError"[\s\S]{0,160}class="[^"]*\bhidden\b[^"]*text-danger/.test(
      html
    );

  const nameErrorExists =
    /id="activityNameError"[\s\S]{0,160}class="[^"]*\bhidden\b[^"]*text-danger/.test(
      html
    );

  if (!dateHasDescription) {
    inlineValidationFailures.push(
      'activity date must reference activityDateError with aria-describedby'
    );
  }

  if (!nameHasDescription) {
    inlineValidationFailures.push(
      'activity name must reference activityNameError with aria-describedby'
    );
  }

  if (!dateErrorExists) {
    inlineValidationFailures.push(
      'activityDateError must exist hidden initially'
    );
  }

  if (!nameErrorExists) {
    inlineValidationFailures.push(
      'activityNameError must exist hidden initially'
    );
  }

  const activityDateMarkup =
    html.match(
      /<input[\s\S]{0,500}?id="activityDate"[\s\S]{0,500}?>/
    );

  const activityNameMarkup =
    html.match(
      /<input[\s\S]{0,500}?id="activityNameInput"[\s\S]{0,500}?>/
    );

  if (
    activityDateMarkup &&
    /aria-invalid="true"/.test(
      activityDateMarkup[0]
    )
  ) {
    inlineValidationFailures.push(
      'activity date must not start aria-invalid=true'
    );
  }

  if (
    activityNameMarkup &&
    /aria-invalid="true"/.test(
      activityNameMarkup[0]
    )
  ) {
    inlineValidationFailures.push(
      'activity name must not start aria-invalid=true'
    );
  }

  const dateInput =
    document.getElementById(
      'activityDate'
    );

  const nameInput =
    document.getElementById(
      'activityNameInput'
    );

  const dateError =
    document.getElementById(
      'activityDateError'
    );

  const nameError =
    document.getElementById(
      'activityNameError'
    );

  const createButton =
    document.getElementById(
      'createActivityButton'
    );

  // Give createActivity() otherwise-valid destination context.
  ui.state.mode = 'activity';

  ui.state.selectedTopic = {
    type: 'topic',
    name: '80_งานกิจกรรมกลาง',
    path: '80_งานกิจกรรมกลาง',
  };

  ui.state.selectedYear = '2569';

  dateInput.value = '';
  nameInput.value = '';

  const createClick =
    createButton &&
    createButton.listeners
      ? createButton.listeners.click
      : null;

  assert(
    typeof createClick === 'function',
    'UX-F04: create activity click handler missing'
  );

  const activityPostCountBefore =
    fetchCalls.filter(
      call =>
        call.method === 'POST' &&
        call.url ===
          'https://photo.example.test:8443/v1/activities'
    ).length;

  await createClick();

  const activityPostCountAfter =
    fetchCalls.filter(
      call =>
        call.method === 'POST' &&
        call.url ===
          'https://photo.example.test:8443/v1/activities'
    ).length;

  if (
    activityPostCountAfter !==
      activityPostCountBefore
  ) {
    inlineValidationFailures.push(
      'invalid create form must not send POST /v1/activities'
    );
  }

  if (
    dateInput.getAttribute(
      'aria-invalid'
    ) !== 'true'
  ) {
    inlineValidationFailures.push(
      'missing activity date must set aria-invalid=true'
    );
  }

  if (
    nameInput.getAttribute(
      'aria-invalid'
    ) !== 'true'
  ) {
    inlineValidationFailures.push(
      'missing activity name must set aria-invalid=true'
    );
  }

  if (
    dateError.classList.contains(
      'hidden'
    ) ||
    dateError.textContent !==
      'กรุณาระบุวันที่กิจกรรม'
  ) {
    inlineValidationFailures.push(
      'missing activity date must show its inline error message'
    );
  }

  if (
    nameError.classList.contains(
      'hidden'
    ) ||
    nameError.textContent !==
      'กรุณาระบุชื่อกิจกรรม'
  ) {
    inlineValidationFailures.push(
      'missing activity name must show its inline error message'
    );
  }

  if (
    !dateInput.classList.contains(
      'border-red-300'
    ) ||
    !nameInput.classList.contains(
      'border-red-300'
    )
  ) {
    inlineValidationFailures.push(
      'invalid create fields must show a visible error border'
    );
  }

  // Correcting each field should clear that field's error
  // without requiring another submission.
  dateInput.value = '2026-09-22';

  if (
    dateInput.listeners &&
    typeof dateInput.listeners.input ===
      'function'
  ) {
    dateInput.listeners.input({
      target: dateInput,
    });
  }

  if (
    dateInput.getAttribute(
      'aria-invalid'
    ) === 'true' ||
    !dateError.classList.contains(
      'hidden'
    ) ||
    dateInput.classList.contains(
      'border-red-300'
    )
  ) {
    inlineValidationFailures.push(
      'correcting activity date must clear its inline validation state'
    );
  }

  nameInput.value =
    'ประชุมประจำเดือน';

  if (
    nameInput.listeners &&
    typeof nameInput.listeners.input ===
      'function'
  ) {
    nameInput.listeners.input({
      target: nameInput,
    });
  }

  if (
    nameInput.getAttribute(
      'aria-invalid'
    ) === 'true' ||
    !nameError.classList.contains(
      'hidden'
    ) ||
    nameInput.classList.contains(
      'border-red-300'
    )
  ) {
    inlineValidationFailures.push(
      'correcting activity name must clear its inline validation state'
    );
  }

  assert(
    inlineValidationFailures.length === 0,
    'UX-F04-A RED contracts failed:\n- ' +
      inlineValidationFailures.join('\n- ')
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
