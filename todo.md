# Payment Manager — TODO & Project History

> Historial de cambios y plan de trabajo para el sistema PayManager.
> Mantén este archivo actualizado conforme avancemos.

---

## ✅ Hecho (sesión actual)

### Notificaciones automáticas
- **Cron jobs configurados** en `vercel.json`
  - `/api/notifications/reminders` → diario 9am EST
  - `/api/notifications/daily-summary` → diario 8am EST
- **Bugs arreglados** en `sendPaymentReminders()`:
  - Calcula `next_payment_date` en tiempo real (ya no depende del campo DB vacío)
  - Reemplazado `.single()` por query normal (no rompe con 0/varios resultados)
  - Sin límite de días overdue — sigue mandando hasta que reporten
  - Verifica pagos en período actual según frecuencia (semanal/biweekly/monthly)
- **Mensajes reescritos** para enfatizar que el reporte es obligatorio aunque ya pagaron
- **Endpoints aceptan GET + POST** (Vercel cron usa GET)

### Vista admin de Due Payments
- Nueva página `/dashboard/due-payments`
- Endpoint `/api/payments/due` calcula estado en tiempo real
- 6 categorías: Overdue / Due Today / Due Soon / Upcoming / Reported / Confirmed
- Botón "Send Reminders" para disparar el cron manualmente
- Link en Sidebar admin/IBO

### Admin reporta a nombre de user
- Endpoint `/api/payments/admin-report`
- Botón "Report" en Due Payments page (overdue/due_today/due_soon)
- Switch "Auto-confirm" para saltar revisión
- Marca `admin_notes` para registrar que fue admin quien reportó

### Mini app — bloqueo inteligente del botón Report
- Una vez reportado: muestra status + View + Add another
- "View" abre dialog con detalles del reporte (montos, screenshots, notas)
- "Add another" permite reportar otra vez (pagos en partes, correcciones)
- Si fue rechazado: vuelve a aparecer "Report Payment" normal
- Lógica de "período actual" según frecuencia de la cuenta

### Landing page eliminada
- `/` ahora redirige directo a `/login` cuando no hay sesión
- Mantiene flujo de Telegram Mini App intacto

---

## ⏳ Pendiente — Plan original

### 1. Account name en payments list
**Estado:** ❌ No empezado
**Problema:** En `/dashboard/payments` la lista muestra solo `user.telegram_first_name`, no `account.full_name`. En el Payment Details dialog tampoco aparece.
**Solución:** Agregar `account.full_name` en la fila + en el dialog.

### 2. Reports más detallado por cuenta
**Estado:** 🔄 En progreso esta sesión
**Pendiente:**
- Sección "Breakdown by Account" (cada cuenta con su total recibido vs esperado)
- Sección "Breakdown by User" (top payers / underpayers)
- Mostrar nombre de cuenta + plataforma en todas las tablas (no solo user)
- Diferencia paid vs owed por cada item

### 3. Login con contraseña para users sin Telegram
**Estado:** ❌ No empezado
**Pendiente:**
- Aplicar `migration-add-email-auth.sql` en Supabase
- Modificar `/login` para aceptar roles `user` e `ibo` (no solo admin)
- UI en `/dashboard/users` para crear users con email + contraseña
- Link entre `auth.users` (Supabase Auth) y nuestra tabla `users`
- Flujo de bienvenida: enviar URL al user con sus credenciales

### 4. Wallet address + Basescan verification
**Estado:** ❌ No empezado
**Pendiente:**
- Aplicar `migration-add-wallet-address.sql` en Supabase
- Agregar campo `wallet_address` en form de crear/editar cuenta
- Agregar `crypto` como `PaymentMethod` válido
- Endpoint que verifica tx hash contra Basescan API
- UI: cuando user reporta con método crypto, pega tx hash → bot verifica automático
- Variable nueva: `BASESCAN_API_KEY`

### 5. Bot AI conversacional (futuro)
**Estado:** ❌ No empezado
**Idea:** Bot de Telegram que entienda lenguaje natural ("¿quién no pagó?", "confirma pago de Juan").
**Tecnología sugerida:** Claude API integrada al webhook de Telegram.
**Variable nueva:** `ANTHROPIC_API_KEY`

---

## 📋 Pasos manuales pendientes

### En Vercel
- [ ] Agregar variable `CRON_SECRET` (string aleatorio largo)
- [ ] Verificar que aparezcan los 2 cron jobs en Settings → Cron Jobs
- [ ] Redeploy si fue necesario

### En Supabase (cuando hagamos los features)
- [ ] Ejecutar `migration-add-wallet-address.sql` (antes de feature #4)
- [ ] Ejecutar `migration-add-email-auth.sql` (antes de feature #3)
  - **Antes** correr query de duplicados de email para verificar

### Variables de entorno pendientes
| Variable | Cuándo | Dónde conseguirla |
|----------|--------|-------------------|
| `CRON_SECRET` | Ahora | Generar string aleatorio |
| `BASESCAN_API_KEY` | Feature #4 | basescan.org → Account → API Keys |
| `ANTHROPIC_API_KEY` | Feature #5 | console.anthropic.com → API Keys |

---

## 🐛 Bugs / Mejoras observadas
- Falta mostrar nombre de cuenta en las listas de payments confirmed
- Reports no agrupa por cuenta/user — solo lista todos los pagos
- Users sin Telegram no pueden entrar al sistema
- No hay forma de auto-verificar pagos crypto en Base
