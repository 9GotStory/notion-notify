import test from 'node:test';
import assert from 'node:assert/strict';

import { createPhotoTicket } from '../src/photo-ticket.js';
import { handleHttpRequest } from '../src/http-handler.js';

const SECRET = 'http-test-secret';

const config = {
  ticketSecret: SECRET,
  ticketTtlSeconds: 300,
};

function ticket(role = 'user', overrides = {}) {
  return createPhotoTicket(
    {
      sub: 'U123',
      staffKey: 'staff-001',
      role,
      iat: 1000,
      exp: 1300,
      ...overrides,
    },
    SECRET
  );
}

function request(path, bearer) {
  const headers = {};

  if (bearer) {
    headers.authorization = `Bearer ${bearer}`;
  }

  return {
    method: 'GET',
    url: path,
    headers,
  };
}

const context = {
  config,
  authOptions: {
    nowSeconds: 1100,
  },
};

test('health endpoint is public', async () => {
  const result = await handleHttpRequest(
    request('/health'),
    context
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('authenticated session returns safe actor fields', async () => {
  const result = await handleHttpRequest(
    request('/v1/session', ticket()),
    context
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.actor, {
    sub: 'U123',
    staffKey: 'staff-001',
    role: 'user',
    exp: 1300,
  });
});

test('missing bearer ticket returns 401', async () => {
  const result = await handleHttpRequest(
    request('/v1/session'),
    context
  );

  assert.equal(result.status, 401);
});

test('normal user cannot access manager boundary', async () => {
  const result = await handleHttpRequest(
    request('/v1/manager/session', ticket('user')),
    context
  );

  assert.equal(result.status, 403);
});

test('manager can access manager boundary', async () => {
  const result = await handleHttpRequest(
    request('/v1/manager/session', ticket('manager')),
    context
  );

  assert.equal(result.status, 200);
});

test('admin can access manager boundary', async () => {
  const result = await handleHttpRequest(
    request('/v1/manager/session', ticket('admin')),
    context
  );

  assert.equal(result.status, 200);
});

test('ticket exceeding configured lifetime is rejected', async () => {
  const longTicket = ticket('user', {
    iat: 1000,
    exp: 1600,
  });

  const result = await handleHttpRequest(
    request('/v1/session', longTicket),
    context
  );

  assert.equal(result.status, 401);
});

test('authenticated user can list topics', async () => {
  const topicContext = {
    ...context,
    archiveService: {
      async listSelectableTopics() {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
            type: 'topic',
          },
        ];
      },
    },
  };

  const result = await handleHttpRequest(
    request('/v1/topics', ticket()),
    topicContext
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.topics, [
    {
      name: '80_งานกิจกรรมกลาง',
      path: '80_งานกิจกรรมกลาง',
      type: 'topic',
    },
  ]);
});

test('topics endpoint requires authentication', async () => {
  const result = await handleHttpRequest(
    request('/v1/topics'),
    context
  );

  assert.equal(result.status, 401);
});

test('topics endpoint hides backend failures', async () => {
  const topicContext = {
    ...context,
    archiveService: {
      async listSelectableTopics() {
        throw new Error(
          'backend secret information'
        );
      },
    },
  };

  const result = await handleHttpRequest(
    request('/v1/topics', ticket()),
    topicContext
  );

  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    ok: false,
    error: 'Internal server error',
  });
});

test('authenticated user can list activities', async () => {
  const activityContext = {
    ...context,
    archiveService: {
      async listActivities(topic, year) {
        assert.equal(
          topic,
          '80_งานกิจกรรมกลาง'
        );
        assert.equal(year, '2569');

        return [
          {
            name:
              '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
            path:
              '80_งานกิจกรรมกลาง/2569/2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
          },
        ];
      },
    },
  };

  const result = await handleHttpRequest(
    request(
      '/v1/activities?topic=' +
        encodeURIComponent('80_งานกิจกรรมกลาง') +
        '&year=2569',
      ticket()
    ),
    activityContext
  );

  assert.equal(result.status, 200);

  assert.equal(
    result.body.activities[0].name,
    '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง'
  );
});

test('activities endpoint requires authentication', async () => {
  const result = await handleHttpRequest(
    request(
      '/v1/activities?topic=' +
        encodeURIComponent('80_งานกิจกรรมกลาง') +
        '&year=2569'
    ),
    context
  );

  assert.equal(result.status, 401);
});
