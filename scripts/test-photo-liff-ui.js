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
    fetchCalls.length === 2,
    'boot must make exactly issuer + session requests'
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

  console.log(
    'Photo LIFF boot/auth contract passed'
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
