# notion-notify — ระบบแจ้งเตือนปฏิทินงาน + ระบบลางาน สสอ.สอง แพร่

repo นี้คือ "คลังโค้ด" หนึ่งเดียวที่เก็บโค้ดของระบบ **3 ชิ้นส่วน** — ไม่ใช่ระบบเดียวที่แตกเป็นหลายโปรเจกต์ แต่ละชิ้น deploy ต่างกัน ใช้คนละคำสั่ง

```
notion-notify/
│
├─ 🟩 apps/main/            โปรเจกต์ Apps Script หลัก (ผูกกับ Google Sheet)
│     Webhook.gs            จุดเข้า doGet/doPost — webhook ของ LINE + API ของหน้า LIFF
│     Config.gs             ชีต Settings / เตรียมชีต / เมนู / health check / เมนูทดสอบ
│     Notion.gs             Notion HTTP client ร่วม (query วน cursor, parse ค่า)
│     Calendar.gs           ปฏิทินงานจาก Notion + API ให้หน้าตารางงาน
│     Summary.gs            สรุปเช้ารายวัน + one-time trigger + ผู้สร้างข้อความ text/flex + ส่ง LINE + log
│     Leave.gs              ค่าคงที่ระบบลา + ทำเนียบ Staff + คอนฟิกผู้อนุมัติ + สวิตช์เปิด/ปิด
│     LeaveCalc.gs          วันทำการ/สิทธิ์ต่อปี/คำเตือนตามระเบียบ + ป้ายแสดงผล
│     LeaveApi.gs           API ให้หน้า LIFF (session/bind/submit/myLeaves/cancel/update) + ตรวจ token
│     LeaveApproval.gs      การ์ดขออนุมัติ + ปุ่ม postback + อ่าน/เขียนใบลาใน Notion + push ผล 1:1
│     LeaveReports.gs       ผู้ลาวันนี้ (สรุปเช้า) + ผู้ลาในหน้าตารางงาน + สรุปรายเดือน
│     Tests.gs              unit tests (รันจากเมนู "รัน Unit Tests" ในชีต)
│
├─ 🟦 apps/webapp/          โปรเจกต์ Apps Script แยก — หน้าเว็บตั้งค่าสำหรับผู้ดูแล (SETUP.md ข้อ 10)
│     WebApp.gs             backend (auth ด้วย ALLOWED_EDITORS + รายงานวันลาแบบอ่าน Notion)
│     Index.html            frontend (แท็บตั้งค่า/วันหยุด/ประวัติ/รายงานวันลา + CSV)
│
├─ 🟨 web/                  เว็บบน GitHub Pages (ไม่ใช่ Apps Script)
│     liff-form/            ฟอร์มยื่นลา + แท็บ "ของฉัน" (ยอดวันลา/แก้ไข/ยกเลิก)
│     schedule/             ตารางงานสาธารณะ/เจ้าหน้าที่ (มีผู้ลาในมุมมองเจ้าหน้าที่)
│
└─ scripts/                 คำสั่งย่อ push/deploy ทั้งสองโปรเจกต์
```

**ทำไม Apps Script ต้อง 2 โปรเจกต์**: การตั้งสิทธิ์ deployment เป็นระดับโปรเจกต์ — ตัวหลักต้องเปิด "Anyone" ให้เซิร์ฟเวอร์ของ LINE ยิง webhook เข้ามาได้ ถ้าหน้าตั้งค่าอยู่โปรเจกต์เดียวกันก็จะเปิด "Anyone" ไปด้วย = ใครมีลิงก์ก็แก้ค่าระบบได้ (รายละเอียดในหัวไฟล์ `apps/webapp/WebApp.gs`)

## แก้อะไร → ทำอะไร

| แก้ | ไฟล์ | push | deploy |
|---|---|---|---|
| สรุปเช้า / ระบบลา / API | `apps/main/*.gs` | `scripts/push-main.sh` | `scripts/deploy-main.sh "คำอธิบาย"` (หรือหน้าเว็บ > Manage deployments > New version บน deployment **เดิม** — ห้ามสร้าง deployment ใหม่ เพราะ URL จะเปลี่ยนและ webhook LINE พัง) |
| หน้าเว็บตั้งค่า / รายงาน | `apps/webapp/*` | `scripts/push-webapp.sh` | `scripts/deploy-webapp.sh "คำอธิบาย"` |
| ฟอร์มลา / ตารางงาน | `web/liff-form/`, `web/schedule/` | — | `git push` (GitHub Actions deploy ขึ้น Pages เอง) |
| รัน unit tests | `apps/main/Tests.gs` | จาก Google Sheet: เมนู "ระบบแจ้งเตือนปฏิทิน > รัน Unit Tests" | — |

หมายเหตุ: การ push ฝั่ง Apps Script **ไม่กระทบ production ทันที** — ระบบจะยังรัน version เดิมจนกด deploy version ใหม่

## Secrets อยู่ที่ไหน (ไม่มีอะไรใน repo เลย)

| Secret | ที่เก็บ | ใช้กับ |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN`, `NOTION_TOKEN`, `LOGIN_CHANNEL_ID` | Script Properties ของโปรเจกต์หลัก | ส่ง LINE / อ่าน-เขียน Notion / ตรวจ LIFF token |
| `ALLOWED_EDITORS`, `NOTION_TOKEN_READONLY` | Script Properties ของโปรเจกต์ webapp | รายชื่อผู้ดูแลหน้าเว็บ / อ่านใบลาแบบอ่านอย่างเดียว |
| `LIFF_ID`, `API_URL`, `SCHEDULE_LIFF_ID` | GitHub Environment ชื่อ `liff` | แทนที่ placeholder ตอน build หน้าเว็บ |

## ลิงก์สำคัญ

- API/webhook (โปรเจกต์หลัก): `https://script.google.com/macros/s/AKfycbybCXO_I22rahuFOl8J-IJ_xluDagiDh6kouAMTv8hIB1M2b3mo3djrujP1TBpxgXeX/exec`
- หน้าตั้งค่า (webapp): `https://script.google.com/macros/s/AKfycbxAjzU09oMjcQtT3RXpqNTh_rt9RDCzdrH_SGysycgYUNb0CEs7wcrztpmizPPe6rO2TQ/exec`
- ฟอร์มลา: `https://9gotstory.github.io/notion-notify/web/liff-form/` (URL เก่า `/liff-form/` มี redirect รองรับ)
- ตารางงาน: `https://9gotstory.github.io/notion-notify/web/schedule/` (URL เก่า `/schedule/` มี redirect รองรับ)

## เอกสาร

- [SETUP.md](SETUP.md) — คู่มือติดตั้ง/ตั้งค่า/บำรุงรักษาทั้งหมด (ตามหัวข้อเลข)
