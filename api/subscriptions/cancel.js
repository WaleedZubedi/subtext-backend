// Cancel subscription
const { authenticateUser } = require('../../middleware/auth');
const { cancelSubscription } = require('../../lib/paypal');
const { getUserSubscription, cancelUserSubscription } = require('../../lib/supabase');

module.exports = async (req, res) => {
  await authenticateUser(req, res, async () => {
    try {
      // Get user's subscription from database
      const subscription = await getUserSubscription(req.userId);

      if (!subscription) {
        return res.status(404).json({
          error: 'No subscription found',
          message: 'You do not have an active subscription'
        });
      }

      if (!subscription.paypal_subscription_id) {
        return res.status(400).json({
          error: 'Invalid subscription',
          message: 'No PayPal subscription ID found'
        });
      }

      // Cancel in PayPal
      await cancelSubscription(
        subscription.paypal_subscription_id,
        req.body.reason || 'User requested cancellation'
      );

      // Update database
      await cancelUserSubscription(req.userId);

      res.json({
        success: true,
        message: 'Subscription cancelled successfully'
      });

    } catch (error) {
      console.error('Subscription cancellation error:', error);
      res.status(500).json({
        error: 'Failed to cancel subscription',
        message: error.message
      });
    }
  });
};
