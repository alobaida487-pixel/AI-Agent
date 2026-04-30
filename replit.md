# Discord Ticket Bot (بوت التذاكر)

## نظرة عامة
بوت ديسكورد عربي لإدارة تذاكر الدعم الفني، مشابه لـ Tickets v2.

## المميزات
- لوحة فتح تذاكر بزر واحد
- استلام التذكرة من فريق الدعم (زر "استلام")
- إغلاق التذكرة مع تأكيد (زر "إغلاق")
- حفظ سجل كامل (Transcript) HTML بتنسيق RTL في قناة السجلات
- إضافة/إزالة أعضاء من التذكرة (`/add`, `/remove`)
- جميع النصوص بالعربية

## أوامر السلاش
- `/setup category log_channel support_role` — إعداد البوت (للأدمن فقط)
- `/panel [message]` — نشر لوحة فتح التذاكر في القناة الحالية
- `/add user` — إضافة عضو إلى التذكرة
- `/remove user` — إزالة عضو من التذكرة

## بنية المشروع
- `bot/` — حزمة بوت الديسكورد (discord.js v14, tsx, pg)
  - `src/index.ts` — نقطة الدخول، الأوامر والأزرار
  - `src/db.ts` — اتصال PostgreSQL وعمليات الجدول
  - `src/transcript.ts` — توليد سجل HTML بالعربية
- `artifacts/` — أعمال سابقة (متروكة): `ai-agent`, `api-server`, `mockup-sandbox`

## التخزين
البوت يحفظ البيانات في ملف `data/state.json` محلياً (لا يحتاج قاعدة بيانات). على Render Free الملف يُمسح عند إعادة النشر، وعندها يحتاج إعادة `/setup`.

## المتغيرات البيئية
- `DISCORD_TOKEN` — توكن البوت (مطلوب)
- `PORT` — منفذ خادم HTTP (Render يضبطه تلقائياً، افتراضي 3000)
- `DISCORD_MESSAGE_CONTENT_INTENT=true` — تفعيل قراءة محتوى الرسائل (للسجلات الكاملة)

## ملاحظة مهمة عن الـ Privileged Intents
لجعل سجلات التذاكر تحوي نص الرسائل، يجب:
1. الذهاب إلى https://discord.com/developers/applications
2. اختيار البوت → Bot → تفعيل **Message Content Intent**
3. ضبط متغير البيئة `DISCORD_MESSAGE_CONTENT_INTENT=true` وإعادة تشغيل البوت

بدون ذلك، السجلات ستحوي بيانات الرسائل (الكاتب، الوقت، المرفقات) بدون نص الرسالة.

## التشغيل
البوت يعمل عبر workflow اسمه "Discord Bot" بأمر:
`npm --prefix bot start`

تثبيت الاعتماديات: `cd bot && npm install`
