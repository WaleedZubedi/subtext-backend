// PayPal webhook handler for subscription events
const { verifyWebhookSignature, getSubscriptionDetails, SUBSCRIPTION_PLANS } = require('../../lib/paypal');
const { supabaseAdmin, upsertSubscription } = require('../../lib/supabase');

module.exports = async (req, res) => {
  try {
    // Verify webhook signature (important for security!)
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    if (webhookId) {
      const isValid = await verifyWebhookSignature(webhookId, req.headers, req.body);
      if (!isValid) {
        console.error('⚠️ Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = req.body;
    console.log('📨 PayPal Webhook Event:', event.event_type);

    const subscriptionId = event.resource?.id;

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(event.resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(subscriptionId);
        break;

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        await handleSubscriptionSuspended(subscriptionId);
        break;

      case 'BILLING.SUBSCRIPTION.EXPIRED':
        await handleSubscriptionExpired(subscriptionId);
        break;

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        await handlePaymentFailed(subscriptionId);
        break;

      case 'BILLING.SUBSCRIPTION.RENEWED':
      case 'PAYMENT.SALE.COMPLETED':
        await handleSubscriptionRenewed(subscriptionId);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.event_type}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent PayPal from retrying
    res.status(200).json({ error: error.message });
  }
};

// Handler functions
async function handleSubscriptionActivated(resource) {
  console.log('✅ Subscription activated:', resource.id);

  try {
    // Get full subscription details
    const subscription = await getSubscriptionDetails(resource.id);

    // Find user by PayPal subscription ID or email
    const { data: existingSubscription } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id')
      .eq('paypal_subscription_id', resource.id)
      .single();

    if (existingSubscription) {
      // Determine tier from plan ID
      const tier = getTierFromPlanId(subscription.plan_id);

      await upsertSubscription(existingSubscription.user_id, {
        tier,
        status: 'active',
        paypalSubscriptionId: resource.id,
        paypalPlanId: subscription.plan_id,
        monthlyLimit: SUBSCRIPTION_PLANS[tier].limit,
        expiresAt: subscription.billing_info?.next_billing_time
      });

      console.log(`✅ Subscription activated for user ${existingSubscription.user_id}`);
    }
  } catch (error) {
    console.error('Error handling subscription activation:', error);
  }
}

async function handleSubscriptionCancelled(subscriptionId) {
  console.log('❌ Subscription cancelled:', subscriptionId);

  try {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('paypal_subscription_id', subscriptionId);

    if (error) throw error;
  } catch (error) {
    console.error('Error handling cancellation:', error);
  }
}

async function handleSubscriptionSuspended(subscriptionId) {
  console.log('⏸️ Subscription suspended:', subscriptionId);

  try {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'suspended', updated_at: new Date().toISOString() })
      .eq('paypal_subscription_id', subscriptionId);

    if (error) throw error;
  } catch (error) {
    console.error('Error handling suspension:', error);
  }
}

async function handleSubscriptionExpired(subscriptionId) {
  console.log('⏰ Subscription expired:', subscriptionId);

  try {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('paypal_subscription_id', subscriptionId);

    if (error) throw error;
  } catch (error) {
    console.error('Error handling expiration:', error);
  }
}

async function handlePaymentFailed(subscriptionId) {
  console.log('💳 Payment failed for subscription:', subscriptionId);
  // Could send email notification here
}

async function handleSubscriptionRenewed(subscriptionId) {
  console.log('🔄 Subscription renewed:', subscriptionId);

  try {
    const subscription = await getSubscriptionDetails(subscriptionId);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'active',
        expires_at: subscription.billing_info?.next_billing_time,
        updated_at: new Date().toISOString()
      })
      .eq('paypal_subscription_id', subscriptionId);

    if (error) throw error;
  } catch (error) {
    console.error('Error handling renewal:', error);
  }
}

// Helper to determine tier from PayPal plan ID
function getTierFromPlanId(planId) {
  // You'll need to store plan IDs as environment variables
  // or in database after creating them
  const planMapping = {
    [process.env.PAYPAL_BASIC_PLAN_ID]: 'basic',
    [process.env.PAYPAL_PRO_PLAN_ID]: 'pro',
    [process.env.PAYPAL_PREMIUM_PLAN_ID]: 'premium'
  };

  return planMapping[planId] || 'basic';
}
