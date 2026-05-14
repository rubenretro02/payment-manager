# Payment Manager — TODO & Project History

> Historial y plan de trabajo. Mantén este archivo al día conforme avancemos.

---

## ✅ Hecho

### Notificaciones automáticas
- Cron jobs en `vercel.json` (reminders + daily-summary, daily)
- `sendPaymentReminders()` arreglado: real-time date calc, no .single(), keep nagging hasta que reporten
- Mensajes claros pidiendo el reporte aunque ya hayan pagado
- Endpoints aceptan GET + POST (Vercel cron usa GET)

### Vista admin de Due Payments
- `/dashboard/due-payments` con 6 categorías
- Tarjetas clickeables que filtran las tablas
- Botón "Send Reminders" para disparar cron manual
- Botón "Report" + dialog para reportar a nombre del user
- Botón "WhatsApp" por fila con mensaje contextual

### Reports detallado
- 4 tabs: Overview, By Account, By User, All Payments
- Top Underpayers por user
- Tablas clickeables que abren Payment Details dialog (con screenshots)
- Filtros via tarjetas superiores
- Export CSV funcional

### Login con contraseña / web auth
- Migration `migration-add-email-auth.sql` aplicada
- Add User dialog con campo password (+ Generate)
- "Set/Reset Credentials" para users existentes
- Dialog de "Copy All credentials" para mandárselas
- Login acepta cualquier role (user/ibo/admin)
- Auto-link cuando un user con email abre el bot

### Wallet + Basescan auto-verificación
- Migration `migration-add-wallet-address.sql` aplicada
- Wallet por cuenta en Add/Edit Account
- API `/api/payments/verify-tx` (verificación manual)
- API `/api/payments` auto-confirma cuando llega tx con match
- Auto-scan: escanea wallet por transfers entrantes recientes que matchean el monto
- Solo se muestra wallet cuando user elige método crypto

### Mini app — UX inteligente
- Botón Report se bloquea después de reportar (View + Add another)
- Telegram auto-link cuando admin agrega `telegram_username` antes
- Mensajes WhatsApp pre-llenados contextuales (overdue / due today / soon)
- Phone field editable, indicador "no phone" en menú

### Limpieza UI
- Landing page eliminada → redirect directo a `/login`
- Campanita decorativa eliminada del Header
- Search duplicado del Header eliminado
- Todo el texto en inglés (consistente)
- Bottom nav admin con "More" sheet que expone todas las páginas
- Webhook Telegram traducido (comandos /report, /mypayments, /status, /help)

---

## 🐛 Bugs activos

### Due Payments muestra 0 en todas las categorías
**Síntoma:** Hay accounts en Accounts page (21 cuentas, varias con Next Payment hoy) pero `/dashboard/due-payments` muestra 0 en todas las categorías.
**Diagnóstico:** Agregué logging server-side en `/api/payments/due`. Revisar **Vercel → Project → Logs → Functions** después de cargar la página para ver:
- `[due-payments] Found accounts: N` — debería ser >0
- `[due-payments] Result counts:` — distribución por categoría
- Si "Found accounts" es 0: problema de RLS o filtro
- Si "Found accounts" > 0 pero todo va a `upcoming`: probable issue de fecha/timezone

**Hipótesis:** El cron usa server time (UTC) y el "today" en el server puede no coincidir con el local. Por ejemplo, si en Vercel son las 11 PM EST = 4 AM UTC del día siguiente, el server piensa que es mañana.

### Algunos users no reciben reminders
**Causa identificada:** El cron solo manda a users con `telegram_id` (línea ~350 en `notifications.ts`). Users creados solo con email (sin telegram_id) **nunca reciben Telegram reminders**.
**Fix futuro:** mandar WhatsApp automático a users con phone (requiere Whapi o similar, $39/mo).

### Reminders solo 1 vez al día
**Limitación:** Vercel Hobby plan solo permite cron diario (1x/día mínimo).
**Solución abajo en "Pendiente" → External cron.**

---

## ⏳ Pendiente

### 1. Reminders cada 2-3 horas (cron externo gratis)
**Setup:**
1. Crear cuenta en **cron-job.org** (gratis)
2. New cronjob:
   - **URL:** `https://reportpayment.blackgoatt.com/api/notifications/reminders`
   - **Method:** GET
   - **Schedule:** Every 2 hours, only between 9am-9pm
     - O cron syntax: `0 13,15,17,19,21,23,1 * * *` (UTC: 9am-9pm EST)
   - **Headers:**
     - `Authorization: Bearer <CRON_SECRET>`
3. Save & enable

**Resultado:** se llamará el endpoint cada 2 horas durante el día. Cada llamada manda reminders solo a quienes están due/overdue y no han reportado.

**Alternativa pagada:** Vercel Pro $20/mo para crons sub-daily (más caro pero menos pieces).

### 2. WhatsApp automático (futuro, costo)
- Whapi.cloud ($39/mo) para no depender de clicks manuales
- Twilio WhatsApp Business API (oficial, ~$0.005/msg)

### 3. Bot AI conversacional
- Claude API integrada al webhook ("¿quién no pagó?", etc.)
- Variable: `ANTHROPIC_API_KEY`

---

## 📋 Pasos manuales

### En Vercel (Settings → Environment Variables)
Verificar que existen:
- [ ] `CRON_SECRET` (string aleatorio)
- [ ] `BASESCAN_API_KEY`
- [ ] `NEXT_PUBLIC_APP_URL=https://reportpayment.blackgoatt.com`

### En cron-job.org (setup pending)
- [ ] Crear cuenta
- [ ] Cronjob cada 2 horas a `/api/notifications/reminders` con Bearer auth

### Diagnóstico Due Payments
- [ ] Cargar `/dashboard/due-payments`
- [ ] Ir a Vercel → Logs → buscar `[due-payments]`
- [ ] Reportar conteo de accounts encontradas y distribución por categoría
