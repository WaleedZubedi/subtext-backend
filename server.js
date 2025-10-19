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
const { authenticateUser } = require('./middleware/auth');
const { isUserSubscribed, incrementUsage, saveAnalysis } = require('./lib/supabase');

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================
// Add this right after your imports
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  console.log('Headers:', req.headers.authorization ? 'Token present' : 'No token');
  next();
});

app.get('/', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

app.get('/api', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

// ============================================
// AUTH ROUTES
// ============================================

app.post('/api/auth/signup', signupHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', logoutHandler);

// ============================================
// OCR ENDPOINT - Image Upload & Text Extraction
// ============================================

app.post('/api/ocr', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    console.log('=== OCR REQUEST START ===');
    console.log('User ID:', req.userId);

     const hasSubscription = await isUserSubscribed(req.userId);
    if (!hasSubscription) {
      return res.status(403).json({ 
        error: 'Subscription required',
        message: 'Please subscribe to use this feature'
      });
    ß}

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // ... rest of the code stays the same

    // Convert image to base64 for OpenAI Vision
    const imageBuffer = req.file.buffer;
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    // Use OpenAI Vision API to extract text from image
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
                text: 'Extract ALL text from this image. Return only the text content, nothing else. If you cannot find any text, say "No readable text found".'              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000
      })
    });

    const visionData = await visionResponse.json();
    
    if (!visionData.choices?.[0]?.message?.content) {
      return res.status(500).json({ 
        error: 'Failed to extract text from image',
        message: 'OpenAI Vision API returned no content'
      });
    }

    const extractedText = visionData.choices[0].message.content.trim();

    console.log('=== OPENAI VISION RESPONSE ===');
    console.log('Extracted text:', extractedText);
    console.log('==============================');
    
    // Check if no text was found
    if (!extractedText || 
        extractedText.length < 3 || 
        extractedText.toLowerCase().includes('no readable text') ||
        extractedText.toLowerCase().includes('no text found')) {
      return res.status(400).json({ 
        error: 'No text detected',
        message: 'Could not find any text in this image. Please upload a screenshot with text messages.'
      });
    }
    console.log('✅ Text extracted successfully:', extractedText.substring(0, 100) + '...');

    // Increment usage counter (async, don't wait for response)
    incrementUsage(req.userId).catch(err => 
      console.error('Usage increment error:', err)
    );

    // Return extracted text in format frontend expects
    res.json({
      ParsedResults: [{
        ParsedText: extractedText
      }]
    });

  } catch (error) {
    console.error('❌ OCR error:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      details: error.message 
    });
  }
});

// ============================================
// MESSAGE EXTRACTION ENDPOINT
// Separates sender messages from receiver messages
// ============================================

app.post('/api/extract', async (req, res) => {
  try {
    const { rawText } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log('📝 Extracting messages from text...');

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
            content: `You are an expert at analyzing OCR-extracted text from chat conversations. Extract ONLY the messages sent TO the phone owner.

SENDER MESSAGES (Extract these):
- Longer messages, questions, conversation starters
- Patterns: "Hey", "How are you", "Are you", "Can you", "I was thinking"
- Examples: "Hey how are you doing?", "Are you free this weekend?"

RECEIVER MESSAGES (Ignore these):
- Short responses: "Good", "Yes", "No", "Ok", "Thanks", "Lol"
- Examples: "Good thanks", "Yeah sure", "Ok"

SYSTEM TEXT (Remove completely):
- Timestamps, contact names, "Delivered", "Read", "Typing"

OUTPUT FORMAT:
EXTRACTED_MESSAGES_START
[Clean sender message 1]
[Clean sender message 2]
EXTRACTED_MESSAGES_END`
          },
          {
            role: 'user',
            content: `Extract sender messages from: ${rawText}`
          }
        ],
        temperature: 0,
        max_tokens: 2000
      }),
    });

    const data = await response.json();
    console.log('✅ Messages extracted successfully');
    res.json(data);

  } catch (error) {
    console.error('❌ Extraction Error:', error);
    res.status(500).json({ error: 'Message extraction failed' });
  }
});

// ============================================
// ANALYSIS ENDPOINT - Psychological Analysis
// NEW FORMAT: Short intent + First-person reply
// ============================================

app.post('/api/analyze', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    console.log('🧠 Analyzing messages with psychological prompts...');

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
            content: `You are a brutal psychological analyst decoding text conversations.

Analyze ONLY the messages the user RECEIVED (not their own messages).

Your job:
1. Identify the REAL hidden intent using psychological terms
2. Provide a SHORT insightful summary (MAX 7 WORDS)
3. Create a FIRST-PERSON reply the user can copy and send directly

CRITICAL RULES:
- Hidden intent format: "psychological term → max 7 word summary"
- Strategic reply MUST be first-person ("I" statements), ready to paste and send
- Reply should manipulate, gain power, and get on their nerves
- Reply must sound natural, like the user wrote it themselves
- NO third-person advice, NO explanations, just the actual message to send

Examples:

Message: "Hey are you free tonight?"
**Hidden Intent:** 
Availability testing → Fishing for your attention and priority

**Behavior Type:**
Attention-Seeking

**Strategic Reply:**
Depends what you're offering. I've got options tonight.

─────────────────

Message: "Just checking in on you 😊"
**Hidden Intent:**
Control disguised as care → Monitoring your availability

**Behavior Type:**
Controlling

**Strategic Reply:**
I'm good. Been busy actually. What's up?

─────────────────

Message: "We should catch up soon!"
**Hidden Intent:**
Vague obligation creation → Building social debt without commitment

**Behavior Type:**
Manipulative  

**Strategic Reply:**
Sure, let me know when you've got specific plans.

─────────────────

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

**Hidden Intent:** 
[Psychological term] → [max 7 word insightful summary]

**Behavior Type:**
[One-word category]

**Strategic Reply:**
[First-person message ready to copy and send. Must sound natural and conversational. Use "I" statements. This is what the USER will send, not advice about what to send.]`
          },
          {
            role: 'user',
            content: `Analyze these messages: ${messages.join('\n\n')}`
          }
        ],
        temperature: 0.9
      }),
    });

    const data = await response.json();
    console.log('✅ Analysis complete');
    res.json(data);

  } catch (error) {
    console.error('❌ Analysis Error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ============================================
// SERVER STARTUP
// ============================================

if (process.env.NODE_ENV === 'production') {
  // For Vercel deployment
  module.exports = app;
} else {
  // For local development
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
  });
}