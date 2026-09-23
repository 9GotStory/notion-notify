'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
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
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] || null; }
  appendChild() {}
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

async function run() {
  const html = fs.readFileSync(path.resolve(__dirname, '../web/liff-form/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(source => source.includes("'use strict';"));
  let source = scripts[scripts.length - 1];
  source = source.replace(/\n  boot\(\);\n\}\)\(\);\s*$/, `
  globalThis.__leaveUiTest = {
    state: state,
    api: api,
    relogin: relogin_,
    loadMyLeaves: loadMyLeaves_,
    loadApprovalQueue: loadApprovalQueue_,
    confirmCancelLeave: confirmCancelLeave_,
    mineLeaveCard: mineLeaveCard_,
    renderMineState: renderMineState_,
    setButtonBusy: setButtonBusy_,
    thaiShort: thaiShort,
    dateRangeLabel: dateRangeLabel,
  };
})();`);
  assert(source.includes('__leaveUiTest'), 'could not install LIFF UI test hook');

  const elements = new Map();
  const mainTabs = [new FakeElement('tab-form'), new FakeElement('tab-mine'), new FakeElement('tab-approvals')];
  mainTabs[0].dataset.view = 'form';
  mainTabs[1].dataset.view = 'mine';
  mainTabs[2].dataset.view = 'approvals';
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector === '.main-tab' ? mainTabs : []; },
    createElement(tag) { return new FakeElement(tag); },
  };

  let cancelResponse;
  const cancelPending = new Promise(resolve => { cancelResponse = resolve; });
  const fetchCalls = []; // {url, method, body} — เทสฟอร์มลาต้องยืนยันว่า API ไปเป็น POST body ไม่ใช่ query string
  const context = vm.createContext({
    console,
    document,
    window: { confirm: () => true, scrollTo() {} },
    location: { origin: 'https://example.test', pathname: '/leave', replace() {}, reload() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    CONFIG: { LIFF_ID: 'test-liff', API_URL: 'https://api.example.test/exec' },
    liff: { getAccessToken: () => 'test-token' },
    crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
    URLSearchParams,
    AbortController,
    Date,
    Intl,
    Set,
    Map,
    Math,
    JSON,
    setTimeout: () => 1,
    clearTimeout() {},
    fetch(url, options) {
      fetchCalls.push({
        url: String(url),
        method: options && options.method,
        body: String((options && options.body) || ''),
      });
      if (fetchCalls.length === 1) return cancelPending;
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, leaves: [], usage: null, leaveYear: '2570' }),
      });
    },
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../web/shared/date.js'), 'utf8'), context,
    { filename: 'shared-date.js' });
  vm.runInContext(source, context, { filename: 'liff-form-inline.js' });

  const ui = context.__leaveUiTest;
  assert(ui.thaiShort('2026-08-30') === '30 ส.ค. 2569', 'single date format mismatch');
  assert(ui.dateRangeLabel('2026-08-30', '2026-08-31') === '30–31 ส.ค. 2569',
    'same-month date range format mismatch');
  assert(ui.dateRangeLabel('2026-09-30', '2026-10-01') === '30 ก.ย. 2569 – 1 ต.ค. 2569',
    'cross-month date range format mismatch');

  // LIFF-REL-P02A:
  // Apps Script already returns machine-readable public error codes.
  // The LIFF transport boundary must preserve them on the thrown Error
  // so auth/transient/application failures can be classified reliably.
  const originalFetch = context.fetch;
  const originalSetTimeout = context.setTimeout;
  const errorCodeFailures = [];

  // P04 adds bounded retry to safe reads. Make its short backoff
  // deterministic here while keeping the 20-second abort timer dormant.
  context.setTimeout = (fn, delay) => {
    if (Number(delay) <= 1000) {
      Promise.resolve().then(fn);
    }
    return 1;
  };

  for (const code of ['LINE_UNAVAILABLE', 'UPSTREAM_ERROR']) {
    context.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        code,
        error: 'temporary upstream failure',
      }),
    });

    let caught = null;
    try {
      await ui.api('session');
    } catch (err) {
      caught = err;
    }

    if (!caught || caught.code !== code) {
      errorCodeFailures.push(
        code + ': expected thrown error.code=' + code +
        ', got ' + String(caught && caught.code)
      );
    }
  }

  context.fetch = originalFetch;
  context.setTimeout = originalSetTimeout;

  assert(
    errorCodeFailures.length === 0,
    'LIFF-REL-P02A error-code preservation failed: ' +
      errorCodeFailures.join('; ')
  );

  // LIFF-REL-P02B:
  // All LIFF API calls use HTTP POST, so transport method cannot decide
  // retry safety. Retry semantics must be based on the action itself:
  //
  // safe reads:
  //   session / calendar / myLeaves / approvalQueue
  //
  // mutations:
  //   bind / submit / cancel / update / reassignApprover
  //
  // Safe reads may retry transient failures, but must stop after
  // three total attempts. Mutations must never be automatically retried
  // after an ambiguous transport failure.
  const retryContractFailures = [];
  const retryOriginalFetch = context.fetch;
  const retryOriginalSetTimeout = context.setTimeout;

  // Production retry backoff may use short setTimeout delays.
  // Execute only short timers immediately in this deterministic test;
  // the existing 20-second AbortController timeout must remain dormant.
  context.setTimeout = (fn, delay) => {
    if (Number(delay) <= 1000) {
      Promise.resolve().then(fn);
    }
    return 1;
  };

  const okResponse = action => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, action }),
  });

  async function probeSafeRead(action, transientResponse) {
    let attempts = 0;

    context.fetch = async () => {
      attempts += 1;

      if (attempts < 3) {
        return transientResponse(attempts);
      }

      return okResponse(action);
    };

    let result = null;
    let caught = null;

    try {
      result = await ui.api(action);
    } catch (err) {
      caught = err;
    }

    if (
      caught ||
      attempts !== 3 ||
      !result ||
      result.ok !== true
    ) {
      retryContractFailures.push(
        action +
        ': safe read should recover on attempt 3; attempts=' +
        attempts +
        ', error=' +
        String(caught && caught.message)
      );
    }
  }

  try {
    // Network transport failure.
    await probeSafeRead('session', () => {
      throw new Error('offline');
    });

    // Backend explicitly classified LINE transient failure.
    await probeSafeRead('calendar', () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        code: 'LINE_UNAVAILABLE',
        error: 'LINE temporarily unavailable',
      }),
    }));

    // Retryable HTTP responses.
    await probeSafeRead('myLeaves', attempt => ({
      ok: false,
      status: attempt === 1 ? 429 : 503,
      json: async () => ({
        ok: false,
        error: 'temporary HTTP failure',
      }),
    }));

    // Backend generic upstream transient failure.
    await probeSafeRead('approvalQueue', () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        code: 'UPSTREAM_ERROR',
        error: 'temporary upstream failure',
      }),
    }));

    // Boundedness: a permanently failing safe read must stop after
    // exactly three total attempts and surface the final error.
    let boundedAttempts = 0;
    let boundedError = null;

    context.fetch = async () => {
      boundedAttempts += 1;
      throw new Error('still offline');
    };

    try {
      await ui.api('session');
    } catch (err) {
      boundedError = err;
    }

    if (!boundedError || boundedAttempts !== 3) {
      retryContractFailures.push(
        'session bounded retry: expected 3 attempts and final error; attempts=' +
        boundedAttempts
      );
    }

    // Mutation safety: transport ambiguity after a write must never
    // cause the client to send the write again automatically.
    for (const action of [
      'bind',
      'submit',
      'cancel',
      'update',
      'reassignApprover',
    ]) {
      let attempts = 0;
      let caught = null;

      context.fetch = async () => {
        attempts += 1;
        throw new Error('connection lost after request');
      };

      try {
        await ui.api(action);
      } catch (err) {
        caught = err;
      }

      if (!caught || attempts !== 1) {
        retryContractFailures.push(
          action +
          ': mutation must make exactly 1 attempt on transport failure; attempts=' +
          attempts
        );
      }
    }
  } finally {
    context.fetch = retryOriginalFetch;
    context.setTimeout = retryOriginalSetTimeout;
  }

  assert(
    retryContractFailures.length === 0,
    'LIFF-REL-P02B retry contract failed: ' +
      retryContractFailures.join('; ')
  );

  // LIFF-REL-P05:
  // Auth recovery semantics differ by runtime:
  //
  // LINE client:
  //   reload current LIFF context WITHOUT liff.logout()
  //
  // External browser:
  //   logout stale session, then enter liff.login()
  //
  // Transient/auth recovery inside LINE must not destroy the LINE
  // session before reload, otherwise repeated recovery can amplify
  // session churn and eventually leave the page unrecoverable.
  const authRecoveryFailures = [];

  const originalIsLoggedIn = context.liff.isLoggedIn;
  const originalLogout = context.liff.logout;
  const originalIsInClient = context.liff.isInClient;
  const originalLogin = context.liff.login;
  const originalReload = context.location.reload;

  function restoreProperty(object, key, value) {
    if (value === undefined) {
      delete object[key];
    } else {
      object[key] = value;
    }
  }

  try {
    // --------------------------------------------------------
    // Case A: running inside LINE client.
    // Must reload, must NOT logout, must NOT call login().
    // --------------------------------------------------------
    let logoutCalls = 0;
    let loginCalls = 0;
    let reloadCalls = 0;

    context.liff.isLoggedIn = () => true;
    context.liff.logout = () => {
      logoutCalls += 1;
    };
    context.liff.isInClient = () => true;
    context.liff.login = () => {
      loginCalls += 1;
    };
    context.location.reload = () => {
      reloadCalls += 1;
    };

    ui.relogin();

    if (
      logoutCalls !== 0 ||
      reloadCalls !== 1 ||
      loginCalls !== 0
    ) {
      authRecoveryFailures.push(
        'LINE client: expected reload=1, logout=0, login=0; got reload=' +
        reloadCalls +
        ', logout=' +
        logoutCalls +
        ', login=' +
        loginCalls
      );
    }

    // --------------------------------------------------------
    // Case B: external browser.
    // Existing explicit logout/login flow remains allowed.
    // --------------------------------------------------------
    logoutCalls = 0;
    loginCalls = 0;
    reloadCalls = 0;

    context.liff.isLoggedIn = () => true;
    context.liff.isInClient = () => false;

    ui.relogin();

    if (
      logoutCalls !== 1 ||
      loginCalls !== 1 ||
      reloadCalls !== 0
    ) {
      authRecoveryFailures.push(
        'external browser: expected logout=1, login=1, reload=0; got logout=' +
        logoutCalls +
        ', login=' +
        loginCalls +
        ', reload=' +
        reloadCalls
      );
    }
  } finally {
    restoreProperty(
      context.liff,
      'isLoggedIn',
      originalIsLoggedIn
    );
    restoreProperty(
      context.liff,
      'logout',
      originalLogout
    );
    restoreProperty(
      context.liff,
      'isInClient',
      originalIsInClient
    );
    restoreProperty(
      context.liff,
      'login',
      originalLogin
    );

    context.location.reload =
      originalReload;
  }

  assert(
    authRecoveryFailures.length === 0,
    'LIFF-REL-P05 auth recovery contract failed: ' +
      authRecoveryFailures.join('; ')
  );

  // LIFF-REL-P06:
  // A data-view failure after internal bounded retries must be recoverable
  // in place. The user must have an explicit retry action for:
  //
  //   - My Leaves
  //   - Approval Queue
  //
  // Retry must reload only that data view — never reload/replace the LIFF page.
  const interactionRecoveryFailures = [];

  const hasMineRetryMarkup =
    html.includes('id="mineRetry"');

  const hasApprovalRetryMarkup =
    html.includes('id="approvalRetry"');

  if (!hasMineRetryMarkup) {
    interactionRecoveryFailures.push(
      'mine: missing inline retry control'
    );
  }

  if (!hasApprovalRetryMarkup) {
    interactionRecoveryFailures.push(
      'approvals: missing inline retry control'
    );
  }

  const mineRetry =
    elements.get('mineRetry');

  const approvalRetry =
    elements.get('approvalRetry');

  if (
    !mineRetry ||
    typeof mineRetry.listeners.click !== 'function'
  ) {
    interactionRecoveryFailures.push(
      'mine: retry control is not wired to a click handler'
    );
  }

  if (
    !approvalRetry ||
    typeof approvalRetry.listeners.click !== 'function'
  ) {
    interactionRecoveryFailures.push(
      'approvals: retry control is not wired to a click handler'
    );
  }

  // Run behavior checks only after the controls exist.
  // This keeps the initial RED deterministic and readable.
  if (
    mineRetry &&
    typeof mineRetry.listeners.click === 'function' &&
    approvalRetry &&
    typeof approvalRetry.listeners.click === 'function'
  ) {
    const recoveryOriginalFetch =
      context.fetch;

    const recoveryOriginalSetTimeout =
      context.setTimeout;

    const recoveryOriginalReload =
      context.location.reload;

    const recoveryOriginalReplace =
      context.location.replace;

    let reloadCalls = 0;
    let replaceCalls = 0;

    context.location.reload = () => {
      reloadCalls += 1;
    };

    context.location.replace = () => {
      replaceCalls += 1;
    };

    // Allow the 250/500 ms production retry backoff to run
    // deterministically while leaving the 20-second abort timer dormant.
    context.setTimeout = (fn, delay) => {
      if (Number(delay) <= 1000) {
        Promise.resolve().then(fn);
      }
      return 1;
    };

    let failTransport = true;
    let fetchAttempts = 0;

    context.fetch = async (url, options) => {
      fetchAttempts += 1;

      if (failTransport) {
        throw new Error('temporary offline');
      }

      const payload =
        JSON.parse(
          String(
            (options && options.body) ||
            '{}'
          )
        );

      if (payload.apiAction === 'myLeaves') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            leaves: [],
            usage: null,
            leaveYear: '2570',
          }),
        };
      }

      if (payload.apiAction === 'approvalQueue') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            leaves: [],
            staffOptions: [],
          }),
        };
      }

      throw new Error(
        'unexpected recovery action: ' +
        String(payload.apiAction)
      );
    };

    try {
      // ------------------------------------------------------
      // My Leaves:
      // first load exhausts all 3 internal retries and fails.
      // User presses inline retry after upstream recovers.
      // ------------------------------------------------------
      fetchAttempts = 0;
      failTransport = true;

      await ui.loadMyLeaves();

      if (
        fetchAttempts !== 3 ||
        !ui.state.mine.error ||
        mineRetry.classList.contains('hidden')
      ) {
        interactionRecoveryFailures.push(
          'mine: exhausted failure must expose inline retry after 3 attempts'
        );
      }

      failTransport = false;
      fetchAttempts = 0;

      await mineRetry.listeners.click();

      if (
        fetchAttempts !== 1 ||
        ui.state.mine.error ||
        !mineRetry.classList.contains('hidden')
      ) {
        interactionRecoveryFailures.push(
          'mine: inline retry must recover the view when upstream returns'
        );
      }

      // ------------------------------------------------------
      // Approval Queue:
      // same recovery contract, no page reload.
      // ------------------------------------------------------
      ui.state.user = {
        canManageApprovals: true,
      };

      fetchAttempts = 0;
      failTransport = true;

      await ui.loadApprovalQueue();

      if (
        fetchAttempts !== 3 ||
        !ui.state.approvals.error ||
        approvalRetry.classList.contains('hidden')
      ) {
        interactionRecoveryFailures.push(
          'approvals: exhausted failure must expose inline retry after 3 attempts'
        );
      }

      failTransport = false;
      fetchAttempts = 0;

      await approvalRetry.listeners.click();

      if (
        fetchAttempts !== 1 ||
        ui.state.approvals.error ||
        !approvalRetry.classList.contains('hidden')
      ) {
        interactionRecoveryFailures.push(
          'approvals: inline retry must recover the view when upstream returns'
        );
      }

      if (
        reloadCalls !== 0 ||
        replaceCalls !== 0
      ) {
        interactionRecoveryFailures.push(
          'data retry must not reload or replace the LIFF page; reload=' +
          reloadCalls +
          ', replace=' +
          replaceCalls
        );
      }
    } finally {
      context.fetch =
        recoveryOriginalFetch;

      context.setTimeout =
        recoveryOriginalSetTimeout;

      context.location.reload =
        recoveryOriginalReload;

      context.location.replace =
        recoveryOriginalReplace;
    }
  }

  assert(
    interactionRecoveryFailures.length === 0,
    'LIFF-REL-P06 interaction recovery contract failed: ' +
      interactionRecoveryFailures.join('; ')
  );

  const leave = {
    pageId: 'page-1', leaveType: 'ลากิจ', start: '2026-09-01', end: '2026-09-01',
    period: 'เต็มวัน', workDays: 1, workDaysLabel: '1 วัน', status: 'รอผู้อนุมัติ',
    canEdit: true, canCancel: true, pendingApproverNames: [], reason: 'ทดสอบ',
  };
  ui.state.mine.leaves = [leave];
  ui.state.mine.leaveYear = '2570';
  ui.renderMineState();

  const operation = ui.confirmCancelLeave(leave);
  await Promise.resolve();
  assert(ui.state.mine.pendingPageId === leave.pageId, 'cancel did not enter pending state');
  assert(fetchCalls.length === 1 && /"apiAction":"cancel"/.test(fetchCalls[0].body), 'cancel API was not called once');
  assert(fetchCalls[0].method === 'POST' && fetchCalls[0].url === 'https://api.example.test/exec',
    'leave API must POST to the exec URL instead of a query string');
  assert(/"requestId":"123e4567-e89b-42d3-a456-426614174000"/.test(fetchCalls[0].body),
    'cancel request id was not sent');
  const pendingHtml = elements.get('mineList').innerHTML;
  assert(/disabled aria-disabled="true"/.test(pendingHtml), 'leave actions were not disabled');
  assert(/aria-busy="true"/.test(pendingHtml) && /กำลังยกเลิก…/.test(pendingHtml),
    'cancel button did not expose its busy state');
  assert(mainTabs.every(tab => tab.disabled), 'main navigation was not locked');

  await ui.confirmCancelLeave(leave);
  assert(fetchCalls.length === 1, 'a second cancel was sent while the first was pending');

  cancelResponse({ ok: true, json: async () => ({ ok: true, status: 'ยกเลิก' }) });
  await operation;
  assert(ui.state.mine.pendingPageId === '', 'pending state was not cleared');
  assert(mainTabs.every(tab => !tab.disabled), 'main navigation was not unlocked');
  assert(fetchCalls.length === 2 && /"apiAction":"myLeaves"/.test(fetchCalls[1].body), 'leave list was not refreshed');
  assert(/ยกเลิก.*เรียบร้อยแล้ว/.test(elements.get('mineSuccess').textContent),
    'success feedback was not shown');

  const failedLeave = Object.assign({}, leave, { pageId: 'page-2', start: '2026-09-02', end: '2026-09-02' });
  ui.state.mine.leaves = [failedLeave];
  ui.state.mine.success = '';
  context.fetch = async () => { throw new Error('offline'); };
  await ui.confirmCancelLeave(failedLeave);
  assert(ui.state.mine.pendingPageId === '' && mainTabs.every(tab => !tab.disabled),
    'failed cancel did not restore controls');
  assert(/เชื่อมต่อระบบไม่สำเร็จ/.test(ui.state.mine.error), 'failed cancel did not show an error');
  assert(!/disabled aria-disabled="true"/.test(elements.get('mineList').innerHTML),
    'failed cancel left leave actions disabled');

  const button = new FakeElement('test-button');
  button.textContent = 'บันทึก';
  ui.setButtonBusy(button, true, 'กำลังบันทึก…');
  assert(button.disabled && button.getAttribute('aria-busy') === 'true' && button.textContent === 'กำลังบันทึก…',
    'shared button helper did not set busy state');
  ui.setButtonBusy(button, false);
  assert(!button.disabled && button.getAttribute('aria-busy') === null && button.textContent === 'บันทึก',
    'shared button helper did not restore idle state');

  const approvalBodies = [];
  context.fetch = async (url, options) => {
    approvalBodies.push(String((options && options.body) || ''));
    return { ok: true, json: async () => ({ ok: true, leaves: [], staffOptions: [] }) };
  };
  ui.state.user = { canManageApprovals: true };
  mainTabs[2].listeners.click();
  await Promise.resolve();
  await Promise.resolve();
  assert(!elements.get('view-approvals').classList.contains('hidden'),
    'approval tab did not open the approval view');
  assert(approvalBodies.length === 1 && /"apiAction":"approvalQueue"/.test(approvalBodies[0]),
    'approval tab did not load the approval queue');

  console.log('PASS testLiffCancelInteraction');
  console.log('PASS testLiffSharedButtonBusyState');
  console.log('PASS testLiffApprovalTabNavigation');
}

run().catch(err => {
  console.error('FAIL testLiffUi: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
