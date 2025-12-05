-- Migration: Add PayPal subscription fields
-- Run this in your Supabase SQL Editor

-- Add new columns to subscriptions table
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS paypal_subscription_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS paypal_plan_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS monthly_limit INTEGER DEFAULT 25,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add index for faster PayPal subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_paypal_id
ON subscriptions(paypal_subscription_id);

-- Add check constraint for valid tiers
ALTER TABLE subscriptions
ADD CONSTRAINT valid_tier
CHECK (tier IN ('basic', 'pro', 'premium'));

-- Add check constraint for valid status
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS valid_status,
ADD CONSTRAINT valid_status
CHECK (status IN ('active', 'cancelled', 'expired', 'suspended'));

-- Update existing subscriptions to have a tier if they don't
UPDATE subscriptions
SET tier = 'basic', monthly_limit = 25
WHERE tier IS NULL;

-- Create or replace function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for subscriptions table
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for usage_tracking table
DROP TRIGGER IF EXISTS update_usage_tracking_updated_at ON usage_tracking;
CREATE TRIGGER update_usage_tracking_updated_at
    BEFORE UPDATE ON usage_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment to document the schema
COMMENT ON COLUMN subscriptions.tier IS 'Subscription tier: basic ($4.99/25), pro ($9.99/100), premium ($19.99/unlimited)';
COMMENT ON COLUMN subscriptions.monthly_limit IS 'Monthly analysis limit. -1 means unlimited';
COMMENT ON COLUMN subscriptions.paypal_subscription_id IS 'PayPal subscription ID for billing';
COMMENT ON COLUMN subscriptions.paypal_plan_id IS 'PayPal plan ID reference';
