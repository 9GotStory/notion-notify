#!/usr/bin/env bash
# push WebApp.gs + Index.html ขึ้นโปรเจกต์ Apps Script "หน้าตั้งค่า" (โปรเจกต์แยกตาม SETUP.md ข้อ 10)
#
# ทำไมต้องมีสคริปต์นี้: clasp ผูกกับโปรเจกต์ผ่าน .clasp.json ที่ละ 1 ตัวต่อไดเรกทอรี — ที่ root ของ repo
# ชี้อยู่ที่โปรเจกต์หลัก (และ .claspignore กัน WebApp.gs/Index.html ไว้) การ push โปรเจกต์แยกจึงต้อง
# แยก staging dir ที่มี .clasp.json ของตัวเอง + คัดเฉพาะสองไฟล์นี้ไปวาง
#
# สำคัญ: manifest (appsscript.json) ต้อง "ยึดจากของ remote" เสมอ — เพราะหลัง deploy ผ่านหน้าเว็บ
# Google จะเขียนการตั้งค่า webapp (executeAs/access) กลับลง manifest ถ้าเราสังเคราะห์ manifest
# เองแล้วทับไป จะเป็นการ reset ค่าเหล่านั้น (และถ้าไม่ใช้ --force clasp จะถามยืนยันแล้ว skip เงียบๆ
# ในโหมดสคริปต์ ทำให้คิดว่า push สำเร็จแต่จริงๆ โค้ดไม่ขึ้น)
#
# ใช้: scripts/push-webapp.sh   (ต้อง login clasp ด้วยบัญชีเจ้าของโปรเจกต์)
set -euo pipefail

SCRIPT_ID="1JgobULf0jnILvUnX5-HERhhOlZR3wE_gwptK7G5lTtvVFwqldQlF6ZMk"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

printf '{\n  "scriptId": "%s",\n  "rootDir": ""\n}\n' "$SCRIPT_ID" > "$STAGE/.clasp.json"

# ดึง manifest ปัจจุบันจาก remote มาใช้ตรงๆ (clasp pull จะดึงไฟล์โค้ดมาด้วย — เดี๋ยวทับด้วยของ local)
(cd "$STAGE" && clasp pull > /dev/null 2>&1)

cp "$ROOT/WebApp.gs" "$ROOT/Index.html" "$STAGE/"
# manifest ตรงกับ remote อยู่แล้ว --force จึงไม่เปลี่ยนอะไร แค่กัน prompt ยืนยันในโหมดสคริปต์
(cd "$STAGE" && clasp push --force)

echo "เสร็จแล้ว — อย่าลืม: แก้โค้ดแล้วต้อง Deploy > Manage deployments > New version ที่หน้าเว็บด้วย"
