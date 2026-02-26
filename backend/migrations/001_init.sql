-- Базовые таблицы под device_id, мультиязычность и сессии

CREATE TABLE IF NOT EXISTS device_profiles (
    device_id UUID PRIMARY KEY,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- предпочтения (можно хранить аллергии и т.п.)
    allergies JSONB DEFAULT '{}'::jsonb,
    behavior_tags TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- мультиязычность
    preferred_locale TEXT,
    preferred_voices JSONB DEFAULT '{}'::jsonb,

    -- под embeddings профиля (на будущее)
    profile_embedding_id UUID NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES device_profiles(device_id) ON DELETE CASCADE,
    restaurant_id VARCHAR(64) NOT NULL,
    table_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_restaurant_table ON sessions(restaurant_id, table_id);

-- Таблица одноразовых QR-токенов
CREATE TABLE IF NOT EXISTS qr_tokens (
    token TEXT PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    table_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_restaurant_table
    ON qr_tokens (restaurant_id, table_id);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires_at
    ON qr_tokens (expires_at);

-- Таблица заказов
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    restaurant_id VARCHAR(64) NOT NULL,
    table_id VARCHAR(64) NOT NULL,

    status VARCHAR(16) NOT NULL, -- draft, submitted, in_kitchen, ready, served, cancelled

    total_amount NUMERIC(10,2) DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Таблица позиций заказа
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    item_code VARCHAR(64),          -- артикул из меню (потом)
    item_name TEXT NOT NULL,        -- название позиции (для прототипа хватит текста)
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2),       -- можем пока передавать вручную
    modifiers JSONB DEFAULT '{}'::jsonb, -- без сахара, без лука, размер и т.п.
    notes TEXT,                     -- любые дополнительные пожелания

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);


