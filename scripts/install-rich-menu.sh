#!/usr/bin/env bash
# สร้าง Rich Menu ใหม่ อัปโหลดภาพ และตั้งเป็นค่าเริ่มต้น โดยไม่ลบเมนูเดิม
# ใช้: LINE_CHANNEL_ACCESS_TOKEN='...' scripts/install-rich-menu.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/rich-menu/rich-menu.json"
IMAGE="$ROOT/rich-menu/rich-menu.png"
TOKEN="${LINE_CHANNEL_ACCESS_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo 'ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน environment' >&2
  exit 1
fi
if [[ ! -f "$IMAGE" ]]; then
  echo "ไม่พบไฟล์ภาพ: $IMAGE" >&2
  exit 1
fi
if [[ $(wc -c < "$IMAGE") -gt 1000000 ]]; then
  echo 'ภาพ Rich Menu ต้องมีขนาดไม่เกิน 1,000,000 ไบต์' >&2
  exit 1
fi
command -v curl >/dev/null || { echo 'ต้องติดตั้ง curl ก่อน' >&2; exit 1; }
command -v jq >/dev/null || { echo 'ต้องติดตั้ง jq ก่อน' >&2; exit 1; }

AUTH_HEADER="Authorization: Bearer $TOKEN"
curl --fail-with-body --silent --show-error \
  -X POST 'https://api.line.me/v2/bot/richmenu/validate' \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data-binary "@$CONFIG" >/dev/null

RESPONSE="$(curl --fail-with-body --silent --show-error \
  -X POST 'https://api.line.me/v2/bot/richmenu' \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data-binary "@$CONFIG")"
RICH_MENU_ID="$(jq -er '.richMenuId' <<<"$RESPONSE")"

curl --fail-with-body --silent --show-error \
  -X POST "https://api-data.line.me/v2/bot/richmenu/$RICH_MENU_ID/content" \
  -H "$AUTH_HEADER" -H 'Content-Type: image/png' \
  --data-binary "@$IMAGE" >/dev/null

curl --fail-with-body --silent --show-error \
  -X POST "https://api.line.me/v2/bot/user/all/richmenu/$RICH_MENU_ID" \
  -H "$AUTH_HEADER" >/dev/null

echo "ติดตั้ง Rich Menu สำเร็จ: $RICH_MENU_ID"
echo 'เมนูเดิมยังไม่ถูกลบ สามารถย้อนกลับได้จาก LINE Official Account Manager'
