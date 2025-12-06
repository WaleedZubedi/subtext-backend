// Get available subscription plans
const { SUBSCRIPTION_PLANS } = require('../../lib/paypal');

// PayPal plan ID mapping
const PAYPAL_PLAN_IDS = {
  basic: process.env.PAYPAL_BASIC_PLAN_ID,
  pro: process.env.PAYPAL_PRO_PLAN_ID,
  premium: process.env.PAYPAL_PREMIUM_PLAN_ID
};

module.exports = async (req, res) => {
  try {
    // Return plan information for frontend display
    const plans = Object.keys(SUBSCRIPTION_PLANS).map(tier => ({
      id: tier,
      name: SUBSCRIPTION_PLANS[tier].name,
      price: SUBSCRIPTION_PLANS[tier].price,
      limit: SUBSCRIPTION_PLANS[tier].limit,
      description: SUBSCRIPTION_PLANS[tier].description,
      features: getFeaturesByTier(tier),
      paypalPlanId: PAYPAL_PLAN_IDS[tier] // Include PayPal plan ID for frontend
    }));

    res.json({
      success: true,
      plans
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      error: 'Failed to fetch subscription plans',
      message: error.message
    });
  }
};

function getFeaturesByTier(tier) {
  const baseFeatures = [
    'AI-powered conversation analysis',
    'Hidden intent detection',
    'Manipulation tactics identification',
    'Strategic reply suggestions'
  ];

  const tierFeatures = {
    basic: [
      ...baseFeatures,
      '25 analyses per month',
      'Email support'
    ],
    pro: [
      ...baseFeatures,
      '100 analyses per month',
      'Priority email support',
      'Analysis history'
    ],
    premium: [
      ...baseFeatures,
      'Unlimited analyses',
      'Priority support',
      'Analysis history',
      'Advanced insights',
      'Export to PDF'
    ]
  };

  return tierFeatures[tier] || baseFeatures;
}
