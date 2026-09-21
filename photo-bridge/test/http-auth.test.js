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

test('authenticated user can create activity', async () => {
  const activityContext = {
    ...context,
    archiveService: {
      async createActivity(topic, year, activityName) {
        assert.equal(
          topic,
          '80_งานกิจกรรมกลาง'
        );

        assert.equal(year, '2569');

        assert.equal(
          activityName,
          '2569-09-21_ทดสอบ Photo Bridge'
        );

        return {
          created: true,
          activity: {
            name: activityName,
            path:
              `80_งานกิจกรรมกลาง/2569/${activityName}`,
          },
        };
      },
    },
  };

  const req = request(
    '/v1/activities',
    ticket()
  );

  req.method = 'POST';
  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-21_ทดสอบ Photo Bridge',
  };

  const result = await handleHttpRequest(
    req,
    activityContext
  );

  assert.equal(result.status, 201);
  assert.equal(result.body.created, true);
});

test('existing activity returns idempotent 200', async () => {
  const activityContext = {
    ...context,
    archiveService: {
      async createActivity() {
        return {
          created: false,
          activity: {
            name:
              '2569-09-21_ทดสอบ Photo Bridge',
            path:
              '80_งานกิจกรรมกลาง/2569/2569-09-21_ทดสอบ Photo Bridge',
          },
        };
      },
    },
  };

  const req = request(
    '/v1/activities',
    ticket()
  );

  req.method = 'POST';
  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-21_ทดสอบ Photo Bridge',
  };

  const result = await handleHttpRequest(
    req,
    activityContext
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.created, false);
});

test('create activity requires JSON body', async () => {
  const req = request(
    '/v1/activities',
    ticket()
  );

  req.method = 'POST';

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 400);
});

test('create activity requires authentication', async () => {
  const req = request('/v1/activities');
  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-21_ทดสอบ Photo Bridge',
  };

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});

test('authenticated user can upload to activity', async () => {
  const uploadContext = {
    ...context,

    uploadService: {
      async uploadToActivity(input) {
        assert.equal(
          input.topic,
          '80_งานกิจกรรมกลาง'
        );

        assert.equal(input.year, '2569');

        assert.equal(
          input.activityName,
          '2569-09-03_กิจกรรม'
        );

        assert.equal(
          input.filename,
          'photo.png'
        );

        assert.equal(
          Buffer.isBuffer(input.content),
          true
        );

        return {
          name: 'photo.jpg',
          path:
            '80_งานกิจกรรมกลาง/2569/2569-09-03_กิจกรรม/photo.jpg',
          mime: 'image/jpeg',
          size: input.content.length,
        };
      },
    },
  };

  const req = request(
    '/v1/uploads?' +
      'topic=' +
      encodeURIComponent('80_งานกิจกรรมกลาง') +
      '&year=2569' +
      '&activity=' +
      encodeURIComponent('2569-09-03_กิจกรรม') +
      '&filename=' +
      encodeURIComponent('photo.png'),
    ticket()
  );

  req.method = 'POST';
  req.body = Buffer.from([
    0xff, 0xd8, 0xff,
  ]);

  const result = await handleHttpRequest(
    req,
    uploadContext
  );

  assert.equal(result.status, 201);
  assert.equal(result.body.file.name, 'photo.jpg');
});

test('upload requires authentication', async () => {
  const req = request(
    '/v1/uploads?topic=x&year=2569',
  );

  req.method = 'POST';
  req.body = Buffer.from([1]);

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});

test('authenticated user can upload to inbox', async () => {
  const uploadContext = {
    ...context,

    uploadService: {
      async uploadToInbox(input) {
        assert.equal(
          input.filename,
          'photo.jpg'
        );

        assert.equal(
          Buffer.isBuffer(input.content),
          true
        );

        return {
          name:
            '20260921T080000Z_abcd1234_photo.jpg',
          originalName: 'photo.jpg',
          path:
            '00_INBOX_รอจัดหมวด/' +
            '20260921T080000Z_abcd1234_photo.jpg',
          mime: 'image/jpeg',
          size: input.content.length,
        };
      },
    },
  };

  const req = request(
    '/v1/inbox/uploads?filename=' +
      encodeURIComponent('photo.jpg'),
    ticket()
  );

  req.method = 'POST';

  req.body = Buffer.from([
    0xff, 0xd8, 0xff,
  ]);

  const result = await handleHttpRequest(
    req,
    uploadContext
  );

  assert.equal(result.status, 201);

  assert.equal(
    result.body.file.originalName,
    'photo.jpg'
  );
});

test('inbox upload requires authentication', async () => {
  const req = request(
    '/v1/inbox/uploads?filename=photo.jpg'
  );

  req.method = 'POST';

  req.body = Buffer.from([
    0xff, 0xd8, 0xff,
  ]);

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});

test('normal user cannot move Inbox file', async () => {
  let called = false;

  const moveContext = {
    ...context,

    managerService: {
      async moveFromInbox() {
        called = true;
      },
    },
  };

  const req = request(
    '/v1/move',
    ticket('user')
  );

  req.method = 'POST';

  req.body = {
    filename: 'photo.jpg',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName: '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    moveContext
  );

  assert.equal(result.status, 403);
  assert.equal(called, false);
});

test('manager can move Inbox file', async () => {
  const moveContext = {
    ...context,

    managerService: {
      async moveFromInbox(input) {
        assert.equal(
          input.filename,
          'photo.jpg'
        );

        return {
          name: 'photo.jpg',
          source:
            '00_INBOX_รอจัดหมวด/photo.jpg',
          destination:
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_กิจกรรม/photo.jpg',
        };
      },
    },
  };

  const req = request(
    '/v1/move',
    ticket('manager')
  );

  req.method = 'POST';

  req.body = {
    filename: 'photo.jpg',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName: '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    moveContext
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(
    result.body.moved.name,
    'photo.jpg'
  );
});

test('admin can move Inbox file', async () => {
  let called = false;

  const moveContext = {
    ...context,

    managerService: {
      async moveFromInbox() {
        called = true;

        return {
          name: 'photo.jpg',
          source:
            '00_INBOX_รอจัดหมวด/photo.jpg',
          destination:
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_กิจกรรม/photo.jpg',
        };
      },
    },
  };

  const req = request(
    '/v1/move',
    ticket('admin')
  );

  req.method = 'POST';

  req.body = {
    filename: 'photo.jpg',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName: '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    moveContext
  );

  assert.equal(result.status, 200);
  assert.equal(called, true);
});

test('manager move requires JSON body', async () => {
  const req = request(
    '/v1/move',
    ticket('manager')
  );

  req.method = 'POST';

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 400);
});

test('manager move requires authentication', async () => {
  const req = request('/v1/move');

  req.method = 'POST';

  req.body = {
    filename: 'photo.jpg',
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName: '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});

test('normal user cannot rename activity', async () => {
  let called = false;

  const renameContext = {
    ...context,

    managerService: {
      async renameActivity() {
        called = true;
      },
    },
  };

  const req = request(
    '/v1/rename',
    ticket('user')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_ชื่อเดิม',
    newActivityName:
      '2569-09-03_ชื่อใหม่',
  };

  const result = await handleHttpRequest(
    req,
    renameContext
  );

  assert.equal(result.status, 403);
  assert.equal(called, false);
});

test('manager can rename activity', async () => {
  const renameContext = {
    ...context,

    managerService: {
      async renameActivity(input) {
        assert.equal(
          input.activityName,
          '2569-09-03_ชื่อเดิม'
        );

        assert.equal(
          input.newActivityName,
          '2569-09-03_ชื่อใหม่'
        );

        return {
          oldName:
            '2569-09-03_ชื่อเดิม',
          newName:
            '2569-09-03_ชื่อใหม่',
          source:
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_ชื่อเดิม',
          destination:
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_ชื่อใหม่',
        };
      },
    },
  };

  const req = request(
    '/v1/rename',
    ticket('manager')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_ชื่อเดิม',
    newActivityName:
      '2569-09-03_ชื่อใหม่',
  };

  const result = await handleHttpRequest(
    req,
    renameContext
  );

  assert.equal(result.status, 200);

  assert.equal(
    result.body.renamed.newName,
    '2569-09-03_ชื่อใหม่'
  );
});

test('admin can rename activity', async () => {
  let called = false;

  const renameContext = {
    ...context,

    managerService: {
      async renameActivity() {
        called = true;

        return {
          oldName: 'old',
          newName: 'new',
          source: 'source',
          destination: 'destination',
        };
      },
    },
  };

  const req = request(
    '/v1/rename',
    ticket('admin')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_ชื่อเดิม',
    newActivityName:
      '2569-09-03_ชื่อใหม่',
  };

  const result = await handleHttpRequest(
    req,
    renameContext
  );

  assert.equal(result.status, 200);
  assert.equal(called, true);
});

test('activity rename requires JSON body', async () => {
  const req = request(
    '/v1/rename',
    ticket('manager')
  );

  req.method = 'POST';

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 400);
});

test('activity rename requires authentication', async () => {
  const req = request('/v1/rename');

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_ชื่อเดิม',
    newActivityName:
      '2569-09-03_ชื่อใหม่',
  };

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});

test('normal user cannot archive activity', async () => {
  let called = false;

  const archiveContext = {
    ...context,

    managerService: {
      async archiveActivity() {
        called = true;
      },
    },
  };

  const req = request(
    '/v1/archive',
    ticket('user')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    archiveContext
  );

  assert.equal(result.status, 403);
  assert.equal(called, false);
});

test('manager can archive activity', async () => {
  const archiveContext = {
    ...context,

    managerService: {
      async archiveActivity(input) {
        assert.equal(
          input.activityName,
          '2569-09-03_กิจกรรม'
        );

        return {
          name:
            '2569-09-03_กิจกรรม',
          source:
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_กิจกรรม',
          destination:
            '99_ARCHIVE_คลังภาพเก่า/' +
            '80_งานกิจกรรมกลาง/2569/' +
            '2569-09-03_กิจกรรม',
        };
      },
    },
  };

  const req = request(
    '/v1/archive',
    ticket('manager')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    archiveContext
  );

  assert.equal(result.status, 200);
  assert.equal(
    result.body.archived.name,
    '2569-09-03_กิจกรรม'
  );
});

test('admin can archive activity', async () => {
  let called = false;

  const archiveContext = {
    ...context,

    managerService: {
      async archiveActivity() {
        called = true;

        return {
          name: 'activity',
          source: 'source',
          destination: 'destination',
        };
      },
    },
  };

  const req = request(
    '/v1/archive',
    ticket('admin')
  );

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    archiveContext
  );

  assert.equal(result.status, 200);
  assert.equal(called, true);
});

test('archive requires JSON body', async () => {
  const req = request(
    '/v1/archive',
    ticket('manager')
  );

  req.method = 'POST';

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 400);
});

test('archive requires authentication', async () => {
  const req = request('/v1/archive');

  req.method = 'POST';

  req.body = {
    topic: '80_งานกิจกรรมกลาง',
    year: '2569',
    activityName:
      '2569-09-03_กิจกรรม',
  };

  const result = await handleHttpRequest(
    req,
    context
  );

  assert.equal(result.status, 401);
});



test('authenticated user can upload directly to organization', async () => {
  const organizationContext = {
    ...context,

    uploadService: {
      async uploadToOrganization(input) {
        assert.equal(
          input.filename,
          'logo.png'
        );

        assert.equal(
          Buffer.isBuffer(input.content),
          true
        );

        return {
          name: 'logo.jpg',
          path: '90_ภาพองค์กร/logo.jpg',
          mime: 'image/jpeg',
          size: input.content.length,
        };
      },
    },
  };

  const req = request(
    '/v1/organization/uploads?filename=' +
      encodeURIComponent('logo.png'),
    ticket()
  );

  req.method = 'POST';

  req.body = Buffer.from([
    0xff, 0xd8, 0xff,
  ]);

  const result =
    await handleHttpRequest(
      req,
      organizationContext
    );

  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);

  assert.equal(
    result.body.file.path,
    '90_ภาพองค์กร/logo.jpg'
  );
});

test('organization upload requires authentication', async () => {
  const req = request(
    '/v1/organization/uploads?filename=logo.jpg'
  );

  req.method = 'POST';

  req.body = Buffer.from([
    0xff, 0xd8, 0xff,
  ]);

  const result =
    await handleHttpRequest(
      req,
      context
    );

  assert.equal(result.status, 401);
});
