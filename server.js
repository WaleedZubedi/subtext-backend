require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
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

// Import auth endpoints
const signupHandler = require('./api/auth/signup');
const loginHandler = require('./api/auth/login');
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

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imageBuffer = req.file.buffer;
    
    // Placeholder for OCR - replace with your actual OCR logic
    const extractedText = "Sample extracted text from image";

    // Send to OpenAI for analysis
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

    const [hiddenIntent, strategicResponse] = analysis.split('\n\n');

    // Save analysis to history
    await saveAnalysis(req.userId, {
      extractedText,
      hiddenIntent,
      strategicResponse
    });

    // Increment usage counter
    await incrementUsage(req.userId);

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

// ============================================================================
// UPDATED MESSAGE EXTRACTION ENDPOINT - IMPROVED PROMPT
// ============================================================================
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
            content: `You are an expert at analyzing OCR-extracted text from chat screenshots. Your task is to identify and extract ONLY the messages sent BY the other person (not the phone owner's responses).

WHAT TO EXTRACT (Sender's messages):
- Questions directed at the phone owner: "Hey, are you free?", "What are you doing?", "Can I ask you something?"
- Statements and conversation starters: "I miss you", "We should hang out", "Just thinking about you"
- Longer, substantive messages that initiate or drive the conversation
- Messages that seek attention, validation, or responses
- Multiple consecutive messages from the same person

WHAT TO IGNORE (Phone owner's responses):
- Short acknowledgments: "ok", "yeah", "lol", "haha", "sure", "thanks", "np"
- Brief responses: "good", "not much", "maybe", "idk", "k"
- One-word or very short replies (typically under 5 words)
- Messages that are clearly answering questions rather than asking them

WHAT TO REMOVE (System text/metadata):
- Timestamps: "10:45 PM", "Yesterday", "Today 3:00 AM"
- Status indicators: "Delivered", "Read", "Seen", "Typing...", "Online"
- Contact names or labels at the top
- Platform UI elements: "iMessage", "WhatsApp", reaction emojis without text
- Date separators: "Monday", "Jan 15", etc.

CRITICAL RULES:
1. If you cannot clearly distinguish between sender and receiver, extract ALL substantive messages (longer than 5 words)
2. Preserve the original message text exactly - do not rephrase or summarize
3. Keep emojis if they're part of the message
4. Each message should be on its own line
5. Remove ALL non-message text (timestamps, names, status indicators)
6. If the conversation context makes it clear who's who, prioritize the person who seems to be initiating/pursuing

OUTPUT FORMAT (STRICTLY FOLLOW THIS):
EXTRACTED_MESSAGES_START
[First sender message - clean, no metadata]
[Second sender message - clean, no metadata]
[Third sender message - clean, no metadata]
EXTRACTED_MESSAGES_END

EXAMPLE INPUT:
"Sarah 2:30 PM
Hey! How have you been?
Read 2:31 PM
Me
Good, you?
Sarah
I've been thinking about our conversation yesterday
Do you have time to talk?
Me
Sure
Sarah Typing...
Great! So I wanted to ask you something"

EXAMPLE OUTPUT:
EXTRACTED_MESSAGES_START
Hey! How have you been?
I've been thinking about our conversation yesterday
Do you have time to talk?
Great! So I wanted to ask you something
EXTRACTED_MESSAGES_END`
          },
          {
            role: 'user',
            content: `Extract the sender's messages from this conversation screenshot text. Focus on identifying who is initiating/pursuing the conversation:

${rawText}`
          }
        ],
        temperature: 0.1,
        max_tokens: 3000
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Extraction Error:', error);
    res.status(500).json({ error: 'Message extraction failed' });
  }
});

// ============================================================================
// UPDATED ANALYSIS ENDPOINT - NEW DARK PSYCHOLOGY PROMPT
// ============================================================================
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
            content: `You are a ruthless conversational psychologist. Expose manipulation in the shortest way possible, then give a copy-paste ready reply.

CORE PHILOSOPHY:
Every text is a power move. Decode it in ONE line, give a devastating reply that flips power.

RESPONSE FORMAT (FOLLOW EXACTLY):

**Hidden Intent:**
[1-2 words] → [3-4 words max]

Perfect examples (THIS SHORT):
• "Guilt trip → Make you respond"
• "Attention test → Drop everything now"
• "Validation bait → Feed my ego"
• "Control play → Test your loyalty"
• "Breadcrumbing → Keep you hooked"
• "Priority check → Prove I matter"
• "Ego fishing → Boost my self-worth"
• "Power move → Dominate the conversation"
• "Manipulation → Create fake obligation"
• "Emotional blackmail → Guilt you instantly"

CRITICAL: Maximum 6-7 words TOTAL for hidden intent. Be RUTHLESS with brevity.

**Behavior Type:**
[ONE WORD: Manipulative/Controlling/Narcissistic/Gaslighting/Guilt-Tripping/Breadcrumbing/Love-Bombing/Attention-Seeking/Toxic/Avoidant]

**Strategic Reply:**
[A 3-4 line response that the USER can COPY and PASTE directly into their chat. Write AS the user, not ABOUT the user.

Requirements:
- Write in FIRST PERSON (I, me, my) - user will copy/paste this
- EXACTLY 3-4 lines
- Each line SHORT (6-8 words max)
- Natural, casual language they'd actually text
- Confident, unbothered, slightly dismissive tone
- NO analysis, NO explanation - ONLY the actual reply text
- Make them feel called out subtly
- Flip power to the user
- Can use casual contractions (I'm, that's, you're)

Perfect 3-line examples (COPY-PASTE READY):
"Interesting timing lol. What do you actually want?
I'm good on my end though.
Try being more direct next time."

"Nah I'm not doing this again.
You clearly need something from me.
Figure out what and let me know."

"Not really feeling this energy right now.
I've got my own stuff going on.
Hit me up when you're being real."

Perfect 4-line examples (COPY-PASTE READY):
"I see what you're doing here lol.
That doesn't really work on me anymore.
I'm busy living my actual life.
Let me know when you're ready to be genuine."

"Cute attempt but I'm not playing this game.
You want something, just say it directly.
I don't do the guilt trip thing.
Come correct or don't come at all."

"I'm gonna pass on whatever this is.
Not in the mood for manipulation tactics today.
You know where to find me.
When you're ready to be real, we can talk."]

MANIPULATION DETECTION:
• Vague questions = Fishing
• "Just checking in" = Boundary test
• Compliments = Bait
• Past references = Guilt weapon
• Future talk = Fake promises
• Random text after silence = Breadcrumb
• "Are you mad?" = Deflection

PROCESS:
1. Find manipulation in 1-2 words
2. Expose intent in 3-4 words
3. Write 3-4 line reply AS the user (first person)
4. Make it copy-paste ready with natural language

TONE: Ice cold efficiency. Natural texting language. User copies and sends immediately.

CRITICAL RULES:
✓ Hidden intent under 7 words total
✓ Reply exactly 3-4 lines
✓ First person voice (I, me, my)
✓ Natural texting language
✓ Copy-paste ready - no explanations`
          },
          {
            role: 'user',
            content: `Expose manipulation ultra-short. Give copy-paste reply in first person:

${messages.join('\n\n')}`
          }
        ],
        temperature: 1.0,
        max_tokens: 500
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