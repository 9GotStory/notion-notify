# notion-notify — ระบบแจ้งเตือนปฏิทินงานและระบบลางาน

repository นี้เก็บระบบ 4 ส่วนที่ deploy แยกกัน:

```text
notion-notify/
├─ apps/main/       Apps Script หลัก: ปฏิทิน ใบลา LINE และ trigger
├─ apps/webapp/     Apps Script API สำหรับผู้ดูแล
├─ gateway/         public security gateway: ตรวจ LINE signature, CORS และ signed request
├─ web/             หน้า LIFF ตารางงาน และหน้าผู้ดูแลบน GitHub Pages
└─ scripts/         คำสั่ง push/deploy และ local test runner
```

เส้นทาง production คือ `browser/LINE -> gateway -> Apps Script` เท่านั้น ห้ามตั้งหน้าเว็บหรือ LINE ให้เรียก URL `/exec` โดยตรงหลัง cutover เพราะ Apps Script อ่าน `X-Line-Signature` และควบคุม CORS/status code ได้ไม่ครบเท่า gateway

## แก้อะไร แล้ว deploy ที่ไหน

| ขอบเขต | ไฟล์ | วิธี deploy |
|---|---|---|
| สรุปเช้า ระบบลา LINE API | `apps/main/*.gs` | `scripts/push-main.sh` แล้ว `scripts/deploy-main.sh "คำอธิบาย"` |
| API ผู้ดูแล | `apps/webapp/WebApp.gs` | `scripts/push-webapp.sh` แล้ว `scripts/deploy-webapp.sh "คำอธิบาย"` |
| security gateway | `gateway/` | build `gateway/Dockerfile` และ deploy บน HTTPS container runtime |
| หน้าเว็บทั้งหมด | `web/` | `git push`; GitHub Actions deploy GitHub Pages |

การ push Apps Script ยังไม่เปลี่ยน production จนกว่าจะ deploy version ใหม่บน deployment เดิม ห้ามสร้าง deployment ใหม่โดยไม่จำเป็น เพราะ URL backend จะเปลี่ยน

## ค่าลับและค่าตั้งค่า

| ที่เก็บ | ค่า |
|---|---|
| Script Properties โปรเจกต์หลัก | `LINE_CHANNEL_ACCESS_TOKEN`, `NOTION_TOKEN`, `LOGIN_CHANNEL_ID`, `GATEWAY_SHARED_SECRET` |
| Script Properties โปรเจกต์ webapp | `ADMIN_TOKEN`, `SPREADSHEET_ID`, `NOTION_TOKEN_READONLY`, `GATEWAY_SHARED_SECRET` |
| environment ของ gateway | `LINE_CHANNEL_SECRET`, `GATEWAY_SHARED_SECRET`, `MAIN_APPS_SCRIPT_URL`, `ADMIN_APPS_SCRIPT_URL`, `ALLOWED_ORIGINS` |
| GitHub Environment `liff` | `LIFF_ID`, `SCHEDULE_LIFF_ID`, `GATEWAY_URL` |

`GATEWAY_SHARED_SECRET` ต้องเป็นค่าสุ่มอย่างน้อย 32 ตัวอักษรและตรงกันทั้ง 3 จุด ห้าม commit token, secret หรือ URL ที่มี credential ลง repository

## คำสั่งตรวจสอบในเครื่อง

```bash
node scripts/test-apps-script.js
cd gateway && npm test
```

CI รัน regression tests ทั้งสองชุดและตรวจ syntax ของ JavaScript/Apps Script ทุก pull request

## เอกสาร

- [USER-ADMIN-GUIDE.md](USER-ADMIN-GUIDE.md) — คู่มือใช้งานประจำวันสำหรับผู้ใช้ ผู้อนุมัติ และผู้ดูแล พร้อมวิธีแก้ปัญหา
- [PRODUCTION-HANDOFF.md](PRODUCTION-HANDOFF.md) — acceptance gates, เจ้าของงาน, หลักฐาน, Go/No-Go และแบบส่งมอบ production
- [SETUP.md](SETUP.md) — การตั้งค่าฟังก์ชัน ชีต Notion และ LINE
- [SECURITY-DEPLOYMENT.md](SECURITY-DEPLOYMENT.md) — migration/cutover gateway, rollback และ security checklist
