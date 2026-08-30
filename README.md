# notion-notify — ระบบแจ้งเตือนปฏิทินงานและระบบลางาน

repository นี้เก็บระบบ 4 ส่วนที่ deploy แยกกัน:

```text
notion-notify/
├─ apps/main/       Apps Script หลัก: ปฏิทิน ใบลา LINE และ trigger
├─ apps/webapp/     Apps Script API สำหรับผู้ดูแล
├─ gateway/         security gateway สำหรับตรวจ LINE signature/เพิ่มการป้องกันหน้าเว็บ
├─ web/             หน้า LIFF ตารางงาน และหน้าผู้ดูแลบน GitHub Pages
└─ scripts/         คำสั่ง push/deploy และ local test runner
```

โหมดหน้าเว็บที่เลือกใช้งานปัจจุบันคือ `browser -> Apps Script /exec` โดยตรง จึงต้องตั้ง `ALLOW_LEGACY_DIRECT=TRUE` ใน Apps Script ทั้งสองโปรเจกต์อย่างชัดเจน ส่วน LINE webhook ปฏิเสธ unsigned request โดยค่าเริ่มต้น: ใช้ gateway ที่ตรวจ `X-Line-Signature` หรือเปิดข้อยกเว้นชั่วคราว `ALLOW_UNSIGNED_LINE_WEBHOOK=TRUE` พร้อมการยอมรับความเสี่ยง

## แก้อะไร แล้ว deploy ที่ไหน

| ขอบเขต | ไฟล์ | วิธี deploy |
|---|---|---|
| สรุปเช้า ระบบลา LINE API | `apps/main/*.gs` | `scripts/push-main.sh` แล้ว `scripts/deploy-main.sh "คำอธิบาย"` |
| API ผู้ดูแล | `apps/webapp/WebApp.gs` | `scripts/push-webapp.sh` แล้ว `scripts/deploy-webapp.sh "คำอธิบาย"` |
| security gateway | `gateway/` | แนะนำสำหรับ LINE webhook; ดู `SECURITY-DEPLOYMENT.md` |
| หน้าเว็บทั้งหมด | `web/` | `git push`; GitHub Actions deploy GitHub Pages |

การ push Apps Script ยังไม่เปลี่ยน production จนกว่าจะ deploy version ใหม่บน deployment เดิม ห้ามสร้าง deployment ใหม่โดยไม่จำเป็น เพราะ URL backend จะเปลี่ยน

## ค่าลับและค่าตั้งค่า

| ที่เก็บ | ค่า |
|---|---|
| Script Properties โปรเจกต์หลัก | `LINE_CHANNEL_ACCESS_TOKEN`, `NOTION_TOKEN`, `LOGIN_CHANNEL_ID`, `ADMIN_TOKEN`, `ALLOW_LEGACY_DIRECT=TRUE`; และ `GATEWAY_SHARED_SECRET` (แนะนำ) หรือ `ALLOW_UNSIGNED_LINE_WEBHOOK=TRUE` (ข้อยกเว้น) |
| Script Properties โปรเจกต์ webapp | `ADMIN_TOKEN`, `SPREADSHEET_ID`, `NOTION_TOKEN_READONLY`, `ALLOW_LEGACY_DIRECT=TRUE` |
| GitHub Environment `liff` | `LIFF_ID`, `SCHEDULE_LIFF_ID`, `API_URL`, `ADMIN_API_URL` |
| gateway | ตัวแปรตาม `SECURITY-DEPLOYMENT.md` เมื่อใช้รับ LINE webhook หรือย้าย browser traffic |

`ADMIN_TOKEN` ต้องเป็นค่าสุ่มอย่างน้อย 32 ตัวอักษร และต้องตั้งค่าเดียวกันในทั้งโปรเจกต์หลักและ webapp เพื่อให้หน้า Admin จัดการใบลาผ่าน backend หลักได้ ห้าม commit token, secret หรือ URL ที่มี credential ลง repository

## คำสั่งตรวจสอบในเครื่อง

```bash
node scripts/test-apps-script.js
node scripts/test-leave-e2e.js
cd gateway && npm test
```

CI รัน regression tests ทั้งสองชุดและตรวจ syntax ของ JavaScript/Apps Script ทุก pull request

## เอกสาร

- [USER-ADMIN-GUIDE.md](USER-ADMIN-GUIDE.md) — คู่มือใช้งานประจำวันสำหรับผู้ใช้ ผู้อนุมัติ และผู้ดูแล พร้อมวิธีแก้ปัญหา
- [PRODUCTION-HANDOFF.md](PRODUCTION-HANDOFF.md) — acceptance gates, เจ้าของงาน, หลักฐาน, Go/No-Go และแบบส่งมอบ production
- [SETUP.md](SETUP.md) — การตั้งค่าฟังก์ชัน ชีต Notion และ LINE
- [SECURITY-DEPLOYMENT.md](SECURITY-DEPLOYMENT.md) — ทางเลือก migration/cutover gateway ในอนาคต
