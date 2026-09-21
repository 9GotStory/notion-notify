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
