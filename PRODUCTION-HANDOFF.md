# คู่มือเตรียม production และส่งมอบระบบ

เอกสารนี้เป็นจุดเริ่มต้นของเจ้าของระบบ, HR, ผู้ดูแล และทีมเทคนิคก่อนเปิดใช้งานจริง ใช้เป็น checklist และ decision record ได้ แต่ไม่แทนเอกสารอนุมัติภายในองค์กร

สถานะปัจจุบัน: เจ้าของระบบเลือก direct mode และยอมรับความเสี่ยงจากการไม่ใช้ gateway เนื่องจากขอบเขตข้อมูล/ผู้ใช้ที่กำหนด โค้ดและ automated tests พร้อมสำหรับการทดสอบ/นำร่อง แต่ยังต้องตรวจตัวตนผู้ลงทะเบียน, shared admin token, นโยบายวันลา, backup และการติดตาม Apps Script ตามขอบเขตที่ยอมรับ

## 1. วิธีใช้เอกสารนี้

1. แต่งตั้งเจ้าของของแต่ละ gate ตามตารางบทบาท
2. ทำ Gate 0 เพื่อยืนยัน baseline และสำรองข้อมูล
3. ปิด Gate 1–4 โดยแต่ละ gate ต้องมีผลทดสอบและหลักฐาน ไม่ใช่เพียงระบุว่า “ทำแล้ว”
4. ทำ rehearsal ใน environment ทดสอบก่อน cutover จริง
5. ประชุม Go/No-Go และลงชื่อผู้ตัดสินใจ
6. deploy direct mode ตาม [SETUP.md](SETUP.md); [SECURITY-DEPLOYMENT.md](SECURITY-DEPLOYMENT.md) ใช้เมื่อเลือกเพิ่ม gateway ในอนาคต
7. เฝ้าระวัง 72 ชั่วโมงแรกและส่งมอบงานประจำตาม [USER-ADMIN-GUIDE.md](USER-ADMIN-GUIDE.md)

สัญลักษณ์สถานะที่แนะนำ: `ยังไม่เริ่ม`, `กำลังทำ`, `รอตัดสินใจ`, `รอหลักฐาน`, `ผ่าน`, `ยอมรับความเสี่ยง`, `ไม่ผ่าน`

## 2. เจ้าของงานและอำนาจตัดสินใจ

| งาน | Responsible — ผู้ลงมือ | Accountable — ผู้อนุมัติสุดท้าย | Consulted | หลักฐานขั้นต่ำ |
|---|---|---|---|---|
| ตัวตนผู้ลงทะเบียน | ทีมพัฒนา/ผู้ดูแลบุคลากร | เจ้าของระบบ | HR, DPO/ความปลอดภัย | แบบทดสอบบัญชีจริง/ปลอมและ approval log |
| ตัวตนผู้ดูแล | ทีม cloud/identity | เจ้าของระบบความปลอดภัย | ทีมพัฒนา | SSO/IAP policy, named audit และ break-glass test |
| นโยบายวันลา | HR | ผู้มีอำนาจด้านบุคคล | กฎหมาย/ผู้ดูแลระบบ | ตารางอ้างอิง, วันที่มีผล, ผู้อนุมัติ และ `leave_policy_reviewed_at` |
| Cloud operations | ทีม platform/ผู้ดูแลเทคนิค | เจ้าของบริการ | Security, DPO | dashboard, alert test, backup/restore และ incident contacts |
| Go/No-Go | ผู้ประสาน release | เจ้าของระบบ | ทุกบทบาทข้างต้น | checklist ลงชื่อและเวลา cutover |

บุคคลเดียวไม่ควรอนุมัติทั้งการเปลี่ยนโค้ดและการยอมรับความเสี่ยงสำคัญโดยไม่มีผู้ตรวจอีกคน

## 3. Gate 0 — ยืนยัน baseline และขอบเขต

เจ้าของ: ผู้ดูแลเทคนิค

### สิ่งที่ต้องเตรียม

- รายชื่อ environment: test/pilot/production พร้อม owner
- Apps Script deployment ID/URL ทั้งสองโปรเจกต์ เก็บใน secret inventory ไม่ใช่ repository
- LINE Provider/channel, LIFF IDs, Notion databases, Google Sheet และ GitHub Environment ที่ใช้งานจริง
- รายการ secret พร้อมสถานที่เก็บ ผู้ดูแล และวันที่หมุนล่าสุด โดยไม่คัดลอกค่าจริงลง checklist
- เวลา maintenance window และช่องทางประกาศผู้ใช้

### ขั้นตอน

1. หยุดการเปลี่ยน schema/นโยบายที่ไม่เกี่ยวข้องระหว่างเตรียม release
2. บันทึก commit SHA และเวอร์ชัน deployment ที่กำลังทดสอบ
3. สำรอง Settings, Holidays, Staff, ApprovalChains, LeaveBalances และ QuotaProfiles
4. ส่งออกหรือสำรอง Notion databases ตามนโยบาย retention ขององค์กร
5. รัน verification:

```bash
node scripts/check-syntax.js
node scripts/test-apps-script.js
cd gateway && npm test
```

6. ตรวจ `git diff --check` และ secret scan ขององค์กร
7. ตรวจว่า test data แยกจาก production และไม่มีการทดสอบส่งข้อความเข้ากลุ่มจริงโดยไม่แจ้งล่วงหน้า

### เกณฑ์ผ่าน

- ทุก test ผ่านจาก commit เดียวกับที่จะ deploy
- ระบุ rollback version และผู้มีสิทธิ์ rollback ได้
- กู้คืน backup ตัวอย่างในพื้นที่ทดสอบได้
- inventory ระบุเจ้าของทุก integration และไม่มี secret อยู่ในเอกสารนี้

## 4. Gate 1 — ตัวตนผู้ลงทะเบียน

สถานะโค้ดปัจจุบัน: ผู้เปิด LIFF สามารถกรอกชื่อ กลุ่มงาน และประเภทบุคลากรเองได้ การแจ้งผู้ดูแลหลังลงทะเบียนช่วยตรวจพบแต่ไม่ใช่การป้องกันก่อนใช้งาน จึงยังไม่ใช่ production control ที่เพียงพอ

เจ้าของการตัดสินใจ: เจ้าของระบบร่วมกับ HR/ฝ่ายความปลอดภัย

### 4.1 เลือกรูปแบบควบคุม

| ทางเลือก | เหมาะกับ | ข้อกำหนด | คำแนะนำ |
|---|---|---|---|
| Allowlist + อนุมัติการผูก LINE | หน่วยงานขนาดเล็ก/เริ่มต้น | มีทำเนียบที่เชื่อถือได้และผู้อนุมัติ | ตัวเลือกเริ่มต้นที่เล็กและตรวจสอบได้ |
| Activation code รายบุคคล | ไม่มี SSO แต่แจก code ผ่านช่องทางยืนยันตัวตนได้ | code ใช้ครั้งเดียว มีวันหมดอายุ และไม่เก็บ plaintext | ใช้ได้เมื่อกระบวนการแจก code เข้มแข็ง |
| องค์กร SSO | มี identity provider พร้อมแล้ว | mapping identity กับรหัสบุคลากรและ lifecycle offboarding | เหมาะระยะยาวที่สุด |
| ตรวจย้อนหลังจากข้อความแจ้งเตือน | pilot จำกัดวง/ข้อมูลจำลอง | เอกสารยอมรับความเสี่ยงและวันสิ้นสุด | ไม่แนะนำสำหรับ production |

### 4.2 ข้อกำหนดขั้นต่ำของแบบ Allowlist + Approval

ทีมพัฒนาต้องออกแบบให้:

1. ทำเนียบมีรหัสบุคลากรที่ไม่เปลี่ยนตามชื่อ และเก็บสถานะ `active/inactive`
2. ผู้ใช้เลือก/ยืนยันได้เฉพาะ record ที่ยังไม่ถูกผูก หรือส่งคำขอให้ผู้ดูแลอนุมัติ
3. การผูกเก็บ LINE user ID, รหัสบุคลากร, เวลา, ผู้อนุมัติ, requestId และสถานะ
4. ห้าม LINE user เดียวผูกหลายคน หรือบุคลากรคนเดียวผูกหลายบัญชีโดยไม่มีขั้นตอน revoke/reapprove
5. การเปลี่ยนกลุ่มงาน/ประเภทบุคลากรเป็นสิทธิ์ผู้ดูแล ไม่รับค่าจาก client โดยตรงหลังอนุมัติ
6. ผู้พ้นสภาพถูกปิดใช้งานโดยไม่ลบ audit/history
7. มีขั้นตอนแก้กรณีเปลี่ยนบัญชี LINE ที่ revoke บัญชีเดิมก่อน
8. log ไม่เก็บ access token, activation code plaintext หรือข้อมูลส่วนบุคคลเกินจำเป็น

### 4.3 Acceptance tests

- บุคลากร active ที่ยังไม่ผูกส่งคำขอได้
- ชื่อที่ไม่มีใน allowlist ถูกปฏิเสธก่อนยื่นใบลา
- บัญชี A ไม่สามารถอ้างเป็นบุคลากรที่ผูกกับบัญชี B
- ผู้ดูแลที่ไม่มีสิทธิ์ไม่สามารถอนุมัติการผูก
- คำขออนุมัติซ้ำให้ผลเดิมและไม่สร้าง record ซ้ำ
- การ revoke ทำให้ session เดิมใช้ยื่น/แก้/ยกเลิกไม่ได้ในการเรียกครั้งถัดไป
- เปลี่ยนชื่อแสดงผลใน LINE แล้ว identity เดิมยังจับคู่ถูกต้อง
- audit ระบุผู้อนุมัติและก่อน/หลังโดยไม่มี token

### หลักฐานปิด gate

- เอกสารเลือกทางควบคุมและผู้อนุมัติ
- test report ของกรณีปกติ, duplicate, impersonation, revoke และ offboarding
- ตัวอย่าง audit ที่ปิดข้อมูลส่วนบุคคลแล้ว
- คู่มือผู้ดูแลเมื่อมีพนักงานเข้า/ย้าย/ออก

## 5. Gate 2 — ตัวตนผู้ดูแล

สถานะปัจจุบัน: หน้า Admin ใช้ shared `ADMIN_TOKEN` ใน `sessionStorage` และส่ง token ไป Apps Script ผ่าน query string ตาม direct mode ที่เจ้าของระบบยอมรับ audit ยังไม่สามารถแยกชื่อผู้ดูแลแต่ละคนได้

เจ้าของการตัดสินใจ: เจ้าของระบบความปลอดภัย/ทีม identity

### 5.1 รูปแบบ production ที่แนะนำ

วาง Admin SPA และ `/api/admin` หลัง identity-aware proxy หรือ SSO ซึ่ง:

1. บังคับ MFA ตามนโยบายองค์กร
2. อนุญาตเฉพาะกลุ่ม admin ที่กำหนด
3. ลบ identity header ที่ client ส่งมาเอง แล้ว inject identity จาก session ที่ proxy ตรวจแล้วเท่านั้น
4. ส่งรหัสผู้ใช้/อีเมลที่จำเป็นไปยัง gateway ผ่านช่องทางที่เชื่อถือได้
5. gateway ใส่ actor identity ใน signed envelope และ Apps Script บันทึกลง AuditLog
6. แยก role อย่างน้อย read-only, HR policy editor, staff/approver admin และ system admin หากจำนวนผู้ดูแลมากกว่ากลุ่มเล็ก
7. ปิดหรือจำกัด shared token หลัง migration

### 5.2 Break-glass account

- สร้างเฉพาะเมื่อองค์กรต้องการช่องทางฉุกเฉิน
- เก็บ credential ใน vault ที่ต้องมีผู้อนุมัติอย่างน้อยสองคนหรือมีการแจ้งเตือนเมื่อเปิดใช้
- กำหนดวันหมดอายุ/หมุนทันทีหลังใช้
- ทดสอบอย่างน้อยปีละครั้งโดยไม่เปิดเผยค่าใน log

### 5.3 Acceptance tests

- ผู้ไม่มี session ได้ 401/403 ก่อนถึง Apps Script
- ผู้ใช้ทั่วไปเข้า Admin ไม่ได้แม้รู้ URL
- client ปลอม identity header ไม่สามารถเปลี่ยน actor ใน audit
- เมื่อถอดผู้ใช้ออกจากกลุ่ม admin session ถูกเพิกถอนตามเวลาที่กำหนด
- การเพิ่ม/แก้/ลบข้อมูลทุกชนิดบันทึกชื่อ actor, action, entity, เวลา และ requestId
- shared token เก่าถูกปฏิเสธหลังปิด migration
- break-glass สร้าง alert และ audit ทุกครั้งที่ใช้

### หลักฐานปิด gate

- แผนภาพ trust boundary และ identity claims ที่อนุญาต
- รายชื่อกลุ่ม/role และผู้อนุมัติสมาชิก
- ผลทดสอบ header spoofing, removal/offboarding และ named audit
- ขั้นตอน break-glass และ rotation ที่ผ่านการอนุมัติ

## 6. Gate 3 — การรับรองนโยบายวันลา

เจ้าของ: HR; ทีมเทคนิคช่วยนำค่าที่รับรองแล้วเข้าระบบ แต่ไม่รับรองความถูกต้องทางกฎหมายแทน HR

### 6.1 เตรียมตารางตรวจ

HR ควรสร้างหนึ่งแถวต่อ:

`ประเภทบุคลากร × ประเภทการลา × ช่วงวันที่มีผล × เงื่อนไขสำคัญ`

แต่ละแถวควรมี:

- ชื่อระเบียบ/ประกาศ/สัญญา เลขที่และวันที่
- วันที่มีผลและวันที่สิ้นสุดถ้ามี
- หน่วยวันทำการหรือวันปฏิทิน
- เป็นเพดานรายปี รายเหตุการณ์ หรือตามสถานภาพ
- เงื่อนไขอายุงาน อายุ เหตุการณ์ เอกสารประกอบ หรือการได้รับค่าจ้าง
- จำนวนวันที่ใช้เป็น warning threshold ในระบบ
- ผู้ตรวจ ผู้อนุมัติ และวันที่อนุมัติ

อย่าเก็บเอกสารสุขภาพหรือข้อมูลส่วนบุคคลของพนักงานไว้ใน QuotaProfiles; เก็บเฉพาะกติกาและเอกสารอ้างอิง

### 6.2 นำค่าที่รับรองเข้าระบบ

1. รันเมนู **เตรียม/ตรวจสอบชีตทั้งหมด** ใน Google Sheet เพื่อสร้าง/migrate โครงสร้าง
2. rename Notion option เดิม `ลาอุปสมบถ/ลาบวช` เป็น `ลาอุปสมบท/ลาบวช` โดยห้ามลบแล้วสร้างใหม่
3. เปิดหน้า Admin > **สิทธิ์วันลา**
4. เทียบทุกแถวใน `QuotaProfiles` กับตารางที่ HR อนุมัติ
5. ใส่แถวปีว่างสำหรับนโยบายทั่วไป และแถวระบุปีงบประมาณเฉพาะเมื่อมี effective-period exception (ปีงบประมาณเริ่ม 1 ต.ค. และเรียกตามปีที่สิ้นสุด)
6. ลบ/รวมแถวซ้ำอย่างระมัดระวัง หากมีคำสะกดเก่าและใหม่พร้อมกันให้เก็บค่าที่ HR ยืนยันเพียงแถวเดียว
7. ตรวจประเภทบุคลากรของทุกคนในหน้า **บุคลากร**
8. ตรวจรายการ `LeaveBalances` โดยเฉพาะยอดยกมาและยอดใช้ตั้งแต่ 1 ตุลาคมถึงวันก่อนเริ่มระบบ
9. รันเมนู **ตรวจใบลาคร่อมปีงบประมาณ**; ถ้าพบใบเดิม ให้ HR แยกเป็นใบสิ้นสุด 30 กันยายนและใบเริ่ม 1 ตุลาคมก่อนคำนวณยอด
10. เมื่อ HR ตรวจครบจริง ให้ตั้ง Settings `leave_policy_reviewed_at` เป็นวันที่ ค.ศ. รูปแบบ `YYYY-MM-DD`
11. โหลดหน้า **ภาพรวม** และยืนยันว่าไม่มีคำเตือน policy review

### 6.3 Acceptance tests

- สุ่มอย่างน้อยหนึ่งคนต่อประเภทบุคลากรและหนึ่งใบต่อประเภทลา
- ตรวจวันหยุด/สุดสัปดาห์สำหรับวันทำการ
- ตรวจลาคลอด/บวชว่าตัดสิทธิ์วันปฏิทินแต่รายงานกำลังคนยังเป็นวันทำการ
- ตรวจใบคร่อม 30 ก.ย./1 ต.ค. ถูกปฏิเสธ แต่ใบคร่อม 31 ธ.ค./1 ม.ค. อยู่ใบเดียวได้
- ตรวจ quota เฉพาะปีงบประมาณทับค่า default ถูกต้อง
- ตรวจ `0` หมายถึงไม่มีสิทธิ์เฉพาะแถวที่ HR ยืนยัน
- ตรวจประเภท manual-event แสดง “ตรวจรายกรณี” และไม่สร้างยอดคงเหลือรายปีที่ทำให้เข้าใจผิด
- เทียบผลรวมใบอนุมัติใน Notion + ยกมา/ใช้เพิ่มกับตัวอย่างที่ HR คำนวณมือ

### หลักฐานปิด gate

- policy matrix ที่มี version/effective date
- รายงานผลสุ่มทดสอบและผู้ตรวจ
- export QuotaProfiles/LeaveBalances หลังอนุมัติ
- ค่า `leave_policy_reviewed_at` และกำหนดวันทบทวนครั้งถัดไป

## 7. Gate 4 — Direct-mode operations และความพร้อมรับเหตุการณ์

เจ้าของ: ทีม platform/ผู้ดูแลเทคนิค

### 7.1 Direct-mode controls

1. บันทึกการยอมรับว่า direct mode ไม่มีการตรวจ raw `X-Line-Signature`, CORS allowlist หรือ WAF/rate limit
2. ตั้ง `ALLOW_LEGACY_DIRECT=TRUE` เฉพาะ Apps Script deployments ที่ใช้งานจริง
3. ใช้ `ADMIN_TOKEN` แบบสุ่มอย่างน้อย 32 ตัวอักษร เก็บใน Script Properties และหมุนตามรอบ
4. เก็บ Apps Script URLs ใน GitHub Environment ไม่ commit ลง repository หรือเอกสารสาธารณะ
5. ตรวจ Apps Script quota, Executions, Logs, `SecurityEvents` และ `AuditLog` ตามรอบที่กำหนด
6. จำกัดผู้เข้าถึง GitHub Environment, Apps Script projects, Google Sheet และ Notion integrations

### 7.2 Logging และ alerts

เปิด structured log และสร้าง alert อย่างน้อยสำหรับ:

- Apps Script execution error หรือ timeout เพิ่มผิดปกติ
- คำขอ `UNAUTHORIZED` หรือ `GATEWAY_REQUIRED` เพิ่มผิดปกติ
- notification เข้าสถานะ `ต้องตรวจสอบ`
- Apps Script quota/execution failure
- trigger หายหรือเวลาส่งครั้งถัดไปไม่พร้อม

ทดสอบ alert ทุกช่องทางและบันทึกว่าใครเป็น primary/backup on-call รวมเวลาที่คาดว่าจะตอบสนอง

### 7.3 Backup และ restore

1. กำหนด RPO/RTO และ retention ที่เจ้าของระบบยอมรับ
2. สำรอง Google Sheet และ Notion ตาม capability/นโยบายองค์กร
3. เก็บ deployment configuration และ schema documentation แยกจาก secret values
4. ทดสอบ restore ในพื้นที่แยก ห้าม restore ทับ production ระหว่างการซ้อม
5. ตรวจจำนวน Staff, QuotaProfiles, LeaveBalances, Holidays และตัวอย่างใบลาเทียบก่อน/หลัง
6. บันทึกเวลา restore, ข้อมูลที่สูญได้ และปัญหาที่พบ

### 7.4 Secret rotation

สร้างทะเบียนที่มีชื่อ secret, owner, storage, วันที่หมุนล่าสุด/ถัดไป และระบบที่ได้รับผลกระทบ โดยไม่เก็บค่าจริง การหมุน `ADMIN_TOKEN` หรือ LINE/Notion token ต้องมี maintenance window และ smoke test หลังเปลี่ยน

หมุนทันทีเมื่อสงสัยว่ารั่ว, ผู้ดูแลพ้นหน้าที่, vault policy เปลี่ยน หรือ log แสดงการใช้งานผิดปกติ

### 7.5 Incident และ rollback

กำหนด severity และผู้มีอำนาจหยุดระบบ ตัวอย่าง trigger rollback:

- ยื่นใบซ้ำหรือยอดสิทธิ์ผิดหลายรายการ
- ผู้ไม่มีสิทธิ์เข้าถึงหน้า Admin หรือข้อมูลใบลา
- Apps Script quota เต็มหรือ execution error ต่อเนื่อง
- deploy แล้ว schema/config ไม่ตรงจนข้อมูลถูกเขียนผิด

เมื่อเกิด incident:

1. หยุดการเปลี่ยนแปลงและบันทึกเวลา/commit/deployment
2. ป้องกันผลกระทบเพิ่ม เช่น ปิด feature หรือ rollback ตามอำนาจที่อนุมัติไว้
3. เก็บ log ด้วย requestId โดยไม่คัดลอก secret
4. แจ้งเจ้าของระบบ/ความปลอดภัย/HR ตามชนิดข้อมูลที่ได้รับผล
5. rollback Apps Script deployment และ GitHub Pages ตามเวอร์ชันที่บันทึกไว้ใน Gate 0
6. ตรวจความถูกต้องข้อมูลหลัง rollback และบันทึก corrective actions

### หลักฐานปิด gate

- URL dashboard/monitor ที่ผู้เกี่ยวข้องเข้าถึงได้
- ผลทดสอบ Apps Script quota/execution alert
- restore report ล่าสุด
- secret inventory ที่ไม่มีค่าลับ
- incident/rollback contact tree และผล tabletop exercise

## 8. Rehearsal ก่อน production

ใช้ข้อมูลทดสอบที่ไม่ใช่ข้อมูลบุคลากรจริง และทำครบเส้นทาง:

1. ผู้ใช้ใหม่ผ่าน identity/approval control
2. ยื่นใบปกติ, ครึ่งวัน, วันหยุด, ช่วงไม่มีวันทำการ, วันปฏิทิน และข้ามปี
3. กดส่งซ้ำด้วย Request ID เดิม ต้องมีใบเดียว
4. ผู้อนุมัติถูกคนกดได้ ผู้ใช้อื่นกดไม่ได้
5. แก้ไขและยกเลิกแข่งกับการอนุมัติ ต้องไม่เกิดสถานะหรือยอดซ้ำ
6. เปลี่ยน quota/ประเภทบุคลากรพร้อมกันสองหน้า ต้องมีหน้าหนึ่งได้รับ conflict ไม่เขียนทับเงียบๆ
7. LINE ส่งไม่สำเร็จ ต้องเข้า retry และ dead-letter ตามจำนวนครั้ง
8. ทดสอบ admin token ผิด, `ALLOW_LEGACY_DIRECT` หาย, URL deployment ผิด และคำขอซ้ำ
9. ทดสอบ backup/restore และ rollback deployment
10. ให้ผู้ใช้ ผู้อนุมัติ HR และ admin ลงชื่อว่า workflow/ข้อความภาษาไทยเข้าใจได้

บันทึกแต่ละกรณีด้วย expected result, actual result, ผู้ทดสอบ, เวลา, environment, commit SHA และหลักฐานที่ปิดข้อมูลส่วนบุคคลแล้ว

## 9. ลำดับ deploy direct mode

1. ประกาศ maintenance window และยืนยันผู้ rollback
2. สำรองข้อมูลและบันทึก deployment versions ปัจจุบัน
3. ตั้ง `ALLOW_LEGACY_DIRECT=TRUE` ใน Apps Script ทั้งสองโปรเจกต์
4. deploy Apps Script หลักและ webapp เป็น version ใหม่บน deployment เดิม
5. ยืนยัน GitHub Environment `liff` มี `LIFF_ID`, `API_URL` และ `ADMIN_API_URL`
6. ชี้ LINE Webhook URL ไป `/exec` ของ Apps Script หลักและกด Verify
7. เปิดและรัน workflow `Deploy web pages`
8. ทดสอบ LIFF, ตาราง, Admin, รายงาน และ LINE webhook โดยตรง
9. หลังเปลี่ยน `notify_time` ให้กดเมนูติดตั้ง/อัปเดต trigger ใน Google Sheet
10. บันทึกเวลา, commit, deployment versions, ผู้ดำเนินการ, ผลทดสอบ และความเสี่ยง direct mode ที่ยอมรับ

หากเลือกเพิ่ม gateway ในอนาคต ให้ใช้ลำดับ cutover ใน [SECURITY-DEPLOYMENT.md](SECURITY-DEPLOYMENT.md)

## 10. Go/No-Go checklist

| รายการ | สถานะ | เจ้าของ | หลักฐาน/ลิงก์ | วันที่ |
|---|---|---|---|---|
| Gate 0 baseline/backup ผ่าน |  |  |  |  |
| Gate 1 identity ผู้ลงทะเบียนผ่าน |  |  |  |  |
| Gate 2 identity ผู้ดูแลผ่าน |  |  |  |  |
| Gate 3 HR policy ผ่าน |  |  |  |  |
| Gate 4 operations ผ่าน |  |  |  |  |
| Direct mode risk acceptance บันทึกแล้ว | ยอมรับความเสี่ยง | เจ้าของระบบ | ไม่มี gateway; จำกัดขอบเขตข้อมูล/ผู้ใช้ |  |
| Rehearsal และ rollback ผ่าน |  |  |  |  |
| Privacy/security review อนุมัติ |  |  |  |  |
| User/admin documentation อัปเดต |  |  |  |  |
| Maintenance/communication พร้อม |  |  |  |  |
| เจ้าของระบบตัดสินใจ Go |  |  |  |  |

หากเลือก `ยอมรับความเสี่ยง` ต้องระบุความเสี่ยง ขอบเขตผู้ใช้/ข้อมูล มาตรการชั่วคราว เจ้าของ วันที่หมดอายุ และงานแก้ถาวร ห้ามใช้สถานะนี้โดยไม่มีกำหนดสิ้นสุด

## 11. 72 ชั่วโมงแรกหลังเปิดใช้งาน

### ทันทีหลัง cutover

- ตรวจ Apps Script Executions, LINE delivery, trigger และ audit/security events
- ให้ผู้ใช้ทดสอบอย่างน้อยหนึ่งคนต่อกลุ่มงาน
- ตรวจใบลาใน Notion, ยอดสิทธิ์ และผู้อนุมัติปลายทาง

### ภายใน 24 ชั่วโมง

- ตรวจการลงทะเบียนทั้งหมดเทียบ identity source
- ตรวจ notification retry/dead-letter และ upstream error
- ตรวจว่า client ทั้งสามหน้าเรียก Apps Script deployment ที่ถูกต้อง
- ตรวจปริมาณ Apps Script executions เทียบ baseline

### ภายใน 72 ชั่วโมง

- ประชุมสรุป incident/near miss และคำไทยที่ผู้ใช้เข้าใจผิด
- ปิด defect ที่กระทบข้อมูล/สิทธิ์ก่อนเพิ่มจำนวนผู้ใช้
- ยืนยัน backup รอบแรกและการเข้าถึง dashboard ของ on-call
- ส่งมอบงานประจำตาม [USER-ADMIN-GUIDE.md](USER-ADMIN-GUIDE.md)

## 12. แบบฟอร์มส่งมอบ

บันทึกข้อมูลต่อไปนี้ในระบบเอกสารภายในที่ควบคุมสิทธิ์:

```text
ชื่อบริการ:
Production URL (ไม่รวม secret/query):
Commit SHA:
Apps Script main version:
Apps Script admin version:
Gateway image digest/version:
วันที่และเวลา cutover:
ผู้ดำเนินการ:
ผู้อนุมัติ Go:
Rollback version:
Primary/backup on-call:
Dashboard/alert location:
Backup ล่าสุด / restore test ล่าสุด:
Policy review date / next review:
Known risks + owner + expiry:
ลิงก์ test evidence:
ลิงก์ incident/rollback runbook:
```

อย่าใส่ token, secret, activation code หรือ credential ลงแบบฟอร์ม ให้ระบุชื่อ secret record ใน vault แทน
