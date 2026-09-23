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
