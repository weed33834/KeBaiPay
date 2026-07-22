-- 分账 Split：split_orders + split_items
CREATE TABLE split_orders (
    id VARCHAR PRIMARY KEY,
    split_no VARCHAR UNIQUE NOT NULL,
    sender_id VARCHAR NOT NULL REFERENCES users(id),
    source_order_no VARCHAR NOT NULL,
    source_amount INTEGER NOT NULL,
    split_amount INTEGER NOT NULL,
    receiver_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status VARCHAR DEFAULT 'PENDING',
    remark VARCHAR,
    idempotency_key VARCHAR UNIQUE,
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_split_orders_sender ON split_orders(sender_id);
CREATE INDEX idx_split_orders_status ON split_orders(status);
CREATE INDEX idx_split_orders_source ON split_orders(source_order_no);
CREATE INDEX idx_split_orders_created ON split_orders(created_at);

CREATE TABLE split_items (
    id VARCHAR PRIMARY KEY,
    split_id VARCHAR NOT NULL REFERENCES split_orders(id),
    receiver_id VARCHAR NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    status VARCHAR DEFAULT 'PENDING',
    transaction_id VARCHAR,
    failure_reason VARCHAR,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_split_items_split ON split_items(split_id);
CREATE INDEX idx_split_items_receiver ON split_items(receiver_id);
CREATE INDEX idx_split_items_status ON split_items(status);
