-- 优惠券 Coupon：coupons + user_coupons
CREATE TABLE coupons (
    id VARCHAR PRIMARY KEY,
    coupon_no VARCHAR UNIQUE NOT NULL,
    owner_id VARCHAR NOT NULL REFERENCES users(id),
    name VARCHAR NOT NULL,
    type VARCHAR DEFAULT 'FIXED',
    value INTEGER NOT NULL,
    min_amount INTEGER DEFAULT 0,
    total_quota INTEGER DEFAULT 0,
    issued_count INTEGER DEFAULT 0,
    per_user_limit INTEGER DEFAULT 1,
    status VARCHAR DEFAULT 'ACTIVE',
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_coupons_owner ON coupons(owner_id);
CREATE INDEX idx_coupons_status ON coupons(status);

CREATE TABLE user_coupons (
    id VARCHAR PRIMARY KEY,
    user_coupon_no VARCHAR UNIQUE NOT NULL,
    coupon_id VARCHAR NOT NULL REFERENCES coupons(id),
    user_id VARCHAR NOT NULL REFERENCES users(id),
    status VARCHAR DEFAULT 'AVAILABLE',
    used_at TIMESTAMP,
    used_order_no VARCHAR,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_user_coupons_coupon ON user_coupons(coupon_id);
CREATE INDEX idx_user_coupons_user ON user_coupons(user_id);
CREATE INDEX idx_user_coupons_status ON user_coupons(status);
