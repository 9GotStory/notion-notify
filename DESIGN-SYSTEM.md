# Notion Notify Design System

เอกสารนี้เป็นมาตรฐาน UI/UX ร่วมของหน้า Admin, ฟอร์มลา LIFF และตารางงาน โดยใช้หน้า
`Admin / บุคลากร` เป็น reference implementation สำหรับ mobile-first hierarchy,
สถานะที่อ่านง่าย และ action ที่มองเห็นได้โดยไม่ต้องเลื่อนตารางในแนวนอน

## หลักการ

1. แสดงงานหลักก่อนรายละเอียด และใช้ progressive disclosure กับงานแก้ไขที่ไม่ต้องทำทุกครั้ง
2. ตั้งชื่อปุ่มตามผลลัพธ์ เช่น `บันทึกประเภท`, `ลบวันหยุด`, `สร้างรายงาน`
3. แยกข้อมูล สถานะ และงานที่ต้องทำออกจากกัน ไม่ใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว
4. ทุก control มีพื้นที่กดอย่างน้อย 44×44px และมี focus ที่เห็นได้ด้วย keyboard
5. Mobile ใช้ card/stacked action; desktop ใช้ table เมื่อการเปรียบเทียบหลายคอลัมน์มีประโยชน์จริง
6. การเปลี่ยน presentation ต้องไม่เปลี่ยน API payload, authorization หรือ business state transition

## Foundations และ tokens

ประกาศ token กลางใน `web/liff-form/src/styles.css` ซึ่งเป็น Tailwind v4 build entry ที่ทั้งสามหน้าใช้ร่วมกัน

- Brand: `brand`, `brand-strong`, `brand-soft`
- Surface: `canvas`, `surface`, `surface-subtle`
- Content: `text`, `text-muted`, `border`
- Status: `info`, `success`, `warning`, `danger` และสีพื้น `*-soft`
- Shape: `rounded-control` สำหรับ field/button และ `rounded-card` สำหรับ card/dialog
- Elevation: `shadow-card`, `shadow-dialog`
- Typography: IBM Plex Sans Thai; ข้อความสำคัญภาษาไทยไม่ควรต่ำกว่า 13px

สี `primary`, `primary-dark`, `primary-light` เดิมยังคงไว้ระหว่าง migration เพื่อไม่ให้หน้าที่เหลือเปลี่ยนโดยไม่ตั้งใจ

## Component recipes

| Class | ใช้สำหรับ |
|---|---|
| `ui-page-header` และ element ย่อย | eyebrow, ชื่อหน้า และคำอธิบาย |
| `ui-card`, `ui-card-body` | surface หลักและ section |
| `ui-field`, `ui-label`, `ui-help` | input, select, textarea และคำอธิบาย |
| `ui-btn-primary` | action หลักหนึ่งรายการต่อบริบท |
| `ui-btn-secondary`, `ui-btn-soft` | action รองและ navigation ในบริบท |
| `ui-btn-danger` | action ลบ/ยกเลิกที่มีผลต่อข้อมูล |
| `ui-badge-*` | สถานะ neutral/info/success/warning/danger |
| `ui-alert-*` | ข้อความระดับหน้าและ inline feedback |
| `ui-empty-state` | ไม่มีข้อมูล พร้อมข้อความบอกทางไปต่อ |
| `ui-data-table` | ตาราง desktop ที่ต้องเปรียบเทียบหลายคอลัมน์ |

อย่าสร้าง component JavaScript กลางเพราะชื่อคล้ายกันเพียงอย่างเดียว ให้ extract เมื่อมี behavior
ที่ใช้ซ้ำจริงอย่างน้อยสองแห่ง เช่น busy state, confirmation dialog และ date formatting

## Page composition

หน้า Admin ใช้ลำดับมาตรฐานดังนี้:

1. Page header
2. Summary หรือ health state เมื่อมีข้อมูลสรุปที่ช่วยตัดสินใจ
3. Task tabs หรือ filter เมื่อหน้ามีหลาย workflow
4. Content cards / responsive data view
5. Contextual action และ confirmation dialog
6. Loading, empty, success และ error state

Report matrix สามารถเลื่อนแนวนอนบน desktop ได้ แต่ต้องมี mobile card alternative เสมอ

## Content และภาษาไทย

- ใช้คำกริยาเฉพาะงาน หลีกเลี่ยง `บันทึก`, `แสดง`, `ตกลง` ที่ไม่มีบริบท
- ข้อความยืนยันต้องบอกชื่อรายการ ผลกระทบ และปุ่มสุดท้ายที่ตรงกับการกระทำ
- Error ของ field อยู่ใกล้ field; toast ใช้แจ้งผลสำเร็จหรือ error ระดับหน้า
- วันที่ที่แสดงต่อผู้ใช้ใช้ `web/shared/date.js`; ค่า API ยังคงเป็น ISO date

## Quality gate

- ตรวจที่ viewport 360, 390, 768 และ desktop
- ไม่มี horizontal scroll บนมือถือ ยกเว้นข้อมูลที่มี mobile alternative
- ทดสอบ keyboard, Escape, focus return, text zoom 200% และ reduced motion
- ตรวจ loading/empty/error/success/disabled ของทุก workflow ที่แก้
- รัน `node scripts/check-syntax.js`, `node scripts/test-liff-ui.js`,
  `cd web/liff-form && npm run build:css` และ `git diff --check`
- Browser/source contract ไม่ถือเป็น visual QA ต้องบันทึกผลการตรวจ viewport แยกก่อน release
