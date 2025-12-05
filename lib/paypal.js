// PayPal API integration using REST API directly
const fetch = require('node-fetch');

// PayPal API base URL (change to production when ready)
const PAYPAL_API_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Subscription plan configurations
const SUBSCRIPTION_PLANS = {
  basic: {
    name: 'Basic Plan',
    price: '4.99',
    limit: 25,
    description: '25 conversation analyses per month'
  },
  pro: {
    name: 'Pro Plan',
    price: '9.99',
    limit: 100,
    description: '100 conversation analyses per month'
  },
  premium: {
    name: 'Premium Plan',
    price: '19.99',
    limit: -1, // -1 means unlimited
    description: 'Unlimited conversation analyses'
  }
};

/**
 * Get PayPal access token
 */
async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${data.error_description || data.error}`);
  }

  return data.access_token;
}

/**
 * Create a subscription plan in PayPal
 * Only needs to be run once per plan
 */
async function createSubscriptionPlan(tier) {
  const plan = SUBSCRIPTION_PLANS[tier];
  if (!plan) throw new Error(`Invalid tier: ${tier}`);

  const accessToken = await getAccessToken();

  const planData = {
    product_id: process.env.PAYPAL_PRODUCT_ID, // You'll create this product in PayPal dashboard
    name: plan.name,
    description: plan.description,
    status: 'ACTIVE',
    billing_cycles: [
      {
        frequency: {
          interval_unit: 'MONTH',
          interval_count: 1
        },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // 0 = infinite
        pricing_scheme: {
          fixed_price: {
            value: plan.price,
            currency_code: 'USD'
          }
        }
      }
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee: {
        value: '0',
        currency_code: 'USD'
      },
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3
    }
  };

  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(planData)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`PayPal plan creation failed: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Get subscription details from PayPal
 */
async function getSubscriptionDetails(subscriptionId) {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to get subscription: ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Cancel a subscription in PayPal
 */
async function cancelSubscription(subscriptionId, reason = 'User requested cancellation') {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    }
  );

  // Cancel returns 204 No Content on success
  if (response.status === 204) {
    return { success: true };
  }

  const data = await response.json();
  throw new Error(`Failed to cancel subscription: ${data.message || JSON.stringify(data)}`);
}

/**
 * Verify webhook signature from PayPal
 */
async function verifyWebhookSignature(webhookId, headers, body) {
  const accessToken = await getAccessToken();

  const verificationData = {
    transmission_id: headers['paypal-transmission-id'],
    transmission_time: headers['paypal-transmission-time'],
    cert_url: headers['paypal-cert-url'],
    auth_algo: headers['paypal-auth-algo'],
    transmission_sig: headers['paypal-transmission-sig'],
    webhook_id: webhookId,
    webhook_event: body
  };

  const response = await fetch(
    `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verificationData)
    }
  );

  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}

module.exports = {
  SUBSCRIPTION_PLANS,
  getAccessToken,
  createSubscriptionPlan,
  getSubscriptionDetails,
  cancelSubscription,
  verifyWebhookSignature,
  PAYPAL_API_BASE
};
