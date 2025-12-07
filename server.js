require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer configuration for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Import handlers and middleware
const signupHandler = require('./api/auth/signup');
const loginHandler = require('./api/auth/login');
const logoutHandler = require('./api/auth/logout');
const checkUserHandler = require('./api/auth/check-user');
const refreshTokenHandler = require('./api/auth/refresh');
const { authenticateUser } = require('./middleware/auth');
const { isUserSubscribed, incrementUsage, saveAnalysis, getUserSubscription, hasReachedUsageLimit, getUserUsage } = require('./lib/supabase');

// Import subscription handlers
const getPlansHandler = require('./api/subscriptions/plans');
const createSubscriptionHandler = require('./api/subscriptions/create');
const cancelSubscriptionHandler = require('./api/subscriptions/cancel');
const paypalWebhookHandler = require('./api/webhooks/paypal');

// In-memory cache for analysis results (simple implementation)
const analysisCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

// Rate limiting map (userId -> array of timestamps)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 3600000; // 1 hour
const RATE_LIMIT_MAX = 20; // 20 requests per hour

// Helper: Check rate limit
function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(userId) || [];
  
  // Remove old requests outside the window
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX) {
    return false; // Rate limit exceeded
  }
  
  // Add current request
  recentRequests.push(now);
  rateLimitMap.set(userId, recentRequests);
  
  return true; // Within rate limit
}

// Helper: Generate cache key from image buffer
function generateCacheKey(buffer, userId) {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(buffer).digest('hex');
  return `${userId}_${hash}`;
}

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'SubText API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({ 
    status: 'SubText API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// AUTH ROUTES
// ============================================

app.post('/api/auth/signup', signupHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', logoutHandler);
app.post('/api/auth/refresh', refreshTokenHandler);
app.get('/api/auth/check-user', checkUserHandler);

// ============================================
// SUBSCRIPTION MANAGEMENT ENDPOINTS
// ============================================

// Get available subscription plans
app.get('/api/subscriptions/plans', getPlansHandler);

// Create subscription after PayPal payment
app.post('/api/subscriptions/create', createSubscriptionHandler);

// Cancel subscription
app.post('/api/subscriptions/cancel', cancelSubscriptionHandler);

// PayPal webhook for subscription events
app.post('/api/webhooks/paypal', express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); }}), paypalWebhookHandler);

// ============================================
// SUBSCRIPTION STATUS ENDPOINT
// ============================================

app.get('/api/subscription/status', authenticateUser, async (req, res) => {
  try {
    const subscription = await getUserSubscription(req.userId);
    const usage = await getUserUsage(req.userId);

    if (!subscription) {
      return res.json({
        hasSubscription: false,
        subscription: null,
        usage: {
          current: usage.analyses_count,
          limit: 0,
          remaining: 0
        }
      });
    }

    // Check if subscription is active and not expired
    const isActive = subscription.status === 'active';
    const notExpired = new Date(subscription.expires_at) > new Date();
    const hasSubscription = isActive && notExpired;

    // Calculate usage stats
    const limit = subscription.monthly_limit === -1 ? 'unlimited' : subscription.monthly_limit;
    const remaining = subscription.monthly_limit === -1
      ? 'unlimited'
      : Math.max(0, subscription.monthly_limit - usage.analyses_count);

    res.json({
      hasSubscription,
      subscription: hasSubscription ? {
        tier: subscription.tier,
        expiresAt: subscription.expires_at,
        monthlyLimit: subscription.monthly_limit
      } : null,
      usage: {
        current: usage.analyses_count,
        limit,
        remaining
      }
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.json({
      hasSubscription: false,
      subscription: null,
      usage: {
        current: 0,
        limit: 0,
        remaining: 0
      }
    });
  }
});

// ============================================
// OCR ENDPOINT - Image Upload & Text Extraction
// ============================================

app.post('/api/ocr', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    console.log('=== OCR REQUEST START ===');
    console.log('User ID:', req.userId);

    // Rate limiting check
    if (!checkRateLimit(req.userId)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'You are making too many requests. Please wait a few minutes and try again.'
      });
    }

    // Check if user has active subscription
    const hasSubscription = await isUserSubscribed(req.userId);
    if (!hasSubscription) {
      return res.status(403).json({
        error: 'Subscription required',
        message: 'Please subscribe to use this feature'
      });
    }

    // Check if user has reached usage limit
    const limitReached = await hasReachedUsageLimit(req.userId);
    if (limitReached) {
      const subscription = await getUserSubscription(req.userId);
      const usage = await getUserUsage(req.userId);

      return res.status(403).json({
        error: 'Usage limit reached',
        message: `You've used ${usage.analyses_count} of your ${subscription.monthly_limit} monthly analyses. Please upgrade your plan for more.`,
        usage: {
          current: usage.analyses_count,
          limit: subscription.monthly_limit
        }
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        error: 'No image provided',
        message: 'Please upload an image'
      });
    }

    // Check cache
    const imageBuffer = req.file.buffer;
    const cacheKey = generateCacheKey(imageBuffer, req.userId);
    const cachedResult = analysisCache.get(cacheKey);
    
    if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_TTL)) {
      console.log('✅ Returning cached result');
      return res.json({
        ParsedResults: [{
          ParsedText: cachedResult.text
        }],
        cached: true
      });
    }

    // Convert image to base64 for OpenAI Vision
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    console.log('📤 Sending to OpenAI Vision API...');

    // Use OpenAI Vision API to extract LEFT-SIDE messages only
    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are analyzing a screenshot from ANY messaging app (iMessage, WhatsApp, Instagram, Snapchat, Facebook, etc.).

YOUR TASK: Extract ONLY the messages that the phone owner RECEIVED (not the ones they sent).

UNIVERSAL IDENTIFICATION RULES:

1. **VISUAL POSITION**:
   - Messages on the LEFT side = RECEIVED (extract these) ✅
   - Messages on the RIGHT side = SENT by user (ignore these) ❌

2. **BUBBLE ALIGNMENT**:
   - Left-aligned bubbles = RECEIVED ✅
   - Right-aligned bubbles = SENT ❌

3. **COLOR PATTERNS** (varies by app):
   - iMessage: Gray = received, Blue = sent
   - WhatsApp: White/Light gray = received, Green = sent
   - Instagram: Purple/Gray = received, Purple gradient = sent
   - Facebook: Gray = received, Blue = sent
   - Snapchat: Red = received, Blue = sent
   - Generic rule: Lighter/neutral colors = usually received

4. **MESSAGE CONTENT CLUES**:
   - Questions/requests directed AT someone = RECEIVED ✅
   - Responses/answers = SENT ❌

CRITICAL INSTRUCTIONS:
- Focus on POSITION (left vs right) as the PRIMARY indicator
- Use color as a SECONDARY indicator
- Only extract complete messages
- Ignore timestamps, "Delivered", "Read", names, status indicators
- If this is NOT a conversation screenshot, return: "ERROR: This image does not contain text messages"

OUTPUT FORMAT:
RECEIVED_MESSAGES_START
[Message 1 that user received]
[Message 2 that user received]
RECEIVED_MESSAGES_END

If you cannot identify text messages, return:
ERROR: This image does not contain text messages`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.1
      })
    });

    if (!visionResponse.ok) {
      const errorData = await visionResponse.json();
      console.error('OpenAI API error:', errorData);
      return res.status(500).json({ 
        error: 'Vision API failed',
        message: 'Failed to process image. Please try again.'
      });
    }

    const visionData = await visionResponse.json();

    if (!visionData.choices?.[0]?.message?.content) {
      return res.status(500).json({ 
        error: 'No response from Vision API',
        message: 'Failed to extract text from image. Please try again.'
      });
    }

    const responseContent = visionData.choices[0].message.content.trim();
    console.log('=== VISION API RESPONSE ===');
    console.log('Length:', responseContent.length);
    console.log('Content:', responseContent);
    console.log('===========================');

    // Check if image doesn't contain messages
    if (responseContent.includes('ERROR:') || 
        responseContent.toLowerCase().includes('does not contain text messages') ||
        responseContent.toLowerCase().includes('not a conversation')) {
      return res.status(400).json({ 
        error: 'Invalid image',
        message: 'This image does not appear to contain text messages. Please upload a screenshot of a conversation.'
      });
    }

    // Extract only RECEIVED messages
    const startMarker = 'RECEIVED_MESSAGES_START';
    const endMarker = 'RECEIVED_MESSAGES_END';

    const startIndex = responseContent.indexOf(startMarker);
    const endIndex = responseContent.indexOf(endMarker);

    let extractedText;

    if (startIndex !== -1 && endIndex !== -1) {
      const messagesSection = responseContent.substring(
        startIndex + startMarker.length,
        endIndex
      ).trim();

      extractedText = messagesSection;
      console.log('✅ Found marked section:', extractedText.substring(0, 100) + '...');
    } else {
      // Fallback - use entire response
      console.log('⚠️ No markers found, using entire response');
      extractedText = responseContent;
    }

    // Robust validation - check if we got actual text content
    const hasContent = extractedText && extractedText.trim().length > 0;
    const isErrorMessage = extractedText && (
      extractedText.toLowerCase().includes('no text messages') ||
      extractedText.toLowerCase().includes('cannot identify') ||
      extractedText.toLowerCase().includes('unable to') ||
      extractedText.toLowerCase().startsWith('error')
    );

    if (!hasContent || isErrorMessage) {
      console.log('❌ Validation failed:', { hasContent, isErrorMessage, extractedText: extractedText?.substring(0, 50) });
      return res.status(400).json({
        error: 'No messages found',
        message: 'Could not find any text messages in this image. Please upload a clear screenshot of a conversation.'
      });
    }

    console.log('✅ Extracted messages:', extractedText.substring(0, 100) + '...');

    // Cache the result
    analysisCache.set(cacheKey, {
      text: extractedText,
      timestamp: Date.now()
    });

    // Clean up old cache entries (keep cache size manageable)
    if (analysisCache.size > 100) {
      const oldestKey = analysisCache.keys().next().value;
      analysisCache.delete(oldestKey);
    }

    // Increment usage counter (async, don't wait)
    incrementUsage(req.userId).catch(err => 
      console.error('Usage increment error:', err)
    );

    // Return extracted text
    res.json({
      ParsedResults: [{
        ParsedText: extractedText
      }]
    });

  } catch (error) {
    console.error('❌ OCR error:', error);
    res.status(500).json({ 
      error: 'Processing failed',
      message: 'An error occurred while processing your image. Please try again.'
    });
  }
});

// ============================================
// MESSAGE EXTRACTION ENDPOINT (LEGACY - KEPT FOR COMPATIBILITY)
// ============================================

app.post('/api/extract', async (req, res) => {
  try {
    const { rawText } = req.body;

    if (!rawText) {
      return res.status(400).json({ 
        error: 'No text provided',
        message: 'Please provide text to extract'
      });
    }

    // Simple extraction - just pass through
    // Vision API already did the extraction
    res.json({
      choices: [{
        message: {
          content: `EXTRACTED_MESSAGES_START\n${rawText}\nEXTRACTED_MESSAGES_END`
        }
      }]
    });

  } catch (error) {
    console.error('❌ Extraction Error:', error);
    res.status(500).json({ 
      error: 'Extraction failed',
      message: 'Failed to extract messages'
    });
  }
});

// ============================================
// ANALYSIS ENDPOINT - Psychological Analysis
// ============================================

app.post('/api/analyze', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Invalid input',
        message: 'Please provide messages to analyze'
      });
    }

    if (messages.length === 0) {
      return res.status(400).json({ 
        error: 'No messages',
        message: 'No messages found to analyze'
      });
    }

    console.log('🧠 Analyzing', messages.length, 'messages...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You analyze text conversations and expose manipulation tactics with brutal honesty.

CRITICAL RULES:
- Use SIMPLE, everyday language (no academic jargon)
- Strategic reply must DIRECTLY respond to what they said
- Reply should feel like a natural next message in the conversation
- Reply should catch them off guard by exposing their game
- Reply should flow naturally but hit hard
- Analyze ALL messages TOGETHER as ONE conversation
- Give ONE strategic reply that addresses the entire conversation

ANALYSIS STYLE:
❌ BAD: "Narcissistic supply-seeking behavior manifesting through excessive positive reinforcement"
✅ GOOD: "Fishing for compliments and validation"

REPLY STYLE:
The reply must:
1. Make sense as the next message in the conversation
2. Reference something they actually said
3. Catch them off guard by seeing through their bullshit
4. Sound casual/natural, not scripted
5. Be brutal but conversational

FORMAT:

**Hidden Intent:**
[Simple description] → [What they're really doing in plain English]

**Behavior Type:**
[ONE LABEL]

**Strategic Reply:**
[Natural response that flows from the conversation but exposes their game]

KEY PRINCIPLES FOR STRATEGIC REPLY:
1. **Reference what they actually said** - "You always do X when Y"
2. **Point out their pattern** - "Every time you... you always..."
3. **Ask what they really want** - "What do you actually want?" / "What's this really about?"
4. **Use casual language** - lol, haha, ... (makes it less aggressive)
5. **Catch them off guard** - They don't expect you to see through it
6. **Stay conversational** - Should sound like something a friend would text

GOOD REPLIES (Do this):
✅ "You're being extra sweet today, what do you need? 😂"
✅ "Cool story about the water bottle lol, what's actually going on?"
✅ "You only hit me up with this energy when you want something, what is it this time?"

Remember: Output ONLY the three sections (Hidden Intent, Behavior Type, Strategic Reply). Nothing else. No explanations or meta-commentary.`
          },
          {
            role: 'user',
            content: `Analyze this conversation I received and give me a reply that FLOWS naturally but calls them out:

${messages.map((msg, i) => `${i + 1}. "${msg}"`).join('\n')}

Make the reply sound natural and reference what they actually said.`
          }
        ],
        temperature: 0.8,
        max_tokens: 250
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI analysis error:', errorData);
      return res.status(500).json({ 
        error: 'Analysis failed',
        message: 'Failed to analyze messages. Please try again.'
      });
    }

    const data = await response.json();
    
    if (!data.choices?.[0]?.message?.content) {
      return res.status(500).json({ 
        error: 'No analysis result',
        message: 'Failed to generate analysis'
      });
    }

    console.log('✅ Analysis complete');
    res.json(data);

  } catch (error) {
    console.error('❌ Analysis Error:', error);
    res.status(500).json({ 
      error: 'Analysis failed',
      message: 'An error occurred during analysis. Please try again.'
    });
  }
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Server error',
    message: 'An unexpected error occurred. Please try again.'
  });
});

// ============================================
// SERVER STARTUP
// ============================================

if (process.env.NODE_ENV === 'production') {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔍 Local: http://localhost:${PORT}`);
    console.log(`📊 Rate limit: ${RATE_LIMIT_MAX} requests per hour`);
  });
}