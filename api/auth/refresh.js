const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { refreshToken } = req.body;

    // Validate input
    if (!refreshToken) {
      return res.status(400).json({
        error: 'Missing required field: refreshToken'
      });
    }

    // Create a regular supabase client (not admin)
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Refresh the session
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      console.error('Token refresh error:', error);
      return res.status(401).json({
        error: 'Invalid or expired refresh token',
        details: error.message
      });
    }

    if (!data.session) {
      return res.status(401).json({
        error: 'Failed to refresh session'
      });
    }

    // Return new tokens
    return res.status(200).json({
      message: 'Token refreshed successfully',
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({
      error: 'Failed to refresh token',
      details: error.message
    });
  }
};
