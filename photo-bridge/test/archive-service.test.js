import test from 'node:test';
import assert from 'node:assert/strict';

import { ArchiveService } from '../src/archive-service.js';

function serviceWithFolders(folders) {
  return new ArchiveService({
    dav: {
      async listFolders() {
        return folders.map((name) => ({
          name,
          path: name,
        }));
      },
    },
  });
}

test('selectable topics exclude inbox and archive', async () => {
  const service = serviceWithFolders([
    '00_INBOX_รอจัดหมวด',
    '01_งานบริหารทั่วไป',
    '08_งานคุ้มครองผู้บริโภค',
    '80_งานกิจกรรมกลาง',
    '90_ภาพองค์กร',
    '99_ARCHIVE_คลังภาพเก่า',
  ]);

  const topics = await service.listSelectableTopics();

  assert.deepEqual(
    topics.map((item) => item.name),
    [
      '01_งานบริหารทั่วไป',
      '08_งานคุ้มครองผู้บริโภค',
      '80_งานกิจกรรมกลาง',
      '90_ภาพองค์กร',
    ]
  );
});

test('topic response includes classification', async () => {
  const service = serviceWithFolders([
    '80_งานกิจกรรมกลาง',
    '90_ภาพองค์กร',
  ]);

  const topics = await service.listSelectableTopics();

  assert.deepEqual(topics, [
    {
      name: '80_งานกิจกรรมกลาง',
      path: '80_งานกิจกรรมกลาง',
      type: 'topic',
    },
    {
      name: '90_ภาพองค์กร',
      path: '90_ภาพองค์กร',
      type: 'organization',
    },
  ]);
});

test('unknown top-level folders are not exposed', async () => {
  const service = serviceWithFolders([
    'TEMP',
    '12_หมวดที่ไม่ได้กำหนด',
    '01_งานบริหารทั่วไป',
  ]);

  const topics = await service.listSelectableTopics();

  assert.deepEqual(
    topics.map((item) => item.name),
    ['01_งานบริหารทั่วไป']
  );
});

test('activities are returned newest first', async () => {
  const dav = {
    async listFolders(path = '') {
      if (path === '') {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
          },
        ];
      }

      if (path === '80_งานกิจกรรมกลาง/2569') {
        return [
          {
            name: '2569-01-15_กิจกรรมแรก',
            path:
              '80_งานกิจกรรมกลาง/2569/2569-01-15_กิจกรรมแรก',
          },
          {
            name: '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
            path:
              '80_งานกิจกรรมกลาง/2569/2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
          },
          {
            name: 'TEMP',
            path:
              '80_งานกิจกรรมกลาง/2569/TEMP',
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    },
  };

  const service = new ArchiveService({ dav });

  const activities = await service.listActivities(
    '80_งานกิจกรรมกลาง',
    '2569'
  );

  assert.deepEqual(
    activities.map((item) => item.name),
    [
      '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง',
      '2569-01-15_กิจกรรมแรก',
    ]
  );
});

test('missing year folder returns empty activities', async () => {
  const { WebDavError } =
    await import('../src/webdav-client.js');

  const dav = {
    async listFolders(path = '') {
      if (path === '') {
        return [
          {
            name: '01_งานบริหารทั่วไป',
            path: '01_งานบริหารทั่วไป',
          },
        ];
      }

      throw new WebDavError('not found', 404);
    },
  };

  const service = new ArchiveService({ dav });

  const activities = await service.listActivities(
    '01_งานบริหารทั่วไป',
    '2568'
  );

  assert.deepEqual(activities, []);
});

test('invalid Buddhist year is rejected', async () => {
  const service = serviceWithFolders([
    '80_งานกิจกรรมกลาง',
  ]);

  await assert.rejects(
    () => service.listActivities(
      '80_งานกิจกรรมกลาง',
      '2026-09'
    ),
    /Buddhist year/
  );
});

test('unknown topic is rejected', async () => {
  const service = serviceWithFolders([
    '80_งานกิจกรรมกลาง',
  ]);

  await assert.rejects(
    () => service.listActivities(
      '12_ไม่มีหมวดนี้',
      '2569'
    ),
    /Unknown/
  );
});

test('organization destination does not use activities', async () => {
  const service = serviceWithFolders([
    '90_ภาพองค์กร',
  ]);

  await assert.rejects(
    () => service.listActivities(
      '90_ภาพองค์กร',
      '2569'
    ),
    /does not use activities/
  );
});

test('create activity creates year and activity folders', async () => {
  const created = [];

  const dav = {
    async listFolders(path = '') {
      if (path === '') {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
          },
        ];
      }

      return [];
    },

    async createFolder(path) {
      created.push(path);
      return true;
    },
  };

  const service = new ArchiveService({ dav });

  const result = await service.createActivity(
    '80_งานกิจกรรมกลาง',
    '2569',
    '2569-09-21_ทดสอบ Photo Bridge'
  );

  assert.equal(result.created, true);

  assert.deepEqual(created, [
    '80_งานกิจกรรมกลาง/2569',
    '80_งานกิจกรรมกลาง/2569/2569-09-21_ทดสอบ Photo Bridge',
  ]);
});

test('create activity is idempotent when folders already exist', async () => {
  const { WebDavError } =
    await import('../src/webdav-client.js');

  const activity =
    '2569-09-21_ทดสอบ Photo Bridge';

  const dav = {
    async createFolder() {
      throw new WebDavError('already exists', 405);
    },

    async listFolders(path = '') {
      if (path === '') {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
          },
        ];
      }

      if (path === '80_งานกิจกรรมกลาง') {
        return [
          {
            name: '2569',
            path: '80_งานกิจกรรมกลาง/2569',
          },
        ];
      }

      if (path === '80_งานกิจกรรมกลาง/2569') {
        return [
          {
            name: activity,
            path:
              `80_งานกิจกรรมกลาง/2569/${activity}`,
          },
        ];
      }

      return [];
    },
  };

  const service = new ArchiveService({ dav });

  const result = await service.createActivity(
    '80_งานกิจกรรมกลาง',
    '2569',
    activity
  );

  assert.equal(result.created, false);
  assert.equal(result.activity.name, activity);
});

test('activity year must match selected year', async () => {
  const service = serviceWithFolders([
    '80_งานกิจกรรมกลาง',
  ]);

  await assert.rejects(
    () => service.createActivity(
      '80_งานกิจกรรมกลาง',
      '2569',
      '2568-09-21_ปีไม่ตรงกัน'
    ),
    /does not match/
  );
});

test('invalid activity name is rejected before WebDAV write', async () => {
  let wrote = false;

  const dav = {
    async listFolders() {
      return [];
    },

    async createFolder() {
      wrote = true;
    },
  };

  const service = new ArchiveService({ dav });

  await assert.rejects(
    () => service.createActivity(
      '80_งานกิจกรรมกลาง',
      '2569',
      '../bad'
    ),
    /Invalid activity/
  );

  assert.equal(wrote, false);
});
