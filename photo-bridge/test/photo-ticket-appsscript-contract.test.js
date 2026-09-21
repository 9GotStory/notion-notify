import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyPhotoTicket,
} from '../src/photo-ticket.js';

const SECRET = 'photo-test-secret';

const CLAIMS = {
  sub: 'Utest123',
  staffKey: 'นายทดสอบ ระบบ',
  role: 'manager',
  iat: 1770000000,
  exp: 1770000300,
};

const APPS_SCRIPT_GOLDEN_TICKET =
  'eyJzdWIiOiJVdGVzdDEyMyIsInN0YWZmS2V5Ijoi4LiZ4Liy4Lii4LiX4LiU4Liq4Lit4LiaIOC4o-C4sOC4muC4miIsInJvbGUiOiJtYW5hZ2VyIiwiaWF0IjoxNzcwMDAwMDAwLCJleHAiOjE3NzAwMDAzMDB9.yxeVt6BzZMQMAjxCCixO3K3pQcZ3GZ89AmiGeYQCCGk';

test(
  'Apps Script golden photo ticket verifies in Node',
  () => {
    const actor = verifyPhotoTicket(
      APPS_SCRIPT_GOLDEN_TICKET,
      SECRET,
      {
        nowSeconds: 1770000001,
      }
    );

    assert.deepEqual(actor, CLAIMS);
  }
);
