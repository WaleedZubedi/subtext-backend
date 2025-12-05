// Script to create PayPal subscription plans
// Run once: node scripts/create-paypal-plans.js

require('dotenv').config();
const { createSubscriptionPlan } = require('../lib/paypal');

async function createAllPlans() {
  console.log('🚀 Creating PayPal Subscription Plans...\n');

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.error('❌ Error: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  if (!process.env.PAYPAL_PRODUCT_ID) {
    console.error('❌ Error: PAYPAL_PRODUCT_ID must be set in .env');
    console.error('   Create a product in PayPal Dashboard first, then add its ID to .env');
    process.exit(1);
  }

  const tiers = ['basic', 'pro', 'premium'];
  const planIds = {};

  for (const tier of tiers) {
    try {
      console.log(`Creating ${tier} plan...`);
      const plan = await createSubscriptionPlan(tier);
      planIds[tier] = plan.id;
      console.log(`✅ ${tier.toUpperCase()} Plan created: ${plan.id}\n`);
    } catch (error) {
      console.error(`❌ Failed to create ${tier} plan:`, error.message);
    }
  }

  console.log('\n==============================================');
  console.log('📋 Add these to your .env or Vercel environment:');
  console.log('==============================================\n');

  if (planIds.basic) {
    console.log(`PAYPAL_BASIC_PLAN_ID=${planIds.basic}`);
  }
  if (planIds.pro) {
    console.log(`PAYPAL_PRO_PLAN_ID=${planIds.pro}`);
  }
  if (planIds.premium) {
    console.log(`PAYPAL_PREMIUM_PLAN_ID=${planIds.premium}`);
  }

  console.log('\n==============================================\n');
}

createAllPlans().catch(console.error);
