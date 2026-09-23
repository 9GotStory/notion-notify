'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  focus() {}
  scrollIntoView() {}
  appendChild() {}
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'assertion failed');
  }
}

function okScheduleResponse(month) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      month,
      full: false,
      viewMonths: {
        back: -1,
        fwd: 6,
      },
      items: [],
      leaves: [],
    }),
  };
}

async function run() {
  const html = fs.readFileSync(
    path.resolve(
      __dirname,
      '../web/schedule/index.html'
    ),
    'utf8'
  );

  const scripts = [
    ...html.matchAll(
      /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
    ),
  ]
    .map(match => match[1])
    .filter(source =>
      source.includes("'use strict';")
    );

  assert(
    scripts.length === 1,
    'expected exactly one schedule runtime script'
  );

  let source = scripts[0];

  source = source.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  globalThis.__scheduleUiTest = {
    state: state,
    currentToken: currentToken,
    fetchMonth: fetchMonth,
    prefetchNeighbors: prefetchNeighbors,
    loadMonth: loadMonth,
    enrichCurrentMonth_: enrichCurrentMonth_,
    boot: boot,
  };
})();`
  );

  assert(
    source.includes('__scheduleUiTest'),
    'could not install schedule UI test hook'
  );

  const elements = new Map();

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(
          id,
          new FakeElement(id)
        );
      }

      return elements.get(id);
    },

    createElement(tag) {
      return new FakeElement(tag);
    },

    addEventListener() {},

    querySelectorAll() {
      return [];
    },
  };

  let fetchImpl = async () => {
    throw new Error(
      'fetch implementation not configured'
    );
  };

  const context = vm.createContext({
    console,

    document,

    window: {},

    location: {
      origin: 'https://example.test',
      pathname: '/schedule/',
      reload() {},
      replace() {},
    },

    CONFIG: {
      SCHEDULE_LIFF_ID: '',
      API_URL:
        'https://api.example.test/exec',
    },

    liff: {
      isLoggedIn: () => false,
      getAccessToken: () => '',
      isInClient: () => false,
      logout() {},
      login() {},
    },

    AbortController,

    Date,
    Intl,
    Math,
    JSON,
    Map,
    Set,

    clearTimeout() {},

    // Production retry backoff may use
    // 250/500 ms timers. Execute only short
    // timers deterministically; keep the
    // 20-second AbortController timeout dormant.
    setTimeout(fn, delay) {
      if (Number(delay) <= 1000) {
        Promise.resolve().then(fn);
      }

      return 1;
    },

    fetch(...args) {
      return fetchImpl(...args);
    },
  });

  context.globalThis = context;

  vm.runInContext(
    source,
    context,
    {
      filename:
        'schedule-inline.js',
    }
  );

  const ui =
    context.__scheduleUiTest;

  const failures = [];

  // --------------------------------------------------------
  // SCHED-REL-P10A:
  //
  // Initial calendar rendering is public-first.
  //
  // A configured LIFF application may be slow, cold, or
  // temporarily unavailable. The visible public schedule
  // request must therefore start without waiting for
  // liff.init() to resolve.
  //
  // Contract:
  // - boot starts LIFF initialization
  // - while LIFF init is still pending, the first schedule
  //   request has already started
  // - that first visible request is public and therefore
  //   contains no LINE accessToken
  // --------------------------------------------------------
  {
    const publicFirstFailures = [];

    const originalLiffId =
      context.CONFIG.SCHEDULE_LIFF_ID;

    const originalInit =
      context.liff.init;

    const originalIsLoggedIn =
      context.liff.isLoggedIn;

    const originalGetAccessToken =
      context.liff.getAccessToken;

    let resolveLiffInit = null;
    let liffInitCalls = 0;
    const requestBodies = [];

    context.CONFIG.SCHEDULE_LIFF_ID =
      'test-schedule-liff';

    context.liff.init = () => {
      liffInitCalls += 1;

      return new Promise(resolve => {
        resolveLiffInit = resolve;
      });
    };

    // P10A isolates boot ordering only.
    // Do not start authenticated enrichment when this test
    // releases LIFF during cleanup; P10C owns that behavior.
    context.liff.isLoggedIn =
      () => false;

    context.liff.getAccessToken =
      () => '';

    ui.state.liffReady = false;
    ui.state.deadToken = '';
    ui.state.cache = {};
    ui.state.viewMonths = null;
    ui.state.full = false;
    ui.state.viewer = '';
    ui.state.mine = false;

    fetchImpl = async (url, options) => {
      const body =
        JSON.parse(options.body);

      requestBodies.push(body);

      return okScheduleResponse(
        body.month
      );
    };

    let bootPromise = null;

    try {
      bootPromise = ui.boot();

      // Allow boot() and the first fetch microtasks to run,
      // but deliberately keep liff.init() unresolved.
      await Promise.resolve();
      await Promise.resolve();

      await new Promise(resolve => {
        setImmediate(resolve);
      });

      if (liffInitCalls !== 1) {
        publicFirstFailures.push(
          'boot must start LIFF initialization exactly once; calls=' +
            liffInitCalls
        );
      }

      if (requestBodies.length < 1) {
        publicFirstFailures.push(
          'initial public schedule request must start before LIFF init resolves; requests=' +
            requestBodies.length
        );
      } else if (
        Object.prototype.hasOwnProperty.call(
          requestBodies[0],
          'accessToken'
        )
      ) {
        publicFirstFailures.push(
          'first visible schedule request must be public and omit accessToken'
        );
      }
    } finally {
      // Release the old/current boot implementation so this
      // RED contract never leaves a pending promise behind.
      if (resolveLiffInit) {
        resolveLiffInit();
      }

      if (
        bootPromise &&
        typeof bootPromise.then === 'function'
      ) {
        try {
          await bootPromise;
        } catch (_) {
          // The assertions above own this contract.
        }
      }

      context.CONFIG.SCHEDULE_LIFF_ID =
        originalLiffId;

      if (originalInit === undefined) {
        delete context.liff.init;
      } else {
        context.liff.init =
          originalInit;
      }

      context.liff.isLoggedIn =
        originalIsLoggedIn;

      context.liff.getAccessToken =
        originalGetAccessToken;

      ui.state.liffReady = false;
      ui.state.deadToken = '';
      ui.state.cache = {};
      ui.state.viewMonths = null;
      ui.state.full = false;
      ui.state.viewer = '';
      ui.state.mine = false;
    }

    assert(
      publicFirstFailures.length === 0,
      'SCHED-REL-P10A public-first boot contract failed: ' +
        publicFirstFailures.join('; ')
    );
  }

  // --------------------------------------------------------
  // SCHED-REL-P10C:
  //
  // Once the public calendar is already visible, a successful
  // LIFF session should enrich the CURRENT month in background.
  //
  // Contract:
  // - public request/render completes first without accessToken
  // - LIFF readiness does not remove that public rendering
  // - after LIFF becomes ready, current month is fetched again
  //   with the fresh LINE accessToken
  // - successful enrichment upgrades state to full/staff mode
  // --------------------------------------------------------
  {
    const enrichmentFailures = [];

    const originalLiffId =
      context.CONFIG.SCHEDULE_LIFF_ID;

    const originalInit =
      context.liff.init;

    const originalIsLoggedIn =
      context.liff.isLoggedIn;

    const originalGetAccessToken =
      context.liff.getAccessToken;

    let resolveLiffInit = null;
    const requestBodies = [];

    context.CONFIG.SCHEDULE_LIFF_ID =
      'test-schedule-liff';

    context.liff.init = () =>
      new Promise(resolve => {
        resolveLiffInit = resolve;
      });

    context.liff.isLoggedIn =
      () => true;

    context.liff.getAccessToken =
      () => 'staff-enrichment-token';

    ui.state.liffReady = false;
    ui.state.deadToken = '';
    ui.state.cache = {};
    ui.state.viewMonths = null;
    ui.state.full = false;
    ui.state.viewer = '';
    ui.state.mine = false;

    fetchImpl = async (url, options) => {
      const body =
        JSON.parse(options.body);

      requestBodies.push(body);

      const isStaff =
        Object.prototype.hasOwnProperty.call(
          body,
          'accessToken'
        );

      return {
        ok: true,
        status: 200,

        json: async () => ({
          ok: true,
          month: body.month,
          full: isStaff,
          viewer:
            isStaff ? 'Tester' : '',
          viewMonths: {
            // Disable neighbor prefetch so this contract
            // observes only public + staff current-month reads.
            back: 0,
            fwd: 0,
          },
          items: [],
          leaves: [],
        }),
      };
    };

    let bootPromise = null;

    try {
      bootPromise = ui.boot();

      // Let the public request/render finish while LIFF stays
      // deliberately unresolved.
      await Promise.resolve();
      await Promise.resolve();

      await new Promise(resolve => {
        setImmediate(resolve);
      });

      const publicRequests =
        requestBodies.filter(body =>
          !Object.prototype.hasOwnProperty.call(
            body,
            'accessToken'
          )
        );

      if (publicRequests.length !== 1) {
        enrichmentFailures.push(
          'initial visible calendar must make exactly 1 public request before LIFF readiness; publicRequests=' +
            publicRequests.length +
            ', bodies=' +
            JSON.stringify(requestBodies)
        );
      }

      if (ui.state.full !== false) {
        enrichmentFailures.push(
          'calendar must still be public before LIFF readiness'
        );
      }

      const viewError =
        elements.get('viewError');

      if (
        viewError &&
        !viewError.classList.contains(
          'hidden'
        )
      ) {
        enrichmentFailures.push(
          'successful public render must not show the error state before enrichment'
        );
      }

      if (!resolveLiffInit) {
        enrichmentFailures.push(
          'LIFF init must have started in parallel'
        );
      } else {
        resolveLiffInit();

        if (
          bootPromise &&
          typeof bootPromise.then === 'function'
        ) {
          await bootPromise;
        }

        // Support background enrichment that is intentionally
        // not part of the visible public-load promise.
        await Promise.resolve();
        await Promise.resolve();

        await new Promise(resolve => {
          setImmediate(resolve);
        });
      }

      const staffRequests =
        requestBodies.filter(body =>
          body.accessToken ===
            'staff-enrichment-token'
        );

      if (staffRequests.length !== 1) {
        enrichmentFailures.push(
          'LIFF readiness must start exactly 1 staff enrichment request for the current month; staffRequests=' +
            staffRequests.length
        );
      }

      if (
        staffRequests.length === 1 &&
        publicRequests.length === 1 &&
        staffRequests[0].month !==
          publicRequests[0].month
      ) {
        enrichmentFailures.push(
          'staff enrichment must target the same current month as the initial public render'
        );
      }

      if (
        ui.state.full !== true ||
        ui.state.viewer !== 'Tester'
      ) {
        enrichmentFailures.push(
          'successful staff enrichment must upgrade the visible state; full=' +
            String(ui.state.full) +
            ', viewer=' +
            String(ui.state.viewer)
        );
      }
    } finally {
      if (resolveLiffInit) {
        // Safe even when already resolved.
        resolveLiffInit();
      }

      if (
        bootPromise &&
        typeof bootPromise.then === 'function'
      ) {
        try {
          await bootPromise;
        } catch (_) {
          // Assertions above own this contract.
        }
      }

      context.CONFIG.SCHEDULE_LIFF_ID =
        originalLiffId;

      if (originalInit === undefined) {
        delete context.liff.init;
      } else {
        context.liff.init =
          originalInit;
      }

      context.liff.isLoggedIn =
        originalIsLoggedIn;

      context.liff.getAccessToken =
        originalGetAccessToken;

      ui.state.liffReady = false;
      ui.state.deadToken = '';
      ui.state.cache = {};
      ui.state.viewMonths = null;
      ui.state.full = false;
      ui.state.viewer = '';
      ui.state.mine = false;
    }

    assert(
      enrichmentFailures.length === 0,
      'SCHED-REL-P10C staff enrichment contract failed: ' +
        enrichmentFailures.join('; ')
    );
  }

  // --------------------------------------------------------
  // SCHED-REL-P10D:
  //
  // Staff enrichment is asynchronous. A response belonging
  // to an OLD month must never mutate or render the month the
  // user is currently viewing.
  //
  // Scenario:
  //   September staff enrichment starts
  //   -> user moves to October
  //   -> September response arrives late
  //
  // Contract:
  // - the request may complete/cache normally
  // - but stale response must NOT change current full/viewer
  // - current month must remain October
  // --------------------------------------------------------
  {
    const staleFailures = [];

    const originalIsLoggedIn =
      context.liff.isLoggedIn;

    const originalGetAccessToken =
      context.liff.getAccessToken;

    let releaseFetch = null;
    let requestedBody = null;

    context.liff.isLoggedIn =
      () => true;

    context.liff.getAccessToken =
      () => 'stale-race-token';

    ui.state.liffReady = true;
    ui.state.deadToken = '';
    ui.state.cache = {};
    ui.state.viewMonths = {
      back: 0,
      fwd: 0,
    };
    ui.state.month = '2026-09';
    ui.state.full = false;
    ui.state.viewer = '';
    ui.state.mine = false;

    fetchImpl = async (url, options) => {
      requestedBody =
        JSON.parse(options.body);

      return new Promise(resolve => {
        releaseFetch = () => {
          resolve({
            ok: true,
            status: 200,

            json: async () => ({
              ok: true,
              month: '2026-09',
              full: true,
              viewer: 'September Tester',
              viewMonths: {
                back: 0,
                fwd: 0,
              },
              items: [],
              leaves: [],
            }),
          });
        };
      });
    };

    try {
      const pending =
        ui.enrichCurrentMonth_();

      // Allow fetchMonth() to reach the deferred fetch.
      await Promise.resolve();
      await Promise.resolve();

      if (!releaseFetch) {
        staleFailures.push(
          'staff enrichment must start its request before the race is simulated'
        );
      }

      if (
        !requestedBody ||
        requestedBody.month !== '2026-09' ||
        requestedBody.accessToken !==
          'stale-race-token'
      ) {
        staleFailures.push(
          'race setup must start authenticated September enrichment; body=' +
            JSON.stringify(requestedBody)
        );
      }

      // User navigates away while September enrichment is
      // still waiting on the backend.
      ui.state.month = '2026-10';

      // October is currently a public view. The late September
      // response must not promote this visible state to staff.
      ui.state.full = false;
      ui.state.viewer = '';

      if (releaseFetch) {
        releaseFetch();
      }

      await pending;

      if (
        ui.state.month !== '2026-10'
      ) {
        staleFailures.push(
          'late enrichment must never change the current month; month=' +
            String(ui.state.month)
        );
      }

      if (
        ui.state.full !== false ||
        ui.state.viewer !== ''
      ) {
        staleFailures.push(
          'late September enrichment must not mutate October mode state; full=' +
            String(ui.state.full) +
            ', viewer=' +
            String(ui.state.viewer)
        );
      }
    } finally {
      context.liff.isLoggedIn =
        originalIsLoggedIn;

      context.liff.getAccessToken =
        originalGetAccessToken;

      ui.state.liffReady = false;
      ui.state.deadToken = '';
      ui.state.cache = {};
      ui.state.viewMonths = null;
      ui.state.full = false;
      ui.state.viewer = '';
      ui.state.mine = false;
    }

    assert(
      staleFailures.length === 0,
      'SCHED-REL-P10D stale enrichment contract failed: ' +
        staleFailures.join('; ')
    );
  }

  // --------------------------------------------------------
  // SCHED-REL-P10D2:
  //
  // Cache mode must follow the RESPONSE visibility, not the
  // current LIFF state at the instant an async request ends.
  //
  // Otherwise:
  // - a public prefetch started before LIFF readiness can
  //   finish afterward and poison the _full cache
  // - a staff request that temporarily degrades to public
  //   (LINE_UNAVAILABLE, etc.) can be cached as _full and
  //   prevent later staff recovery
  // --------------------------------------------------------
  {
    const cacheRaceFailures = [];

    const originalIsLoggedIn =
      context.liff.isLoggedIn;

    const originalGetAccessToken =
      context.liff.getAccessToken;

    context.liff.isLoggedIn =
      () => true;

    context.liff.getAccessToken =
      () => 'cache-race-token';

    try {
      // ----------------------------------------------------
      // Case 1:
      // Public request starts before LIFF readiness and
      // completes after LIFF becomes ready.
      // It must remain in the _pub cache.
      // ----------------------------------------------------
      {
        ui.state.liffReady = false;
        ui.state.deadToken = '';
        ui.state.cache = {};

        let releaseFetch = null;

        fetchImpl = async () =>
          new Promise(resolve => {
            releaseFetch = () => {
              resolve({
                ok: true,
                status: 200,

                json: async () => ({
                  ok: true,
                  month: '2026-11',
                  full: false,
                  viewMonths: {
                    back: 0,
                    fwd: 0,
                  },
                  items: [],
                  leaves: [],
                }),
              });
            };
          });

        const pending =
          ui.fetchMonth('2026-11');

        await Promise.resolve();
        await Promise.resolve();

        if (!releaseFetch) {
          cacheRaceFailures.push(
            'public cache-race request must start before LIFF state changes'
          );
        }

        // LIFF becomes ready while the public request is in flight.
        ui.state.liffReady = true;

        if (releaseFetch) {
          releaseFetch();
        }

        await pending;

        if (
          !ui.state.cache[
            '2026-11_pub'
          ]
        ) {
          cacheRaceFailures.push(
            'public response crossing LIFF readiness must be stored under _pub'
          );
        }

        if (
          ui.state.cache[
            '2026-11_full'
          ]
        ) {
          cacheRaceFailures.push(
            'public response crossing LIFF readiness must not poison _full cache'
          );
        }
      }

      // ----------------------------------------------------
      // Case 2:
      // Authenticated request temporarily falls back to
      // public data. Because full=false, cache must be _pub
      // so a future staff request can try again.
      // ----------------------------------------------------
      {
        ui.state.liffReady = true;
        ui.state.deadToken = '';
        ui.state.cache = {};

        fetchImpl = async () => ({
          ok: true,
          status: 200,

          json: async () => ({
            ok: true,
            month: '2026-12',
            full: false,
            authCode:
              'LINE_UNAVAILABLE',
            viewMonths: {
              back: 0,
              fwd: 0,
            },
            items: [],
            leaves: [],
          }),
        });

        await ui.fetchMonth(
          '2026-12'
        );

        if (
          !ui.state.cache[
            '2026-12_pub'
          ]
        ) {
          cacheRaceFailures.push(
            'temporary authenticated fallback with full=false must be cached as _pub'
          );
        }

        if (
          ui.state.cache[
            '2026-12_full'
          ]
        ) {
          cacheRaceFailures.push(
            'temporary authenticated fallback must not poison _full cache'
          );
        }

        if (
          ui.state.deadToken !== ''
        ) {
          cacheRaceFailures.push(
            'LINE_UNAVAILABLE must not mark the credential dead'
          );
        }
      }
    } finally {
      context.liff.isLoggedIn =
        originalIsLoggedIn;

      context.liff.getAccessToken =
        originalGetAccessToken;

      ui.state.liffReady = false;
      ui.state.deadToken = '';
      ui.state.cache = {};
      ui.state.viewMonths = null;
      ui.state.full = false;
      ui.state.viewer = '';
      ui.state.mine = false;
    }

    assert(
      cacheRaceFailures.length === 0,
      'SCHED-REL-P10D2 cache-mode race contract failed: ' +
        cacheRaceFailures.join('; ')
    );
  }

  // --------------------------------------------------------
  // SCHED-REL-P03A:
  //
  // Foreground schedule loads are user-facing safe reads.
  // They may retry transient transport failures, bounded at
  // three total attempts.
  //
  // Background/default fetches remain one attempt so silent
  // neighbor prefetch does not amplify an upstream outage.
  // --------------------------------------------------------

  // Foreground read should recover on attempt 3.
  {
    let attempts = 0;
    let result = null;
    let caught = null;

    fetchImpl = async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error(
          'temporary offline'
        );
      }

      return okScheduleResponse(
        '2026-10'
      );
    };

    try {
      result =
        await ui.fetchMonth(
          '2026-10',
          {
            retryTransient: true,
          }
        );
    } catch (err) {
      caught = err;
    }

    if (
      caught ||
      attempts !== 3 ||
      !result ||
      result.ok !== true
    ) {
      failures.push(
        'foreground: safe schedule read should recover on attempt 3; attempts=' +
          attempts +
          ', error=' +
          String(
            caught &&
              caught.message
          )
      );
    }
  }

  // Default/background fetch must stay single-attempt.
  {
    let attempts = 0;
    let caught = null;

    fetchImpl = async () => {
      attempts += 1;
      throw new Error(
        'temporary offline'
      );
    };

    try {
      await ui.fetchMonth(
        '2026-11'
      );
    } catch (err) {
      caught = err;
    }

    if (
      !caught ||
      attempts !== 1
    ) {
      failures.push(
        'background: default schedule fetch must make exactly 1 attempt; attempts=' +
          attempts
      );
    }
  }

  // Foreground retry must remain bounded.
  {
    let attempts = 0;
    let caught = null;

    fetchImpl = async () => {
      attempts += 1;
      throw new Error(
        'still offline'
      );
    };

    try {
      await ui.fetchMonth(
        '2026-12',
        {
          retryTransient: true,
        }
      );
    } catch (err) {
      caught = err;
    }

    if (
      !caught ||
      attempts !== 3
    ) {
      failures.push(
        'foreground bounded retry: expected 3 attempts and final error; attempts=' +
          attempts
      );
    }
  }

  assert(
    failures.length === 0,
    'SCHED-REL-P03A transport retry contract failed: ' +
      failures.join('; ')
  );

  // --------------------------------------------------------
  // SCHED-REL-P05:
  //
  // After a foreground load exhausts its bounded retries,
  // the visible "ลองใหม่" action must retry the same month
  // in place. A data-load failure must not reload or replace
  // the whole schedule page.
  // --------------------------------------------------------
  const retryFailures = [];

  const retryButton =
    elements.get('btnRetry');

  if (
    !retryButton ||
    typeof retryButton.listeners.click !== 'function'
  ) {
    retryFailures.push(
      'retry button is not wired to a click handler'
    );
  } else {
    const retryMonth =
      '2027-01';

    let fetchAttempts = 0;
    let replaceCalls = 0;
    let reloadCalls = 0;

    // First foreground load: exhaust all three attempts.
    fetchImpl = async () => {
      fetchAttempts += 1;
      throw new Error(
        'temporary schedule outage'
      );
    };

    await ui.loadMonth(
      retryMonth
    );

    if (fetchAttempts !== 3) {
      retryFailures.push(
        'initial foreground failure should exhaust 3 attempts; attempts=' +
          fetchAttempts
      );
    }

    const viewError =
      elements.get('viewError');

    if (
      !viewError ||
      viewError.classList.contains('hidden')
    ) {
      retryFailures.push(
        'exhausted foreground failure must show the error view'
      );
    }

    context.location.replace = () => {
      replaceCalls += 1;
    };

    context.location.reload = () => {
      reloadCalls += 1;
    };

    // Upstream is healthy again.
    fetchAttempts = 0;

    fetchImpl = async () => {
      fetchAttempts += 1;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          month: retryMonth,
          full: false,

          // Prevent neighbor-prefetch traffic from affecting
          // this interaction-recovery assertion.
          viewMonths: {
            back: 0,
            fwd: 0,
          },

          items: [],
          leaves: [],
        }),
      };
    };

    const clickResult =
      retryButton.listeners.click();

    if (
      clickResult &&
      typeof clickResult.then === 'function'
    ) {
      await clickResult;
    }

    // Support handlers that start loadMonth() without
    // returning its Promise.
    await Promise.resolve();
    await Promise.resolve();

    await new Promise(resolve => {
      setImmediate(resolve);
    });

    if (fetchAttempts !== 1) {
      retryFailures.push(
        'retry button should fetch the same month once after recovery; attempts=' +
          fetchAttempts
      );
    }

    if (
      replaceCalls !== 0 ||
      reloadCalls !== 0
    ) {
      retryFailures.push(
        'retry button must recover in place; replace=' +
          replaceCalls +
          ', reload=' +
          reloadCalls
      );
    }

    if (
      viewError &&
      !viewError.classList.contains('hidden')
    ) {
      retryFailures.push(
        'successful retry must leave the error view'
      );
    }

    if (
      ui.state.month !== retryMonth
    ) {
      retryFailures.push(
        'retry must preserve the current month; got=' +
          String(ui.state.month)
      );
    }
  }

  assert(
    retryFailures.length === 0,
    'SCHED-REL-P05 interaction recovery contract failed: ' +
      retryFailures.join('; ')
  );

  // --------------------------------------------------------
  // SCHED-REL-P06B:
  //
  // Schedule is public-first. A full:false response does not
  // automatically mean the supplied token is dead.
  //
  // Only UNAUTHORIZED is a dead credential.
  //
  // These must KEEP the current token usable:
  //   LINE_UNAVAILABLE
  //   UNCONFIGURED
  //   UNREGISTERED
  //   UPSTREAM_ERROR
  // --------------------------------------------------------
  const authConsumptionFailures = [];

  const originalIsLoggedIn =
    context.liff.isLoggedIn;

  const originalGetAccessToken =
    context.liff.getAccessToken;

  let activeToken = '';

  context.liff.isLoggedIn =
    () => true;

  context.liff.getAccessToken =
    () => activeToken;

  ui.state.liffReady = true;

  async function probeAuthFallback(
    authCode,
    shouldKillToken,
    month
  ) {
    activeToken =
      'token-' + authCode;

    ui.state.deadToken = '';
    ui.state.cache = {};

    let attempts = 0;

    fetchImpl = async () => {
      attempts += 1;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          month,
          full: false,
          authCode,
          viewMonths: {
            back: -1,
            fwd: 6,
          },
          items: [],
          leaves: [],
        }),
      };
    };

    let caught = null;

    try {
      await ui.fetchMonth(month);
    } catch (err) {
      caught = err;
    }

    if (caught) {
      authConsumptionFailures.push(
        authCode +
        ': fetch should degrade to public instead of throwing; error=' +
        String(caught.message)
      );

      return;
    }

    if (attempts !== 1) {
      authConsumptionFailures.push(
        authCode +
        ': auth fallback fetch should use one request; attempts=' +
        attempts
      );
    }

    const killed =
      ui.state.deadToken === activeToken;

    if (killed !== shouldKillToken) {
      authConsumptionFailures.push(
        authCode +
        ': deadToken expected=' +
        shouldKillToken +
        ', actual=' +
        killed
      );
    }

    const tokenAfter =
      ui.currentToken();

    if (
      shouldKillToken &&
      tokenAfter !== ''
    ) {
      authConsumptionFailures.push(
        authCode +
        ': dead token must not be sent again; currentToken=' +
        String(tokenAfter)
      );
    }

    if (
      !shouldKillToken &&
      tokenAfter !== activeToken
    ) {
      authConsumptionFailures.push(
        authCode +
        ': temporary/non-credential fallback must preserve token; currentToken=' +
        String(tokenAfter)
      );
    }
  }

  try {
    await probeAuthFallback(
      'LINE_UNAVAILABLE',
      false,
      '2027-02'
    );

    await probeAuthFallback(
      'UNCONFIGURED',
      false,
      '2027-03'
    );

    await probeAuthFallback(
      'UNREGISTERED',
      false,
      '2027-04'
    );

    await probeAuthFallback(
      'UPSTREAM_ERROR',
      false,
      '2027-05'
    );

    await probeAuthFallback(
      'UNAUTHORIZED',
      true,
      '2027-06'
    );
  } finally {
    context.liff.isLoggedIn =
      originalIsLoggedIn;

    context.liff.getAccessToken =
      originalGetAccessToken;

    ui.state.liffReady = false;
    ui.state.deadToken = '';
    ui.state.cache = {};
  }

  assert(
    authConsumptionFailures.length === 0,
    'SCHED-REL-P06B auth fallback consumption failed: ' +
      authConsumptionFailures.join('; ')
  );

  console.log(
    'PASS testScheduleRuntimeReliability'
  );
}

run().catch(err => {
  console.error(
    'FAIL testScheduleUi: ' +
      (
        err &&
        (
          err.stack ||
          err.message
        )
      )
  );

  process.exitCode = 1;
});
