# Agent Payment Manager - TODOs

## Última corrección
- [x] Fixed null check error in payments page (hasScreenshots(selectedPayment!) → selectedPayment && hasScreenshots(selectedPayment))
- [x] Removed % and Payment Day columns from Users table
- [x] Added functional View Details dialog
- [x] Added functional Edit dialog (name, email, role, status)
- [x] Added Suspend/Activate toggle functionality
- [x] Added Delete with confirmation dialog
- [x] Added Add User functionality
- [x] Created API endpoints: GET/POST /api/users, GET/PATCH/DELETE /api/users/[id]
- [x] Fixed Next Payment column showing unadjusted dates (now shows Monday instead of Sunday)

## Completado
- [x] Inicializar proyecto Next.js + Shadcn
- [x] Instalar dependencias (Supabase, date-fns, recharts, lucide)
- [x] Crear esquema de base de datos SQL
- [x] Crear tipos TypeScript
- [x] Crear TelegramProvider para Mini App
- [x] Crear utilidades de Telegram (validación, API)
- [x] Dashboard Admin con estadísticas (datos reales de Supabase)
- [x] Página de gestión de usuarios (datos reales de Supabase)
- [x] Página de gestión de pagos con confirmación/rechazo (datos reales)
- [x] Página de cuentas con campos correctos:
  - Nombre completo
  - Email de la cuenta
  - Plataforma
  - **Proyecto/Cliente (SafeRide, Teladoc, Agero, etc.)**
  - Estado (producción/drop/sin proyecto)
  - Porcentaje que el asignado debe pagar
  - Asignación a IBO/usuario
- [x] API de autenticación con Telegram
- [x] Webhook para bot de Telegram
- [x] Todas las APIs conectadas a Supabase (sin datos falsos)
- [x] Subido a GitHub: rubenretro02/payment-manager
- [x] **Página de gestión de proyectos/clientes (similar a plataformas)**
- [x] **Campo de proyecto/cliente en formulario de cuentas**
- [x] **Filtro por proyecto en página de cuentas**
- [x] **API de proyectos (CRUD completo)**
- [x] **Funcionalidad de Edit, Delete, Assign para cuentas**
- [x] **Página My Accounts para usuarios (/dashboard/my-accounts)**
  - Ver cuentas asignadas
  - Reportar pagos con ganancias de plataforma
  - Ver calendario de pagos
- [x] **Página de Payment Methods para admin (/dashboard/payment-methods)**
  - Agregar métodos de pago (Zelle, Binance, Bank, Other)
  - Editar/eliminar métodos
  - Marcar como activo/primario
  - Vista previa de cómo lo verán los usuarios
- [x] **Integración de Payment Methods en My Accounts**
  - Los usuarios ven los métodos de pago del admin
  - Pueden copiar los detalles de pago fácilmente
  - Seleccionar qué método usaron para pagar
- [x] **Dos capturas de pantalla para pagos**
  - Screenshot del pago de la compañía (lo que la empresa les pago)
  - Screenshot del pago enviado (lo que mandaron al admin)
  - Opción de tomar foto con cámara o subir archivo
  - Imágenes se suben a Telegram para ahorrar storage
  - Admin puede ver ambas imágenes con tabs
  - Botón para abrir imagen en nueva pestaña (URL)

## Pendiente - Requiere configuración del usuario
- [ ] Ejecutar el schema SQL actualizado en Supabase
- [ ] Ejecutar migration-add-projects.sql para crear tabla de proyectos
- [ ] Ejecutar migration-add-payment-methods.sql para crear tabla de payment_methods
- [ ] Ejecutar migration-add-dual-screenshots.sql para agregar campos de screenshots
- [ ] Crear bot de Telegram con @BotFather
- [ ] Configurar webhook del bot
- [ ] **Configurar TELEGRAM_STORAGE_CHAT_ID** (crear canal/grupo privado para almacenar imágenes)

## Variables de entorno necesarias
```env
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_key
TELEGRAM_BOT_TOKEN=tu_bot_token
TELEGRAM_STORAGE_CHAT_ID=id_del_canal_para_imagenes  # Crear un canal privado y agregar el bot
```

## Flujo de la aplicación
1. Admin crea proyectos/clientes (SafeRide, Teladoc, Agero, etc.)
2. Admin crea plataformas (LiveOps, Arise, Omni, etc.)
3. **Admin configura sus métodos de pago (Zelle, Binance, etc.)**
4. Admin crea cuentas de trabajo (full_name, email, plataforma, proyecto, %)
5. Admin asigna cuentas a IBOs/usuarios
6. **Usuario ve sus cuentas en /dashboard/my-accounts**
7. **Usuario ve los métodos de pago del admin y selecciona uno**
8. **Usuario toma/sube DOS fotos: pago de compañía + pago enviado**
9. **Fotos se guardan en Telegram (no usan storage de Supabase)**
10. **Usuario reporta ganancias y pago desde su dashboard**
11. **Admin ve ambas fotos en tabs y confirma o rechaza el pago**

## URLs por rol
- **Admin**: /dashboard (completo), /dashboard/accounts, /dashboard/users, /dashboard/payment-methods, etc.
- **IBO**: /dashboard (su equipo), /dashboard/users, etc.
- **User**: /dashboard/my-accounts (portal de usuario)

- [x] **Bottom Navigation actualizado**
  - Accounts, Payments, Pay Methods
  - Iconos claros para cada sección
- [x] **Tarjetas de estadísticas clickeables**
  - My Accounts: filtra por estado (Production, Nesting)
  - Admin Dashboard: navega a Users, Payments, etc.
  - Feedback visual al hacer clic

## Sistema de Notificaciones via Telegram ✅ COMPLETO

### Notificaciones para USUARIOS:
1. ✅ **payment_submitted** - Cuando envía un pago
2. ✅ **payment_confirmed** - Cuando admin confirma su pago
3. ✅ **payment_rejected** - Cuando admin rechaza su pago (con razón)
4. ✅ **payment_reminder** - Recordatorio 1-2 días antes del pago
5. ✅ **payment_overdue** - Cuando el pago está vencido
6. ✅ **new_account_assigned** - Cuando se le asigna una cuenta nueva
7. ✅ **account_status_changed** - Cuando cambia el status de su cuenta
8. ✅ **welcome** - Mensaje de bienvenida

### Notificaciones para ADMINS:
1. ✅ **new_payment_received** - Cuando llega un pago nuevo
2. ✅ **daily_summary** - Resumen diario de pagos pendientes
3. ✅ **overdue_payments_alert** - Alerta de pagos vencidos
4. ✅ **new_user_registered** - Cuando se registra un usuario nuevo

### APIs de Notificaciones:
- `POST /api/notifications/reminders` - Enviar recordatorios (para cron)
- `POST /api/notifications/daily-summary` - Enviar resumen diario a admins
- `POST /api/notifications/send` - Enviar notificación manual

### Cómo configurar recordatorios automáticos:
Usar un servicio de cron como:
- **Vercel Cron** (si está en Vercel)
- **GitHub Actions** (gratis)
- **cron-job.org** (gratis)
- **Render.com** (gratis)

Ejemplo con curl:
```bash
# Enviar recordatorios diarios a las 9 AM
curl -X POST https://tu-app.com/api/notifications/reminders \
  -H "Authorization: Bearer TU_CRON_SECRET"

# Enviar resumen diario a admins a las 8 AM
curl -X POST https://tu-app.com/api/notifications/daily-summary \
  -H "Authorization: Bearer TU_CRON_SECRET"
```

### Variables de entorno necesarias:
```env
TELEGRAM_BOT_TOKEN=tu_bot_token
CRON_SECRET=una_clave_secreta_para_cron  # Opcional
```

## Mejoras futuras
- [ ] Panel de notificaciones en la app (historial)
- [ ] Configuración de preferencias de notificaciones por usuario
- [ ] Reportes y gráficos avanzados
- [ ] Sistema de recordatorios automáticos
- [ ] Exportar a Excel/CSV
