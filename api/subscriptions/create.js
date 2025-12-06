// Create subscription after PayPal payment
const { authenticateUser } = require('../../middleware/auth');
const { getSubscriptionDetails, SUBSCRIPTION_PLANS } = require('../../lib/paypal');
const { upsertSubscription } = require('../../lib/supabase');

module.exports = async (req, res) => {
  // Authenticate user
  await authenticateUser(req, res, async () => {
    try {
      const { subscriptionId, tier } = req.body;

      console.log('📥 Create subscription request:', { subscriptionId, tier, userId: req.userId });

      if (!subscriptionId) {
        console.error('❌ Missing subscription ID');
        return res.status(400).json({
          error: 'Missing subscription ID',
          message: 'PayPal subscription ID is required'
        });
      }

      if (!tier || !SUBSCRIPTION_PLANS[tier]) {
        console.error('❌ Invalid tier:', tier);
        return res.status(400).json({
          error: 'Invalid tier',
          message: 'Tier must be one of: basic, pro, premium'
        });
      }

      // Verify subscription with PayPal
      console.log('🔍 Verifying subscription with PayPal...');
      let paypalSubscription;
      try {
        paypalSubscription = await getSubscriptionDetails(subscriptionId);
        console.log('✅ PayPal subscription details:', {
          id: paypalSubscription.id,
          status: paypalSubscription.status,
          plan_id: paypalSubscription.plan_id
        });
      } catch (paypalError) {
        console.error('❌ PayPal verification failed:', paypalError);
        return res.status(400).json({
          error: 'PayPal verification failed',
          message: paypalError.message || 'Could not verify subscription with PayPal'
        });
      }

      // Check if subscription is active or approved (PayPal may return APPROVED initially)
      const validStatuses = ['ACTIVE', 'APPROVED'];
      if (!validStatuses.includes(paypalSubscription.status)) {
        console.error('❌ Subscription not active:', paypalSubscription.status);
        return res.status(400).json({
          error: 'Subscription not active',
          message: `Subscription status is ${paypalSubscription.status}. Expected ACTIVE or APPROVED.`
        });
      }

      // Calculate expiry date (next billing time from PayPal or 30 days from now)
      const expiresAt = paypalSubscription.billing_info?.next_billing_time
        || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      console.log('💾 Saving subscription to database...');

      // Save to database
      let subscription;
      try {
        subscription = await upsertSubscription(req.userId, {
          tier,
          status: 'active',
          paypalSubscriptionId: subscriptionId,
          paypalPlanId: paypalSubscription.plan_id,
          monthlyLimit: SUBSCRIPTION_PLANS[tier].limit,
          expiresAt
        });
        console.log('✅ Subscription saved:', subscription);
      } catch (dbError) {
        console.error('❌ Database error:', dbError);
        return res.status(500).json({
          error: 'Database error',
          message: 'Failed to save subscription. Please contact support.'
        });
      }

      console.log('🎉 Subscription created successfully for user:', req.userId);

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
      console.error('❌ Subscription creation error:', error);
      res.status(500).json({
        error: 'Failed to create subscription',
        message: error.message || 'An unexpected error occurred'
      });
    }
  });
};
