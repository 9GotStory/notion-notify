# LINE Rich Menu

โครงสร้างภาพ 2500 × 1686 พิกเซล:

- ซ้าย 1666 × 1686: ตารางงาน
- ขวาบน 834 × 843: ยื่นใบลา
- ขวาล่าง 834 × 843: เว็บไซต์สำนักงาน

ไฟล์ `rich-menu.json` กำหนดพิกัดและ URI ของแต่ละพื้นที่ ส่วน `rich-menu.png` คือภาพพร้อมอัปโหลด

ติดตั้งด้วย Messaging API:

```bash
LINE_CHANNEL_ACCESS_TOKEN='ใส่-token-เฉพาะใน-shell' scripts/install-rich-menu.sh
```

สคริปต์จะ validate, สร้างเมนูใหม่, อัปโหลดภาพ และตั้งเป็น default โดยไม่ลบเมนูเดิม
