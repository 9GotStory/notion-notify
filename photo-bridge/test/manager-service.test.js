import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ManagerConflictError,
  ManagerNotFoundError,
  ManagerService,
} from '../src/manager-service.js';

import { WebDavError } from '../src/webdav-client.js';

const INBOX = '00_INBOX_รอจัดหมวด';
const TOPIC = '80_งานกิจกรรมกลาง';
const YEAR = '2569';

const ACTIVITY =
  '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง';

const FILENAME =
  '20260921T081228Z_abcd1234_IMG_0001.jpg';

function archiveService() {
  return {
    async listActivities(topic, year) {
      assert.equal(topic, TOPIC);
      assert.equal(year, YEAR);

      return [
        {
          name: ACTIVITY,
          path: `${TOPIC}/${YEAR}/${ACTIVITY}`,
        },
      ];
    },
  };
}

test('manager move maps Inbox file to existing activity', async () => {
  let captured;

  const service = new ManagerService({
    inboxName: INBOX,
    archiveService: archiveService(),

    dav: {
      async move(source, destination, options) {
        captured = {
          source,
          destination,
          options,
        };

        return true;
      },
    },
  });

  const result = await service.moveFromInbox({
    filename: FILENAME,
    topic: TOPIC,
    year: YEAR,
    activityName: ACTIVITY,
  });

  assert.equal(
    captured.source,
    `${INBOX}/${FILENAME}`
  );

  assert.equal(
    captured.destination,
    `${TOPIC}/${YEAR}/${ACTIVITY}/${FILENAME}`
  );

  assert.deepEqual(
    captured.options,
    {
      overwrite: false,
    }
  );

  assert.equal(
    result.destination,
    captured.destination
  );
});

test('manager move rejects unsafe Inbox filename before WebDAV', async () => {
  let listed = false;
  let moved = false;

  const service = new ManagerService({
    inboxName: INBOX,

    archiveService: {
      async listActivities() {
        listed = true;
        return [];
      },
    },

    dav: {
      async move() {
        moved = true;
      },
    },
  });

  await assert.rejects(
    () => service.moveFromInbox({
      filename: '../secret.jpg',
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
    }),
    /Invalid Inbox filename/
  );

  assert.equal(listed, false);
  assert.equal(moved, false);
});

test('manager move rejects unknown destination activity', async () => {
  let moved = false;

  const service = new ManagerService({
    inboxName: INBOX,

    archiveService: {
      async listActivities() {
        return [];
      },
    },

    dav: {
      async move() {
        moved = true;
      },
    },
  });

  await assert.rejects(
    () => service.moveFromInbox({
      filename: FILENAME,
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
    }),
    /Activity does not exist/
  );

  assert.equal(moved, false);
});

test('missing Inbox source maps to 404', async () => {
  const service = new ManagerService({
    inboxName: INBOX,
    archiveService: archiveService(),

    dav: {
      async move() {
        throw new WebDavError(
          'not found',
          404
        );
      },
    },
  });

  await assert.rejects(
    () => service.moveFromInbox({
      filename: FILENAME,
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
    }),
    (error) => {
      assert.equal(
        error instanceof ManagerNotFoundError,
        true
      );

      assert.equal(error.statusCode, 404);

      return true;
    }
  );
});

test('existing destination maps to 409 conflict', async () => {
  const service = new ManagerService({
    inboxName: INBOX,
    archiveService: archiveService(),

    dav: {
      async move() {
        throw new WebDavError(
          'precondition failed',
          412
        );
      },
    },
  });

  await assert.rejects(
    () => service.moveFromInbox({
      filename: FILENAME,
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
    }),
    (error) => {
      assert.equal(
        error instanceof ManagerConflictError,
        true
      );

      assert.equal(error.statusCode, 409);

      return true;
    }
  );
});
