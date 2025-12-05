# PayPal Integration Setup Guide

## 1. Create PayPal Business Account

1. Go to https://www.paypal.com/business
2. Click "Sign Up" and create a Business account
3. Complete the verification process

## 2. Get PayPal API Credentials

### For Testing (Sandbox):
1. Go to https://developer.paypal.com/
2. Log in with your PayPal account
3. Go to "Dashboard" → "My Apps & Credentials"
4. Under "Sandbox", click "Create App"
5. Name your app (e.g., "SubText")
6. Copy the **Client ID** and **Secret**

### For Production (Live):
1. Same steps as above, but use the "Live" section
2. Your app must be reviewed and approved by PayPal

## 3. Create a Product in PayPal

1. Go to PayPal Dashboard → "Products & Services"
2. Click "Create Product"
3. Name: "SubText Conversation Analysis"
4. Type: "Digital Product" or "Service"
5. Save and copy the **Product ID**

## 4. Create Subscription Plans

You can create plans manually in PayPal Dashboard or use the backend script:

```bash
# Run this script once to create all three plans
node scripts/create-paypal-plans.js
```

This will create:
- **Basic Plan**: $4.99/month (25 analyses)
- **Pro Plan**: $9.99/month (100 analyses)
- **Premium Plan**: $19.99/month (Unlimited analyses)

Copy the Plan IDs returned by the script.

## 5. Set Up Webhooks

1. Go to PayPal Dashboard → "Webhooks"
2. Click "Add Webhook"
3. Webhook URL: `https://your-backend-url.vercel.app/api/webhooks/paypal`
4. Select these event types:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - `BILLING.SUBSCRIPTION.RENEWED`
   - `PAYMENT.SALE.COMPLETED`
5. Save and copy the **Webhook ID**

## 6. Environment Variables

Add these to your Vercel backend environment variables:

### Required Variables:

```bash
# Existing Supabase credentials (already set)
SUPABASE_URL=https://iovqftvkvdqftixwtylv.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key

# Existing OpenAI (already set in Vercel)
OPENAI_API_KEY=sk-your-openai-key

# NEW: PayPal Credentials
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_secret
PAYPAL_PRODUCT_ID=your_product_id
PAYPAL_MODE=sandbox  # Change to 'live' for production

# NEW: PayPal Plan IDs (from step 4)
PAYPAL_BASIC_PLAN_ID=P-xxxxxxxxxxxxx
PAYPAL_PRO_PLAN_ID=P-xxxxxxxxxxxxx
PAYPAL_PREMIUM_PLAN_ID=P-xxxxxxxxxxxxx

# NEW: PayPal Webhook ID (from step 5)
PAYPAL_WEBHOOK_ID=your_webhook_id
```

## 7. Database Migration

Run this SQL in your Supabase SQL Editor:

```sql
-- See migrations/001_add_paypal_subscriptions.sql
```

Go to Supabase Dashboard → SQL Editor → paste the contents of the migration file → Run.

## 8. Deploy Backend

```bash
cd "SubText BackEnd"

# Commit changes
git add .
git commit -m "Add PayPal subscription integration"

# Push to GitHub (Vercel will auto-deploy)
git push origin main
```

## 9. Verify Setup

Test the endpoints:

1. **Get Plans**: `GET https://your-backend.vercel.app/api/subscriptions/plans`
2. **Health Check**: `GET https://your-backend.vercel.app/api`

## 10. Frontend Integration

The frontend will use PayPal's JavaScript SDK to create subscription buttons.

Add to your frontend's `app.json` or HTML:

```html
<script src="https://www.paypal.com/sdk/js?client-id=YOUR_CLIENT_ID&vault=true&intent=subscription"></script>
```

## Testing Flow

1. User signs up → redirected to subscription page
2. User selects plan (Basic, Pro, or Premium)
3. PayPal button appears
4. User clicks button → PayPal popup opens
5. User completes payment → PayPal subscription created
6. Frontend receives subscription ID
7. Frontend calls `/api/subscriptions/create` with subscription ID
8. Backend verifies with PayPal and saves to database
9. User can now use the app based on their tier limits

## Troubleshooting

### Common Issues:

1. **"Invalid client credentials"**
   - Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are correct
   - Make sure you're using Sandbox credentials in sandbox mode

2. **"Subscription not found"**
   - Verify subscription ID is correct
   - Check PayPal mode (sandbox vs live)

3. **"Webhook verification failed"**
   - Ensure PAYPAL_WEBHOOK_ID is set
   - Check webhook URL is accessible publicly

4. **Database errors**
   - Make sure migration has been run
   - Check Supabase connection

## Production Checklist

Before going live:

- [ ] Switch to PayPal Live credentials
- [ ] Change `PAYPAL_MODE=live`
- [ ] Update webhook URL to production backend
- [ ] Test with real PayPal account (small amounts first)
- [ ] Verify subscription cancellation works
- [ ] Test usage limits enforcement
- [ ] Set up email notifications for failed payments

## Support

- PayPal Developer Docs: https://developer.paypal.com/docs/
- PayPal Subscriptions API: https://developer.paypal.com/docs/subscriptions/
- PayPal Support: https://www.paypal.com/us/smarthelp/contact-us
