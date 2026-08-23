#!/usr/bin/env bash
# push โปรเจกต์หลัก (apps/main — ผูกกับ Google Sheet: webhook LINE + API + สรุปเช้า + ระบบลา) ขึ้น Apps Script
# ใช้: scripts/push-main.sh   (ต้อง login clasp ด้วยบัญชีเจ้าของโปรเจกต์)
#
# หลัง push: ระบบ production ยังรัน version เดิมจนกว่าจะ deploy version ใหม่ —
# ใช้ scripts/deploy-main.sh เพื่อทำทั้งสองขั้นในคำสั่งเดียว หรือกดผ่านหน้าเว็บก็ได้
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# --force เพราะ push ครั้งนี้อาจต้องลบไฟล์บน remote ที่หายไปจาก local (เช่นตอนแตกไฟล์/ย้ายชื่อ)
# — ถ้าไม่ใส่ clasp จะถามยืนยันแล้ว "Skipping push" เงียบๆ ในโหมดสคริปต์ (manifest ของเรากับ remote ตรงกันอยู่แล้วจึงปลอดภัย)
cd "$ROOT/apps/main" && clasp push --force
