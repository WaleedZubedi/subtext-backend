const { loginUser, getUserByEmail } = require('../../lib/supabase');

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields: email, password' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Attempt login
    const authData = await loginUser(email, password);

    // Get user details from our users table
    const user = await getUserByEmail(email);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return success with token and user info
    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name
      },
      session: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        expiresAt: authData.session.expires_at
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    
    // Handle specific auth errors
    if (error.message.includes('Invalid login credentials')) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    return res.status(500).json({ 
      error: 'Failed to login',
      details: error.message 
    });
  }
};