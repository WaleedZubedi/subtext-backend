// Create subscription after PayPal payment
const { authenticateUser } = require('../../middleware/auth');
const { getSubscriptionDetails } = require('../../lib/paypal');
const { upsertSubscription } = require('../../lib/supabase');
const { SUBSCRIPTION_PLANS } = require('../../lib/paypal');

module.exports = async (req, res) => {
  // Authenticate user
  await authenticateUser(req, res, async () => {
    try {
      const { subscriptionId, tier } = req.body;

      if (!subscriptionId) {
        return res.status(400).json({
          error: 'Missing subscription ID',
          message: 'PayPal subscription ID is required'
        });
      }

      if (!tier || !SUBSCRIPTION_PLANS[tier]) {
        return res.status(400).json({
          error: 'Invalid tier',
          message: 'Tier must be one of: basic, pro, premium'
        });
      }

      // Verify subscription with PayPal
      const paypalSubscription = await getSubscriptionDetails(subscriptionId);

      // Check if subscription is active
      if (paypalSubscription.status !== 'ACTIVE') {
        return res.status(400).json({
          error: 'Subscription not active',
          message: `Subscription status: ${paypalSubscription.status}`
        });
      }

      // Calculate expiry date (next billing time from PayPal)
      const expiresAt = paypalSubscription.billing_info?.next_billing_time
        || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // Default: 30 days

      // Save to database
      const subscription = await upsertSubscription(req.userId, {
        tier,
        status: 'active',
        paypalSubscriptionId: subscriptionId,
        paypalPlanId: paypalSubscription.plan_id,
        monthlyLimit: SUBSCRIPTION_PLANS[tier].limit,
        expiresAt
      });

      res.json({
        success: true,
        subscription: {
          tier: subscription.tier,
          status: subscription.status,
          monthlyLimit: subscription.monthly_limit,
          expiresAt: subscription.expires_at
        }
      });

    } catch (error) {
      console.error('Subscription creation error:', error);
      res.status(500).json({
        error: 'Failed to create subscription',
        message: error.message
      });
    }
  });
};
