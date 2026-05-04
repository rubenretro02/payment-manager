# Payment Manager - TODOs

## Cambios Completados

- [x] 1. Mostrar solo cuentas en "Production" y "Nesting" en Report Payment
- [x] 2. Añadir botón "No Payment" / "Issue" debajo de Report Payment (en rojo) con campo de explicación
- [x] 3. Cambiar "Payment Method" a "Payment Method Used" para clarificar que es un reporte
- [x] 4. Arreglar error de cámara - mejorado manejo de archivos con MIME type correcto
- [x] 5. Verificar si se usa Supabase o Telegram como storage para las fotos
- [x] 6. Hacer todas las tarjetas de stats clickeables para filtrar
- [x] 7. Mostrar contador de resultados cuando se filtra

## PROBLEMA ENCONTRADO: Fotos en Base64

**Las fotos van a base64 porque NO hay archivo `.env` configurado.**

El proyecto necesita un archivo `.env.local` con las siguientes variables:

```env
# Supabase (ya deberías tenerlas)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Telegram - ESTAS SON LAS QUE FALTAN
TELEGRAM_BOT_TOKEN=tu-bot-token
TELEGRAM_STORAGE_CHAT_ID=-100xxxxxxxxxx
```

### Pasos para arreglar:

1. Ve a donde tienes desplegada la app (Netlify, Vercel, etc.)
2. Configura las variables de entorno:
   - `TELEGRAM_BOT_TOKEN` - El token de tu bot de BotFather
   - `TELEGRAM_STORAGE_CHAT_ID` - El ID del canal privado (empieza con -100)

3. Para obtener el STORAGE_CHAT_ID:
   - Crea un canal privado en Telegram
   - Añade tu bot como administrador
   - Envía cualquier mensaje al canal
   - Ve a: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Busca el `chat_id` del canal (formato: `-100XXXXXXXXXX`)

### Endpoint de diagnóstico:
Puedes verificar la configuración visitando: `/api/telegram/check-config`

## Notas sobre Storage
- Las fotos se suben a **Telegram** como storage (canal privado)
- Si falla Telegram o no está configurado, se usa **base64** como fallback
- Base64 funciona pero consume más espacio en la base de datos
