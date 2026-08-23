#!/usr/bin/env bash
# push + deploy version ใหม่ให้โปรเจกต์หลัก บน "deployment เดิม" (URL ไม่เปลี่ยน)
#
# สำคัญ: ห้ามสร้าง deployment ใหม่เด็ดขาด — webhook ของ LINE, ปุ่มอนุมัติใบลา และ API
# ของหน้า LIFF ทั้งหมดผูกกับ URL ของ deployment นี้ (ตาม SETUP.md หัวข้อระบบลา)
# ใช้: scripts/deploy-main.sh "คำอธิบาย version"
set -euo pipefail

DEPLOYMENT_ID="AKfycbybCXO_I22rahuFOl8J-IJ_xluDagiDh6kouAMTv8hIB1M2b3mo3djrujP1TBpxgXeX"
DESCRIPTION="${1:-update}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/main"
clasp push --force  # ลบไฟล์ remote ที่หายจาก local ได้เลย (แตกไฟล์/ย้ายชื่อ) — กัน prompt ทำ push ถูก skip
clasp deploy --deploymentId "$DEPLOYMENT_ID" -d "$DESCRIPTION"
