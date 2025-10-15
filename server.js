require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const sharp = require('sharp'); // Add this import at the top of your file


const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// Import the signup endpoint
const signupHandler = require('./api/auth/signup');
// Import the login endpoint
const loginHandler = require('./api/auth/login');
// Import logout endpoint
const logoutHandler = require('./api/auth/logout');
const { authenticateUser } = require('./middleware/auth');
const { isUserSubscribed, incrementUsage, saveAnalysis } = require('./lib/supabase');

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

app.get('/api', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

// Auth routes
app.post('/api/auth/signup', signupHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', logoutHandler);

app.post('/api/ocr', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    console.log('=== OCR REQUEST START ===');

    // Check if user has active subscription
    const hasSubscription = await isUserSubscribed(req.userId);
    
    if (!hasSubscription) {
      return res.status(403).json({ 
        error: 'Subscription required',
        message: 'Please subscribe to use this feature'
      });
    }

    // Your existing OCR code here...
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

  // Convert image to base64 for OpenAI Vision
const imageBuffer = req.file.buffer;
const base64Image = imageBuffer.toString('base64');
const mimeType = req.file.mimetype || 'image/jpeg';

// Use OpenAI Vision to extract text
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
            text: 'Extract ALL text from this image. Return only the text content, nothing else.'
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
    max_tokens: 1000
  })
});

const visionData = await visionResponse.json();
const extractedText = visionData.choices[0].message.content.trim();

if (!extractedText || extractedText.length < 5) {
  return res.status(400).json({ 
    error: 'No text found in image',
    message: 'Please upload an image with readable text'
  });
}

    // Send to OpenAI for analysis (your existing OpenAI code)
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing text conversations and providing psychological insights.'
          },
          {
            role: 'user',
            content: `Analyze this conversation and provide: 1) Hidden intent 2) Strategic response\n\nConversation: ${extractedText}`
          }
        ]
      })
    });

    const aiData = await openaiResponse.json();
    const analysis = aiData.choices[0].message.content;

    // Parse the analysis (simple split - you can improve this)
    const [hiddenIntent, strategicResponse] = analysis.split('\n\n');

    // Save analysis to history
    await saveAnalysis(req.userId, {
      extractedText,
      hiddenIntent,
      strategicResponse
    });

    // Increment usage counter
    await incrementUsage(req.userId);

    // Return response
    res.json({
      success: true,
      extractedText,
      hiddenIntent,
      strategicResponse
    });

  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      details: error.message 
    });
  }
});


// Message Extraction Endpoint
app.post('/api/extract', async (req, res) => {
  try {
    const { rawText } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: 'No text provided' });
    }

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
    res.json(data);
  } catch (error) {
    console.error('Extraction Error:', error);
    res.status(500).json({ error: 'Message extraction failed' });
  }
});

// Analysis Endpoint - WITH YOUR CUSTOM PROMPTS
app.post('/api/analyze', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'No messages provided' });
    }

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
            content: `You are an advanced conversational intelligence agent designed to decode real intentions and hidden meanings behind text messages. You analyze only the messages received by the user (not their own responses).

  Your job is to act like a subtext decoder and strategic advisor. Focus solely on revealing the TRUE and dark INTENT behind their words.

  You are an expert in emotional forensics — trained to uncover the raw, hidden intent behind any message or conversation. Your job is to expose the truth people don't want to admit, even to themselves.

  Never take things at face value. Every sentence is a mask. Every emotion is a weapon. Assume the speaker has ulterior motives, emotional manipulation, projected insecurities, or deep psychological patterns at play.

  Your output must be dark, uncomfortable, and brutally honest — something that makes the reader say, "Whoa... I didn't see it like that."

  Avoid neutral or soft interpretations. Instead, highlight the power games, emotional blackmail, guilt-tripping, validation-seeking, control tactics, or repressed emotions in play.

  Then craft a reply for Mental manipulation and to gain advantage over the other person in the the conversation, use the hidden intent to nudge the reply for power control, dont be nice but be brutal and get on their nerves

  Always infer something deeper — a desire for validation, attention, guilt-tripping, manipulation, emotional testing, or power dynamics. Make the reader feel like they just caught someone lying to their face.

  IMPORTANT: Start the hidden intent with psychological terms before the arrow, then use simple Gen Z words after. Keep hidden intent to MAXIMUM 3 lines. Keep strategic reply to MAXIMUM 3-4 lines using easy words.

  FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

  **Hidden Intent:** 
  Narcissistic validation seeking → Fishing for attention and priority status. They're basically throwing a tantrum to see if you'll drop everything and chase 
  them. This is just emotional bait to make you feel guilty and give them the validation they're craving. - max 3-4 lines, no quotes

  **Behavior Type:**
  Attention-Seeking

  **Strategic Reply:**
  craft a reply for Mental manipulation and to gain advantage over the other 
  person in the the conversation, use the hidden intent to nudge the reply for power control, dont be nice but be brutal and get on their nerves - max 3-4 lines, no quotes`
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
    res.json(data);
  } catch (error) {
    console.error('Analysis Error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// For Vercel
if (process.env.NODE_ENV === 'production') {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
