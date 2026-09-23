'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fail(message) {
  throw new Error(message);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(
    path.join(root, 'web/admin/js/api.js'),
    'utf8'
  );

  let fetchImpl = null;
  let timerId = 0;

  const storage = new Map();

  const sessionStorage = {
    getItem(key) {
      return storage.has(key)
        ? storage.get(key)
        : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };

  class FakeAbortController {
    constructor() {
      this.signal = {
        aborted: false,
      };
    }

    abort() {
      this.signal.aborted = true;
    }
  }

  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail =
        options && options.detail;
    }
  }

  const dispatchedEvents = [];

  const context = vm.createContext({
    console,

    sessionStorage,

    window: {
      dispatchEvent(event) {
        dispatchedEvents.push(event);
        return true;
      },
    },

    CustomEvent: FakeCustomEvent,

    liff: {
      isLoggedIn() {
        return false;
      },
      getAccessToken() {
        return '';
      },
    },

    AbortController:
      FakeAbortController,

    setTimeout(callback, delay) {
      timerId += 1;

      // Retry backoff 250/500 ms should complete
      // deterministically in this contract.
      //
      // The production 20 s abort timer must remain
      // dormant in this harness.
      if (Number(delay) <= 1000) {
        callback();
      }

      return timerId;
    },

    clearTimeout() {},

    fetch(...args) {
      if (!fetchImpl) {
        throw new Error(
          'test fetch implementation not configured'
        );
      }

      return fetchImpl(...args);
    },
  });

  vm.runInContext(
    source +
      '\n' +
      'globalThis.__adminUiTest = {' +
      ' AdminAPI: AdminAPI,' +
      ' ADMIN_CONFIG: ADMIN_CONFIG' +
      ' };',
    context,
    {
      filename: 'web/admin/js/api.js',
    }
  );

  const api =
    context.__adminUiTest.AdminAPI;

  const failures = [];

  function response(status, data) {
    return {
      ok:
        status >= 200 &&
        status <= 299,

      status,

      async json() {
        return data;
      },
    };
  }

  function check(
    condition,
    message
  ) {
    if (!condition) {
      failures.push(message);
    }
  }

  // --------------------------------------------------------
  // P03A-01
  // Safe ADMIN read:
  // network failure twice -> success on attempt 3.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error(
          'simulated network failure'
        );
      }

      return response(
        200,
        {
          ok: true,
          overview: {},
        }
      );
    };

    let result = null;
    let caught = null;

    try {
      result =
        await api.call(
          'get_overview'
        );
    } catch (err) {
      caught = err;
    }

    check(
      !caught,
      'safe read network recovery should succeed; error=' +
        String(
          caught &&
          caught.message
        )
    );

    check(
      attempts === 3,
      'safe read network recovery must use exactly 3 attempts; attempts=' +
        attempts
    );

    check(
      !!result &&
        result.ok === true,
      'safe read network recovery must return successful data'
    );
  }

  // --------------------------------------------------------
  // P03A-02
  // Permanent transient network failure:
  // bounded at exactly 3 attempts + typed error.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      throw new Error(
        'simulated permanent network failure'
      );
    };

    let caught = null;

    try {
      await api.call(
        'get_holidays'
      );
    } catch (err) {
      caught = err;
    }

    check(
      !!caught,
      'permanent safe-read network failure must throw'
    );

    check(
      attempts === 3,
      'permanent safe-read network failure must stop at 3 attempts; attempts=' +
        attempts
    );

    check(
      caught &&
        caught.code ===
          'NETWORK_ERROR',
      'network failure must preserve code NETWORK_ERROR; code=' +
        String(
          caught &&
          caught.code
        )
    );
  }

  // --------------------------------------------------------
  // P03A-03
  // HTTP 503 is transient for safe reads.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      if (attempts < 3) {
        return response(
          503,
          {
            ok: false,
            code:
              'UPSTREAM_ERROR',
            error:
              'temporary upstream failure',
          }
        );
      }

      return response(
        200,
        {
          ok: true,
          logs: [],
        }
      );
    };

    let caught = null;

    try {
      await api.call(
        'get_logs',
        {
          page: 1,
          pageSize: 20,
        }
      );
    } catch (err) {
      caught = err;
    }

    check(
      !caught,
      'safe read HTTP 503 recovery should succeed; error=' +
        String(
          caught &&
          caught.message
        )
    );

    check(
      attempts === 3,
      'safe read HTTP 503 recovery must use exactly 3 attempts; attempts=' +
        attempts
    );
  }

  // --------------------------------------------------------
  // P03A-04
  // Apps Script often responds HTTP 200 even when the
  // backend dependency failed. UPSTREAM_ERROR must therefore
  // be retryable for safe reads too.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      if (attempts < 3) {
        return response(
          200,
          {
            ok: false,
            code:
              'UPSTREAM_ERROR',
            error:
              'temporary backend failure',
          }
        );
      }

      return response(
        200,
        {
          ok: true,
          settings: {},
        }
      );
    };

    let caught = null;

    try {
      await api.call(
        'get_settings'
      );
    } catch (err) {
      caught = err;
    }

    check(
      !caught,
      'safe read UPSTREAM_ERROR recovery should succeed; error=' +
        String(
          caught &&
          caught.message
        )
    );

    check(
      attempts === 3,
      'safe read UPSTREAM_ERROR recovery must use exactly 3 attempts; attempts=' +
        attempts
    );
  }

  // --------------------------------------------------------
  // P03A-05
  // Main API safe read follows the same bounded policy.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error(
          'simulated main-api network failure'
        );
      }

      return response(
        200,
        {
          ok: true,
          leaves: [],
        }
      );
    };

    let caught = null;

    try {
      await api.callMain(
        'adminLeaveList'
      );
    } catch (err) {
      caught = err;
    }

    check(
      !caught,
      'main safe read network recovery should succeed; error=' +
        String(
          caught &&
          caught.message
        )
    );

    check(
      attempts === 3,
      'main safe read network recovery must use exactly 3 attempts; attempts=' +
        attempts
    );
  }

  // --------------------------------------------------------
  // P03A-06
  // ADMIN write MUST NOT auto-retry.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      throw new Error(
        'simulated write network failure'
      );
    };

    let caught = null;

    try {
      await api.call(
        'save_settings',
        {
          data: '{}',
        }
      );
    } catch (err) {
      caught = err;
    }

    check(
      !!caught,
      'write network failure must throw'
    );

    check(
      attempts === 1,
      'ADMIN write must remain exactly 1 attempt; attempts=' +
        attempts
    );

    check(
      caught &&
        caught.code ===
          'NETWORK_ERROR',
      'write transport error must preserve code NETWORK_ERROR; code=' +
        String(
          caught &&
          caught.code
        )
    );
  }

  // --------------------------------------------------------
  // P03A-07
  // Main write MUST NOT auto-retry either, even though
  // some write actions carry requestId/idempotency metadata.
  // --------------------------------------------------------
  {
    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      throw new Error(
        'simulated main write failure'
      );
    };

    let caught = null;

    try {
      await api.callMain(
        'adminAdjustLeave',
        {
          pageId: 'page-1',
          requestId:
            'request-1',
        }
      );
    } catch (err) {
      caught = err;
    }

    check(
      !!caught,
      'main write network failure must throw'
    );

    check(
      attempts === 1,
      'Main API write must remain exactly 1 attempt; attempts=' +
        attempts
    );
  }

  // --------------------------------------------------------
  // P03A-08
  // Auth rejection is not transient. Never retry it.
  // --------------------------------------------------------
  {
    sessionStorage.setItem(
      api.TOKEN_KEY,
      'admin-token'
    );

    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      return response(
        200,
        {
          ok: false,
          code:
            'UNAUTHORIZED',
          error:
            'unauthorized',
        }
      );
    };

    let caught = null;

    try {
      await api.call(
        'get_overview'
      );
    } catch (err) {
      caught = err;
    }

    check(
      !!caught,
      'UNAUTHORIZED read must throw'
    );

    check(
      attempts === 1,
      'UNAUTHORIZED must never auto-retry; attempts=' +
        attempts
    );
  }

  if (failures.length) {
    fail(
      'ADMIN-REL-P03A transport/retry contract failed: ' +
        failures.join('; ')
    );
  }

  // --------------------------------------------------------
  // ADMIN-REL-P04A
  // Route load failure must recover in-place.
  //
  // Contract:
  // - error card contains an explicit retry button
  // - retry renders the current route again
  // - no full-page reload / replace
  // - retry remains inside SPA render sequencing
  // --------------------------------------------------------
  {
    const appSource = fs.readFileSync(
      path.join(root, 'web/admin/js/app.js'),
      'utf8'
    );

    const routeFailures = [];
    let renderAttempts = 0;
    let toastCount = 0;
    let reloadCount = 0;
    let replaceCount = 0;

    const routeRoot = {
      _innerHTML: '',
      children: [],

      get innerHTML() {
        return this._innerHTML;
      },

      set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
      },

      appendChild(node) {
        this.children.push(node);
        return node;
      },
    };

    function fakeNode(tag, className, text) {
      return {
        tagName: String(tag || '').toUpperCase(),
        className: className || '',
        textContent: text || '',
        dataset: {},
        children: [],
        listeners: {},
        disabled: false,

        appendChild(child) {
          this.children.push(child);
          return child;
        },

        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },

        setAttribute(name, value) {
          this[name] = String(value);
        },

        removeAttribute(name) {
          delete this[name];
        },

        classList: {
          add() {},
          remove() {},
          contains() {
            return false;
          },
        },

        scrollIntoView() {},
      };
    }

    const navButton =
      fakeNode('button');

    navButton.dataset.route =
      'overview';

    const routeUi = {
      $(id) {
        if (id === 'view') {
          return routeRoot;
        }

        return fakeNode('div');
      },

      escapeHtml(value) {
        return String(
          value == null ? '' : value
        );
      },

      showToast() {
        toastCount += 1;
      },

      el(tag, className, text) {
        return fakeNode(
          tag,
          className,
          text
        );
      },

      setBusy() {},
    };

    const routeViews = {
      overview: {
        async render(rootElement, isStale) {
          renderAttempts += 1;

          if (isStale()) {
            throw new Error(
              'render unexpectedly stale'
            );
          }

          if (renderAttempts === 1) {
            throw new Error(
              'simulated route load failure'
            );
          }

          rootElement.innerHTML =
            '<div>RECOVERED</div>';
        },
      },
    };

    const routeContext =
      vm.createContext({
        console,

        AdminViews:
          routeViews,

        AdminAPI: {
          getToken() {
            return '';
          },
          getLineSession() {
            return false;
          },
          clearToken() {},
        },

        UI:
          routeUi,

        ADMIN_CONFIG: {
          ADMIN_LIFF_ID: '',
        },

        location: {
          hash: '#/overview',

          reload() {
            reloadCount += 1;
          },

          replace() {
            replaceCount += 1;
          },
        },

        window: {
          innerWidth: 1024,

          addEventListener() {},
        },

        document: {
          addEventListener() {},

          querySelectorAll(selector) {
            if (
              selector === '.nav-btn'
            ) {
              return [navButton];
            }

            return [];
          },
        },

        requestAnimationFrame(callback) {
          if (callback) callback();
          return 1;
        },

        setTimeout,
        clearTimeout,
      });

    vm.runInContext(
      appSource +
        '\n' +
        'globalThis.__adminAppTest = App;',
      routeContext,
      {
        filename:
          'web/admin/js/app.js',
      }
    );

    const app =
      routeContext.__adminAppTest;

    await app.renderRoute();

    function findRetryButton(nodes) {
      for (const node of nodes || []) {
        if (
          node &&
          node.dataset &&
          node.dataset.role ===
            'admin-route-retry'
        ) {
          return node;
        }

        const nested =
          findRetryButton(
            node &&
              node.children
          );

        if (nested) {
          return nested;
        }
      }

      return null;
    }

    const retryButton =
      findRetryButton(
        routeRoot.children
      );

    if (!retryButton) {
      routeFailures.push(
        'route error must render an inline retry button'
      );
    }

    if (
      retryButton &&
      typeof retryButton.listeners.click !==
        'function'
    ) {
      routeFailures.push(
        'inline retry button must have a click handler'
      );
    }

    if (
      renderAttempts !== 1
    ) {
      routeFailures.push(
        'initial failed route must render exactly once; attempts=' +
          renderAttempts
      );
    }

    if (
      retryButton &&
      typeof retryButton.listeners.click ===
        'function'
    ) {
      await retryButton.listeners.click();
    }

    if (
      renderAttempts !== 2
    ) {
      routeFailures.push(
        'retry must render the current route exactly once more; attempts=' +
          renderAttempts
      );
    }

    if (
      routeRoot.innerHTML.indexOf(
        'RECOVERED'
      ) === -1
    ) {
      routeFailures.push(
        'successful retry must replace the error state with route content'
      );
    }

    if (
      reloadCount !== 0 ||
      replaceCount !== 0
    ) {
      routeFailures.push(
        'route retry must stay inside the SPA; reload=' +
          reloadCount +
          ', replace=' +
          replaceCount
      );
    }

    if (
      toastCount !== 1
    ) {
      routeFailures.push(
        'initial route failure should emit exactly one error toast; count=' +
          toastCount
      );
    }

    if (routeFailures.length) {
      fail(
        'ADMIN-REL-P04A inline route recovery contract failed: ' +
          routeFailures.join('; ')
      );
    }
  }

  // --------------------------------------------------------
  // ADMIN-REL-P05A
  // Auth/config/upstream failures have different semantics.
  //
  // Only UNAUTHORIZED means the current credential is dead.
  // Config/outage/upstream failures must preserve the session.
  // Machine-readable backend codes must survive the wrapper.
  // --------------------------------------------------------
  {
    const authFailures = [];

    async function probeAuthFailure(options) {
      const {
        label,
        code,
        useMain,
        expectCleared,
        expectAuthEvent,
      } = options;

      sessionStorage.clear();
      dispatchedEvents.length = 0;

      api.setToken(
        'admin-token-' + label
      );

      let attempts = 0;

      fetchImpl = async () => {
        attempts += 1;

        return response(
          200,
          {
            ok: false,
            code,
            error:
              'simulated ' + code,
          }
        );
      };

      let caught = null;

      try {
        if (useMain) {
          await api.callMain(
            'adminLeaveList'
          );
        } else {
          await api.call(
            'get_overview'
          );
        }
      } catch (err) {
        caught = err;
      }

      if (!caught) {
        authFailures.push(
          label +
          ': failure response must throw'
        );
        return;
      }

      if (caught.code !== code) {
        authFailures.push(
          label +
          ': thrown error must preserve code ' +
          code +
          '; got=' +
          String(caught.code)
        );
      }

      const cleared =
        api.getToken() === '';

      if (cleared !== expectCleared) {
        authFailures.push(
          label +
          ': credential cleared expected=' +
          expectCleared +
          ', actual=' +
          cleared
        );
      }

      const authEvents =
        dispatchedEvents.filter(
          event =>
            event &&
            event.type ===
              'admin-auth-failed'
        );

      if (
        authEvents.length !==
        (expectAuthEvent ? 1 : 0)
      ) {
        authFailures.push(
          label +
          ': admin-auth-failed events expected=' +
          (expectAuthEvent ? 1 : 0) +
          ', actual=' +
          authEvents.length
        );
      }

      if (
        expectAuthEvent &&
        authEvents[0] &&
        (!authEvents[0].detail ||
          authEvents[0].detail.code !== code)
      ) {
        authFailures.push(
          label +
          ': auth-failed event must preserve backend code'
        );
      }

      // UNAUTHORIZED / UNCONFIGURED are non-transient.
      if (
        (
          code === 'UNAUTHORIZED' ||
          code === 'UNCONFIGURED'
        ) &&
        attempts !== 1
      ) {
        authFailures.push(
          label +
          ': non-transient auth/config failure must use 1 attempt; attempts=' +
          attempts
        );
      }

      // Transient read failures use the bounded read policy.
      if (
        (
          code === 'LINE_UNAVAILABLE' ||
          code === 'UPSTREAM_ERROR'
        ) &&
        attempts !== 3
      ) {
        authFailures.push(
          label +
          ': transient read failure must stop at 3 attempts; attempts=' +
          attempts
        );
      }
    }

    await probeAuthFailure({
      label:
        'admin-unauthorized',
      code:
        'UNAUTHORIZED',
      useMain:
        false,
      expectCleared:
        true,
      expectAuthEvent:
        true,
    });

    await probeAuthFailure({
      label:
        'admin-unconfigured',
      code:
        'UNCONFIGURED',
      useMain:
        false,
      expectCleared:
        false,
      expectAuthEvent:
        false,
    });

    await probeAuthFailure({
      label:
        'admin-line-unavailable',
      code:
        'LINE_UNAVAILABLE',
      useMain:
        false,
      expectCleared:
        false,
      expectAuthEvent:
        false,
    });

    await probeAuthFailure({
      label:
        'admin-upstream',
      code:
        'UPSTREAM_ERROR',
      useMain:
        false,
      expectCleared:
        false,
      expectAuthEvent:
        false,
    });

    await probeAuthFailure({
      label:
        'main-unauthorized',
      code:
        'UNAUTHORIZED',
      useMain:
        true,
      expectCleared:
        true,
      expectAuthEvent:
        true,
    });

    await probeAuthFailure({
      label:
        'main-unconfigured',
      code:
        'UNCONFIGURED',
      useMain:
        true,
      expectCleared:
        false,
      expectAuthEvent:
        false,
    });

    if (authFailures.length) {
      fail(
        'ADMIN-REL-P05A auth failure semantics contract failed: ' +
          authFailures.join('; ')
      );
    }
  }

  // --------------------------------------------------------
  // ADMIN-REL-P06A
  // Interaction/race recovery.
  //
  // 1) Returning to login must invalidate any route render
  //    that is still waiting on asynchronous work.
  //
  // 2) Expired LIFF credential inside LINE client must
  //    recover with reload without logging LIFF out first.
  // --------------------------------------------------------
  {
    const raceFailures = [];

    function makeClassList(initial) {
      const values = new Set(initial || []);

      return {
        add(...names) {
          names.forEach(name => values.add(name));
        },

        remove(...names) {
          names.forEach(name => values.delete(name));
        },

        contains(name) {
          return values.has(name);
        },
      };
    }

    function makeNode(initialClasses) {
      return {
        textContent: '',
        disabled: false,
        dataset: {},
        listeners: {},
        classList:
          makeClassList(initialClasses),

        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },

        setAttribute() {},
        removeAttribute() {},
        scrollIntoView() {},
      };
    }

    // ------------------------------------------------------
    // P06A-01
    // showLogin() must stale an in-flight route render.
    // ------------------------------------------------------
    {
      let releaseRender = null;
      let lateWriteCount = 0;
      let staleAfterLogin = null;

      const gate =
        new Promise(resolve => {
          releaseRender = resolve;
        });

      const viewRoot =
        makeNode();

      let viewHtml =
        '';

      Object.defineProperty(
        viewRoot,
        'innerHTML',
        {
          get() {
            return viewHtml;
          },

          set(value) {
            viewHtml = String(value);
          },
        }
      );

      const loginView =
        makeNode(['hidden']);

      const appShell =
        makeNode();

      const nav =
        makeNode();

      nav.dataset.route =
        'overview';

      const ui = {
        $(id) {
          if (id === 'view') {
            return viewRoot;
          }

          if (id === 'loginView') {
            return loginView;
          }

          if (id === 'appShell') {
            return appShell;
          }

          return makeNode();
        },

        escapeHtml(value) {
          return String(
            value == null ? '' : value
          );
        },

        showToast() {},

        el() {
          return makeNode();
        },

        setBusy() {},
      };

      const views = {
        overview: {
          async render(rootElement, isStale) {
            await gate;

            staleAfterLogin =
              isStale();

            if (isStale()) {
              return;
            }

            lateWriteCount += 1;

            rootElement.innerHTML =
              '<div>LATE_WRITE</div>';
          },
        },
      };

      const context =
        vm.createContext({
          console,

          AdminViews:
            views,

          AdminAPI: {
            getToken() {
              return '';
            },

            getLineSession() {
              return false;
            },

            clearToken() {},
          },

          UI:
            ui,

          ADMIN_CONFIG: {
            ADMIN_LIFF_ID: '',
          },

          location: {
            hash: '#/overview',
          },

          window: {
            innerWidth: 1024,

            addEventListener() {},
          },

          document: {
            addEventListener() {},

            querySelectorAll(selector) {
              if (
                selector === '.nav-btn'
              ) {
                return [nav];
              }

              return [];
            },
          },

          requestAnimationFrame(callback) {
            if (callback) callback();
            return 1;
          },

          setTimeout,
          clearTimeout,
        });

      vm.runInContext(
        fs.readFileSync(
          path.join(
            root,
            'web/admin/js/app.js'
          ),
          'utf8'
        ) +
          '\n' +
          'globalThis.__adminRaceApp = App;',
        context,
        {
          filename:
            'web/admin/js/app.js',
        }
      );

      const raceApp =
        context.__adminRaceApp;

      const pendingRender =
        raceApp.renderRoute();

      // Route is currently suspended inside its async render.
      // Authentication failure/logout moves the user to login.
      raceApp.showLogin(
        'เซสชันหมดอายุ'
      );

      releaseRender();

      await pendingRender;

      if (
        staleAfterLogin !== true
      ) {
        raceFailures.push(
          'showLogin must invalidate an in-flight route render'
        );
      }

      if (
        lateWriteCount !== 0
      ) {
        raceFailures.push(
          'a route that finishes after showLogin must not write DOM; writes=' +
            lateWriteCount
        );
      }

      if (
        !appShell.classList.contains(
          'hidden'
        )
      ) {
        raceFailures.push(
          'showLogin must keep the application shell hidden'
        );
      }

      if (
        loginView.classList.contains(
          'hidden'
        )
      ) {
        raceFailures.push(
          'showLogin must expose the login view'
        );
      }
    }

    // ------------------------------------------------------
    // P06A-02
    // Expired LIFF token inside LINE client:
    // reload without liff.logout().
    //
    // logout is appropriate for external-browser login
    // recovery, but inside LINE the page should reload and
    // let LIFF init obtain the refreshed session.
    // ------------------------------------------------------
    {
      let reloadCount = 0;
      let logoutCount = 0;
      let loginCount = 0;

      const loginBtn =
        makeNode();

      const loginError =
        makeNode(['hidden']);

      const loginNotice =
        makeNode(['hidden']);

      const ui = {
        $(id) {
          if (
            id === 'loginLineBtn'
          ) {
            return loginBtn;
          }

          if (
            id === 'loginError'
          ) {
            return loginError;
          }

          if (
            id === 'loginNotice'
          ) {
            return loginNotice;
          }

          return makeNode();
        },

        setBusy() {},
        showToast() {},
        escapeHtml(value) {
          return String(value);
        },

        el() {
          return makeNode();
        },
      };

      const unauthorized =
        new Error(
          'เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่'
        );

      unauthorized.code =
        'UNAUTHORIZED';

      const context =
        vm.createContext({
          console,

          AdminViews: {},

          AdminAPI: {
            getToken() {
              return '';
            },

            getLineSession() {
              return false;
            },

            clearToken() {},

            async loginLine() {
              throw unauthorized;
            },
          },

          UI:
            ui,

          ADMIN_CONFIG: {
            ADMIN_LIFF_ID:
              'test-admin-liff',
          },

          liff: {
            isLoggedIn() {
              return true;
            },

            getAccessToken() {
              return 'expired-token';
            },

            isInClient() {
              return true;
            },

            logout() {
              logoutCount += 1;
            },

            login() {
              loginCount += 1;
            },
          },

          location: {
            hash: '',

            reload() {
              reloadCount += 1;
            },
          },

          window: {
            innerWidth: 1024,

            addEventListener() {},
          },

          document: {
            addEventListener() {},

            querySelectorAll() {
              return [];
            },
          },

          requestAnimationFrame(callback) {
            if (callback) callback();
            return 1;
          },

          setTimeout,
          clearTimeout,
        });

      vm.runInContext(
        fs.readFileSync(
          path.join(
            root,
            'web/admin/js/app.js'
          ),
          'utf8'
        ) +
          '\n' +
          'globalThis.__adminLineRecoveryApp = App;',
        context,
        {
          filename:
            'web/admin/js/app.js',
        }
      );

      const lineApp =
        context.__adminLineRecoveryApp;

      // Keep this contract focused on recovery behavior,
      // not LIFF initialization.
      lineApp.ensureLiffReady_ =
        async function () {
          return true;
        };

      await lineApp.loginLine(false);

      if (
        reloadCount !== 1
      ) {
        raceFailures.push(
          'expired LINE-client session must reload exactly once; reload=' +
            reloadCount
        );
      }

      if (
        logoutCount !== 0
      ) {
        raceFailures.push(
          'LINE-client expired-session recovery must not call liff.logout before reload; logout=' +
            logoutCount
        );
      }

      if (
        loginCount !== 0
      ) {
        raceFailures.push(
          'LINE-client expired-session recovery must not call liff.login; login=' +
            loginCount
        );
      }
    }

    if (raceFailures.length) {
      fail(
        'ADMIN-REL-P06A interaction/race contract failed: ' +
          raceFailures.join('; ')
      );
    }
  }

  console.log(
    'PASS testAdminRuntimeReliability'
  );
}

run().catch(err => {
  console.error(
    'FAIL testAdminUi: ' +
      String(
        err &&
        (err.stack || err)
      )
  );

  process.exitCode = 1;
});
