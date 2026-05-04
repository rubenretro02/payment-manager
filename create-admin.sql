-- =============================================
-- CREAR ADMIN: clifordzhughes@gmail.com
-- =============================================
--
-- PASO 1: Primero ve a Supabase Dashboard > Authentication > Users
--         Click "Add User" > Email: clifordzhughes@gmail.com, Password: 123456
--
-- PASO 2: Ejecuta este SQL completo

-- Permitir NULL en telegram_id (para admins que usan email/password)
ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

-- Agregar constraint UNIQUE a email si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
END $$;

-- Insertar admin
INSERT INTO users (
    telegram_id,
    telegram_username,
    telegram_first_name,
    email,
    role,
    percentage,
    status,
    created_at,
    updated_at
) VALUES (
    NULL,
    'clifordzhughes',
    'Cliford',
    'clifordzhughes@gmail.com',
    'admin',
    0,
    'active',
    NOW(),
    NOW()
)
ON CONFLICT (email) DO UPDATE SET
    role = 'admin',
    status = 'active',
    updated_at = NOW();

-- Verificar
SELECT id, email, role, status FROM users WHERE email = 'clifordzhughes@gmail.com';
