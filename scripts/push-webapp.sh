#!/usr/bin/env bash
# push โปรเจกต์หน้าตั้งค่า (apps/webapp — โปรเจกต์แยกตาม SETUP.md ข้อ 10) ขึ้น Apps Script
#
# ก่อน push จะดึง appsscript.json ล่าสุดจาก remote มาทับของ local เสมอ — เพราะทุกครั้งที่มีการ
# deploy ผ่านหน้าเว็บ Google จะเขียนการตั้งค่า webapp (executeAs/access) กลับลง manifest
# ถ้า push ด้วย manifest เก่ากว่า clasp จะถามยืนยันแล้ว "Skipping push" เงียบๆ ในโหมดสคริปต์
# (เคยเกิดแล้วจริง: คิดว่า push สำเร็จแต่โค้ดไม่ขึ้น)
# ใช้: scripts/push-webapp.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ดึง manifest ปัจจุบันจาก remote (pull ลง temp — ไฟล์โค้ดที่ได้มาทิ้ง ใช้แค่ manifest)
cp "$ROOT/apps/webapp/.clasp.json" "$STAGE/"
(cd "$STAGE" && clasp pull > /dev/null 2>&1)
cp "$STAGE/appsscript.json" "$ROOT/apps/webapp/appsscript.json"

# จากนั้นบังคับค่า webapp ตามที่ระบบออกแบบ (เป็น JSON API แบบ anonymous + execute as me)
# — ค่าอื่นใน manifest ยังยึดของ remote ตามเหตุผลด้านบน แต่สองค่านี้เป็นสัญญาของโปรเจกต์
# หมายเหตุ: ค่า "จริง" ที่ deployment ใช้ผูกกับ deployment ไม่ใช่ version — หลัง deploy ต้องตรวจ/แก่
# ผ่าน Manage deployments > ดินสอ ให้เป็น Execute as: Me + Who has access: Anyone เสมอ (URL ไม่เปลี่ยน)
node -e '
const fs = require("fs");
const p = process.argv[1];
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.webapp = { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" };
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$ROOT/apps/webapp/appsscript.json"

cd "$ROOT/apps/webapp"
clasp push --force
echo "เสร็จแล้ว — อย่าลืม deploy: หน้าเว็บ > Deploy > Manage deployments > ดินสอ > New version หรือ scripts/deploy-webapp.sh"
