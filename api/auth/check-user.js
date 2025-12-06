const { getUserByEmail } = require('../../lib/supabase');

module.exports = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return res.json({
        exists: false,
        message: 'User not found'
      });
    }

    return res.json({
      exists: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Check user error:', error);
    return res.status(500).json({
      error: 'Failed to check user',
      details: error.message
    });
  }
};
