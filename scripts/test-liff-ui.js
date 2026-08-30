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
    confirmCancelLeave: confirmCancelLeave_,
    mineLeaveCard: mineLeaveCard_,
    renderMineState: renderMineState_,
    setButtonBusy: setButtonBusy_,
  };
})();`);
  assert(source.includes('__leaveUiTest'), 'could not install LIFF UI test hook');

  const elements = new Map();
  const mainTabs = [new FakeElement('tab-form'), new FakeElement('tab-mine')];
  mainTabs[0].dataset.view = 'form';
  mainTabs[1].dataset.view = 'mine';
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
  const fetchUrls = [];
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
    fetch(url) {
      fetchUrls.push(String(url));
      if (fetchUrls.length === 1) return cancelPending;
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, leaves: [], usage: null, leaveYear: '2570' }),
      });
    },
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'liff-form-inline.js' });

  const ui = context.__leaveUiTest;
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
  assert(fetchUrls.length === 1 && /apiAction=cancel/.test(fetchUrls[0]), 'cancel API was not called once');
  assert(/requestId=123e4567-e89b-42d3-a456-426614174000/.test(fetchUrls[0]),
    'cancel request id was not sent');
  const pendingHtml = elements.get('mineList').innerHTML;
  assert(/disabled aria-disabled="true"/.test(pendingHtml), 'leave actions were not disabled');
  assert(/aria-busy="true"/.test(pendingHtml) && /กำลังยกเลิก…/.test(pendingHtml),
    'cancel button did not expose its busy state');
  assert(mainTabs.every(tab => tab.disabled), 'main navigation was not locked');

  await ui.confirmCancelLeave(leave);
  assert(fetchUrls.length === 1, 'a second cancel was sent while the first was pending');

  cancelResponse({ ok: true, json: async () => ({ ok: true, status: 'ยกเลิก' }) });
  await operation;
  assert(ui.state.mine.pendingPageId === '', 'pending state was not cleared');
  assert(mainTabs.every(tab => !tab.disabled), 'main navigation was not unlocked');
  assert(fetchUrls.length === 2 && /apiAction=myLeaves/.test(fetchUrls[1]), 'leave list was not refreshed');
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

  console.log('PASS testLiffCancelInteraction');
  console.log('PASS testLiffSharedButtonBusyState');
}

run().catch(err => {
  console.error('FAIL testLiffUi: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
