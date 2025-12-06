// Supabase client setup for backend
const { createClient } = require('@supabase/supabase-js');

// Service role client - has full access (use only in backend!)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Helper functions for common operations

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Get user by email
 */
async function getUserByEmail(email) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
  return data;
}

/**
 * Create a new user
 */
async function createUser(email, fullName, appleUserId = null) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      email,
      full_name: fullName,
      apple_user_id: appleUserId
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
/**
 * Verify user credentials and return auth token
 */
async function loginUser(email, password) {
	const { data, error } = await supabaseAdmin.auth.signInWithPassword({
	  email,
	  password
	});
	
	if (error) throw error;
	return data;
  }

/**
 * Get user's active subscription
 */
async function getUserSubscription(userId) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

/**
 * Check if user has active subscription
 */
async function isUserSubscribed(userId) {
  const subscription = await getUserSubscription(userId);
  
  if (!subscription) return false;
  
  // Check if subscription hasn't expired
  const now = new Date();
  const expiresAt = new Date(subscription.expires_at);
  
  return expiresAt > now;
}

/**
 * Get or create usage tracking for current month
 */
async function getUserUsage(userId) {
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  
  // Try to get existing usage
  let { data, error } = await supabaseAdmin
    .from('usage_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('month', currentMonth)
    .single();
  
  // If doesn't exist, create it
  if (error && error.code === 'PGRST116') {
    const { data: newUsage, error: insertError } = await supabaseAdmin
      .from('usage_tracking')
      .insert({
        user_id: userId,
        month: currentMonth,
        analyses_count: 0
      })
      .select()
      .single();
    
    if (insertError) throw insertError;
    return newUsage;
  }
  
  if (error) throw error;
  return data;
}

/**
 * Increment usage counter
 */
async function incrementUsage(userId) {
  const usage = await getUserUsage(userId);
  
  const { data, error } = await supabaseAdmin
    .from('usage_tracking')
    .update({
      analyses_count: usage.analyses_count + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', usage.id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Save analysis to history
 */
async function saveAnalysis(userId, analysisData) {
  const { data, error } = await supabaseAdmin
    .from('analyses_history')
    .insert({
      user_id: userId,
      extracted_text: analysisData.extractedText,
      hidden_intent: analysisData.hiddenIntent,
      strategic_response: analysisData.strategicResponse
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Create or update user subscription
 */
async function upsertSubscription(userId, subscriptionData) {
  console.log('🔵 upsertSubscription called with:', { userId, subscriptionData });

  const subscriptionRecord = {
    user_id: userId,
    tier: subscriptionData.tier,
    status: subscriptionData.status,
    paypal_subscription_id: subscriptionData.paypalSubscriptionId,
    paypal_plan_id: subscriptionData.paypalPlanId,
    monthly_limit: subscriptionData.monthlyLimit,
    expires_at: subscriptionData.expiresAt,
    updated_at: new Date().toISOString()
  };

  console.log('📝 Subscription record to insert:', subscriptionRecord);

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(subscriptionRecord, {
      onConflict: 'user_id'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Supabase upsert error:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw error;
  }

  console.log('✅ Subscription upserted successfully:', data);
  return data;
}

/**
 * Cancel user subscription
 */
async function cancelUserSubscription(userId) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Check if user has reached usage limit
 */
async function hasReachedUsageLimit(userId) {
  const subscription = await getUserSubscription(userId);

  if (!subscription) return true; // No subscription = limit reached

  // Unlimited plans have monthly_limit = -1
  if (subscription.monthly_limit === -1) return false;

  const usage = await getUserUsage(userId);
  return usage.analyses_count >= subscription.monthly_limit;
}

  module.exports = {
	supabaseAdmin,
	getUserById,
	getUserByEmail,
	createUser,
	loginUser,
	getUserSubscription,
	isUserSubscribed,
	getUserUsage,
	incrementUsage,
	saveAnalysis,
	upsertSubscription,
	cancelUserSubscription,
	hasReachedUsageLimit
  };