# Security gateway deployment และ migration

> สถานะปัจจุบันเลือก direct mode และยังไม่ deploy gateway เอกสารนี้เก็บไว้เป็น runbook ทางเลือกหากเจ้าของระบบเปลี่ยนไปใช้ gateway ในอนาคต

เอกสารนี้เป็น runbook ทางเทคนิคในช่วง cutover ก่อนเริ่มต้องปิด acceptance gates, ระบุเจ้าของงาน และทำ rehearsal ตาม [PRODUCTION-HANDOFF.md](PRODUCTION-HANDOFF.md) ส่วนขั้นตอนใช้งานประจำวันหลังส่งมอบอยู่ใน [USER-ADMIN-GUIDE.md](USER-ADMIN-GUIDE.md)

เอกสารนี้เป็น runbook สำหรับเปลี่ยน production จากการเรียก Apps Script โดยตรงเป็นเส้นทาง:

```text
LINE webhook ─┐
LIFF / ตาราง ─┼─ HTTPS gateway ─ signed envelope ─ Apps Script หลัก
Admin SPA ────┘                              └───── Apps Script webapp
```

gateway ตรวจ raw `X-Line-Signature`, จำกัด origin, จำกัด request body, ไม่ cache response และส่ง request ที่ลงลายเซ็น HMAC พร้อม timestamp/nonce ไป backend ส่วน Apps Script ปฏิเสธ nonce ซ้ำและเก็บ security/audit log แบบ durable ในชีตที่ซ่อน

## 1. เตรียมก่อน cutover

1. สำรองค่าตั้งค่าและจด URL deployment เดิมของ Apps Script ทั้งสองโปรเจกต์ โดยไม่คัดลอก secret ลง log หรือ ticket สาธารณะ
2. ใน Notion database `ใบลา` เพิ่ม property:
   - `Request ID` ชนิด Text
   - `สถานะการแจ้ง` ชนิด Select โดยมี `รอแจ้ง`, `แจ้งแล้ว`, `แจ้งไม่สำเร็จ`, `ต้องตรวจสอบ`
3. ตั้ง `ALLOW_LEGACY_DIRECT=TRUE` ชั่วคราวใน Script Properties ของ Apps Script ทั้งสองโปรเจกต์ **ก่อน** deploy โค้ดรุ่นนี้ เพราะรุ่นใหม่ปฏิเสธ direct request โดยปริยาย
4. ในโปรเจกต์ webapp ตั้ง `SPREADSHEET_ID` เป็นรหัสของชีตหลัก
5. push และ deploy Apps Script ทั้งสองโปรเจกต์เป็น version ใหม่บน deployment เดิม
6. สร้างค่าสุ่มสำหรับ `GATEWAY_SHARED_SECRET` อย่างน้อย 32 ตัวอักษร เช่น `openssl rand -hex 32` เก็บใน secret manager เท่านั้น

## 2. Deploy gateway

build จาก `gateway/Dockerfile` แล้ว deploy บนบริการ container ที่มี HTTPS และตั้ง environment:

| ตัวแปร | ค่า |
|---|---|
| `LINE_CHANNEL_SECRET` | Channel secret ของ Messaging API |
| `GATEWAY_SHARED_SECRET` | ค่าสุ่มเดียวกับ Script Properties ของ backend |
| `MAIN_APPS_SCRIPT_URL` | URL `/exec` ของ Apps Script หลัก |
| `ADMIN_APPS_SCRIPT_URL` | URL `/exec` ของ Apps Script webapp |
| `ALLOWED_ORIGINS` | origin ของ GitHub Pages แบบไม่มี path เช่น `https://9gotstory.github.io` |
| `PORT` | ไม่ต้องตั้งถ้า runtime กำหนดให้; ค่าเริ่มต้น 8080 |

จำกัด ingress ด้วย rate limit/WAF ของผู้ให้บริการ, เปิด structured log/alert, ใช้ secret manager และให้ runtime service account มีสิทธิ์เท่าที่จำเป็น ภาพ container รันด้วย non-root user อยู่แล้ว

ตรวจ `GET https://<gateway>/health` ต้องได้ `{"ok":true}` ก่อนดำเนินการต่อ

## 3. Cutover แบบลด downtime

1. ยืนยันว่า `ALLOW_LEGACY_DIRECT=TRUE` ยังตั้งอยู่ใน Apps Script ทั้งสองโปรเจกต์จากขั้นเตรียม
2. ตั้ง `GATEWAY_SHARED_SECRET` ค่าเดียวกันในทั้งสองโปรเจกต์ ช่วงนี้ endpoint เดิมและ gateway ใช้ได้พร้อมกัน
3. ทดสอบ gateway ด้วยบัญชีทดสอบ: เปิด LIFF, โหลดตาราง, เข้าสู่ระบบผู้ดูแล และส่ง LINE webhook ทดสอบ
4. ใน GitHub Environment `liff` ตั้ง `GATEWAY_URL=https://<gateway>` แล้วรัน workflow `Deploy web pages`
5. ใน LINE Developers Console เปลี่ยน Webhook URL เป็น `https://<gateway>/line/webhook`, กด Verify แล้วเปิด Use webhook
6. ทดสอบตามหัวข้อ 4 ให้ครบ
7. ลบ `ALLOW_LEGACY_DIRECT` ออกจาก Script Properties ทั้งสองโปรเจกต์ จากนั้นยืนยันว่าคำขอ GET ที่มี token ไป `/exec` โดยตรงถูกปฏิเสธด้วย `GATEWAY_REQUIRED`

`ALLOW_LEGACY_DIRECT` เป็นสวิตช์ migration เท่านั้น ห้ามปล่อยค้างหลัง cutover ถ้าไม่มีคีย์นี้ ระบบจะปฏิเสธ direct request แม้ยังไม่ได้ตั้ง shared secret (fail-closed)

## 4. Smoke test หลัง deploy

- LINE webhook ที่ลายเซ็นผิดต้องได้ HTTP 401; ลายเซ็นถูกต้องต้องได้ 200 หลัง backend ประมวลผลสำเร็จ
- LIFF: session, ลงทะเบียน, ยื่นใบลาทดสอบ และกดส่งซ้ำ ต้องมีใบเดียวตาม `Request ID`
- ผู้อนุมัติที่ถูกต้องกดได้ ผู้ใช้อื่นกดไม่ได้ และกด webhook ซ้ำไม่เปลี่ยนสถานะซ้ำ
- หน้าผู้ดูแล: token ผิดถูกปฏิเสธ; แก้ข้อมูลพร้อมกันสองหน้าต้องมีหน้าหนึ่งได้ข้อความข้อมูลเปลี่ยนแปลงแล้ว
- ใบลาประเภทวันทำการที่เลือกช่วงไม่มีวันทำการ, วันไม่ถูกต้อง, ข้ามปี และยกเลิกตั้งแต่วันเริ่มลา ต้องถูกปฏิเสธด้วยข้อความไทย; ลาคลอด/บวชช่วงวันหยุดต้องยื่นได้และตัดสิทธิ์เป็นวันปฏิทิน
- หน้า dashboard ต้องแสดง trigger/config พร้อม; ตรวจชีตซ่อน `SecurityEvents` และ `AuditLog` ว่ามีรายการใหม่โดยไม่มี token หรือเหตุผลการลาที่ละเอียดอ่อน
- จำลอง LINE ส่งไม่สำเร็จ: `สถานะการแจ้ง` ต้องเป็น `แจ้งไม่สำเร็จ`; retry trigger ทำงาน และเปลี่ยนเป็น `ต้องตรวจสอบ` หลังครบ 5 ครั้ง

## 5. Rollback

ถ้า gateway มีปัญหาระหว่าง migration ให้ตั้ง `ALLOW_LEGACY_DIRECT=TRUE` ชั่วคราว เปลี่ยน LINE webhook และ `GATEWAY_URL` กลับเฉพาะเท่าที่จำเป็น แล้วแก้ gateway ห้ามลบข้อมูล Notion, `Request ID`, `SecurityEvents` หรือ `AuditLog` ระหว่าง rollback

หลังแก้เสร็จให้ cutover ใหม่และลบ `ALLOW_LEGACY_DIRECT` ทุกครั้ง การ rollback ไป direct endpoint ลดการป้องกัน signature/CORS จึงต้องกำหนดเวลา เจ้าของงาน และบันทึกเหตุการณ์ไว้

## 6. งานปฏิบัติการประจำ

- หมุน `ADMIN_TOKEN`, LINE/Notion tokens และ shared secret ตามนโยบายองค์กรหรือทันทีเมื่อสงสัยว่ารั่ว
- ตรวจ Logs, `SecurityEvents`, `AuditLog` และใบที่ `สถานะการแจ้ง = ต้องตรวจสอบ`
- ทบทวน `ALLOWED_ORIGINS`, สิทธิ์ Notion integration และผู้ดูแลเป็นระยะ
- ให้ HR ทบทวน `QuotaProfiles` กับระเบียบ ประกาศ สัญญาจ้าง และสถานะบุคลากรอย่างน้อยปีละครั้ง แล้วอัปเดต `leave_policy_reviewed_at`; ห้ามมองค่า seed เป็นคำวินิจฉัยสิทธิ
- สำรอง Notion/Google Sheet ตามรอบ retention ของหน่วยงาน และทดสอบกู้คืน
- ใช้ shared admin token เป็น migration mode; สำหรับ production ระยะยาวควรวางหน้า admin หลัง identity-aware proxy/SSO ที่ระบุตัวผู้ดูแลรายบุคคลได้

## 7. Production acceptance gates

ระบบรุ่นนี้เหมาะสำหรับทดสอบ/นำร่องหลังผ่าน smoke test แต่ยังไม่ควรเปิด production จนเจ้าของระบบยืนยันครบทุกข้อ:

- **ตัวตนผู้ลงทะเบียน**: ปัจจุบันผู้มีลิงก์ LIFF สามารถเลือกชื่อและประเภทบุคลากรเองได้ ต้องเพิ่ม allowlist/activation code/องค์กร SSO หรือมีขั้นตอนอนุมัติการผูก LINE userId ก่อนให้ยื่นจริง
- **ตัวตนผู้ดูแล**: เปลี่ยน shared `ADMIN_TOKEN` เป็น identity-aware proxy/SSO พร้อมชื่อผู้กระทำใน audit log หรือยอมรับความเสี่ยงนี้เป็นลายลักษณ์อักษรและกำหนดรอบหมุน token
- **นโยบายวันลา**: HR ตรวจ QuotaProfiles ทุกแถว รวมประกาศพนักงานกระทรวงสาธารณสุขฉบับปี 2569 และสิทธิของลูกจ้างแต่ละสัญญา แล้วตั้ง `leave_policy_reviewed_at` ให้ health check ผ่าน
- **การปฏิบัติการ**: ตั้ง WAF/rate limit, alert, backup/restore test, secret rotation และเจ้าของ incident/rollback ที่ติดต่อได้
