-- =============================================
-- AGENT PAYMENT MANAGER - DATABASE SCHEMA
-- =============================================
-- Ejecutar este SQL en Supabase SQL Editor

-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABLA: users (Todos los usuarios del sistema)
-- =============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE, -- ID de Telegram para SSO
    telegram_username TEXT,
    telegram_first_name TEXT,
    telegram_last_name TEXT,
    telegram_photo_url TEXT,
    phone TEXT,
    email TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'ibo', 'user')),
    parent_id UUID REFERENCES users(id), -- IBO del usuario (o NULL si es admin/ibo directo)
    percentage DECIMAL(5,2) DEFAULT 50.00, -- Porcentaje que debe pagar
    payment_day INTEGER CHECK (payment_day >= 1 AND payment_day <= 31),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: platforms (LiveOps, Arise, Omni, etc)
-- =============================================
CREATE TABLE platforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    payment_schedule TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar plataformas por defecto
INSERT INTO platforms (name, display_name, payment_schedule) VALUES
    ('liveops', 'LiveOps', 'Semanal - Viernes'),
    ('arise', 'Arise', 'Quincenal'),
    ('omni', 'Omni Interactions', 'Semanal');

-- =============================================
-- TABLA: accounts (Cuentas de trabajo)
-- =============================================
-- Estas son las cuentas que el admin asigna a IBOs/usuarios
-- El IBO/usuario debe pagar un porcentaje de sus ganancias
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id UUID REFERENCES platforms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- IBO/Usuario asignado (NULL si no asignada)

    -- Datos de la cuenta
    full_name TEXT NOT NULL, -- Nombre completo de la cuenta
    account_email TEXT NOT NULL, -- Email de la cuenta
    percentage DECIMAL(5,2) DEFAULT 50.00, -- Porcentaje que debe pagar el asignado

    -- Configuración de pagos
    -- payment_frequency: 'weekly' (semanal), 'biweekly' (quincenal: 1 y 16), 'monthly' (mensual)
    payment_frequency TEXT DEFAULT 'weekly' CHECK (payment_frequency IN ('weekly', 'biweekly', 'monthly')),
    -- payment_day: Para weekly = día de la semana (0=Dom, 5=Vie), Para monthly = día del mes (1-31)
    payment_day INTEGER DEFAULT 5, -- Por defecto viernes
    -- Próxima fecha de pago calculada (ajustada por fines de semana y feriados USA)
    next_payment_date TIMESTAMPTZ,

    -- Estado: production (trabajando), drop (dado de baja), not_in_project (sin proyecto)
    status TEXT DEFAULT 'production' CHECK (status IN ('production', 'drop', 'not_in_project')),

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: payment_periods (Períodos de pago)
-- =============================================
CREATE TABLE payment_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id UUID REFERENCES platforms(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    payment_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: payments (Pagos de usuarios)
-- =============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    period_id UUID REFERENCES payment_periods(id) ON DELETE SET NULL,

    -- Montos
    platform_amount DECIMAL(12,2), -- Lo que ganó en la plataforma
    percentage_applied DECIMAL(5,2) NOT NULL, -- Porcentaje que aplica
    amount_owed DECIMAL(12,2) NOT NULL, -- Lo que debe pagar
    amount_paid DECIMAL(12,2) DEFAULT 0, -- Lo que ha pagado

    -- Comprobante
    screenshot_url TEXT,
    screenshot_uploaded_at TIMESTAMPTZ,

    -- Método de pago
    payment_method TEXT CHECK (payment_method IN ('transfer', 'binance', 'zelle', 'other')),
    payment_reference TEXT,

    -- Estado
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'rejected', 'partial')),

    -- Fechas
    due_date DATE,
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES users(id),

    -- Notas
    user_notes TEXT,
    admin_notes TEXT,
    rejection_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: notifications
-- =============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('payment_reminder', 'payment_confirmed', 'payment_rejected', 'new_account', 'system')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: activity_log
-- =============================================
CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ÍNDICES
-- =============================================
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_parent_id ON users(parent_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_platform_id ON accounts(platform_id);
CREATE INDEX idx_accounts_status ON accounts(status);
CREATE INDEX idx_accounts_next_payment ON accounts(next_payment_date);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_due_date ON payments(due_date);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);

-- =============================================
-- FUNCIONES
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Políticas básicas (ajustar según necesidades)
CREATE POLICY "Allow all for authenticated" ON users FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON accounts FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON payments FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON notifications FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON platforms FOR ALL USING (true);

-- =============================================
-- COMENTARIOS SOBRE LA CONFIGURACIÓN DE PAGOS
-- =============================================
-- payment_frequency:
--   'weekly' - Pago semanal (ej: cada viernes)
--   'biweekly' - Quincenal (días 1 y 16 de cada mes)
--   'monthly' - Mensual (día específico del mes)
--
-- payment_day:
--   Para 'weekly': 0=Domingo, 1=Lunes, ..., 5=Viernes, 6=Sábado
--   Para 'biweekly': No se usa (siempre 1 y 16)
--   Para 'monthly': 1-31 (día del mes)
--
-- next_payment_date:
--   Se calcula automáticamente considerando:
--   - Fines de semana (se mueve al siguiente lunes)
--   - Feriados federales de USA (se mueve al siguiente día hábil)
