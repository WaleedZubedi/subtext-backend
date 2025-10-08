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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

app.get('/api', (req, res) => {
  res.json({ status: 'SubText API is running!' });
});

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    console.log('=== OCR REQUEST START ===');
    
    if (!req.file) {
      console.log('ERROR: No file provided in request');
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log('File received:');
    console.log('- Original name:', req.file.originalname);
    console.log('- MIME type:', req.file.mimetype);
    console.log('- Size:', req.file.size, 'bytes');

    // Check if we need to convert the image
    let processedBuffer = req.file.buffer;
    let finalMimeType = req.file.mimetype;
    
    // Convert buffer to base64 to check file signature
    const initialBase64 = req.file.buffer.toString('base64');
    console.log('Initial base64 first 50 chars:', initialBase64.substring(0, 50));

    // Detect if this is WebP or other formats that need conversion
    const needsConversion = initialBase64.startsWith('UklGR') || // WebP
                           req.file.mimetype === 'image/webp' ||
                           !['image/jpeg', 'image/jpg', 'image/png'].includes(req.file.mimetype);

    if (needsConversion) {
      console.log('Converting image to JPEG format...');
      try {
        processedBuffer = await sharp(req.file.buffer)
          .jpeg({ 
            quality: 90,
            progressive: false 
          })
          .toBuffer();
        
        finalMimeType = 'image/jpeg';
        console.log('Conversion successful');
        
      } catch (conversionError) {
        console.error('Sharp conversion error:', conversionError);
        throw new Error('Failed to convert image format');
      }
    } else {
      console.log('No conversion needed, using original image');
    }

    // Convert final buffer to base64
    const base64Image = processedBuffer.toString('base64');
    
    // Create the data URI that OCR.space requires
    const dataUri = `data:${finalMimeType};base64,${base64Image}`;
    
    console.log('Final conversion:');
    console.log('- Base64 length:', base64Image.length);
    console.log('- Data URI length:', dataUri.length);
    console.log('- Data URI starts with:', dataUri.substring(0, 50));

    // IMPORTANT: Use URLSearchParams for proper form encoding
    const formData = new URLSearchParams();
    formData.append('base64image', dataUri);  // lowercase 'base64image'
    formData.append('filetype', 'JPG');
    formData.append('apikey', 'ce723b316888957');
    
    console.log('Form data created with:');
    console.log('- base64image (data URI) length:', dataUri.length);
    console.log('- filetype: JPG');

    console.log('Making request to OCR.space...');
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData,
    });

    console.log('OCR Response received:');
    console.log('- Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response body:', errorText);
      return res.status(500).json({ 
        error: 'OCR API returned error', 
        status: response.status, 
        body: errorText 
      });
    }

    const data = await response.json();
    console.log('OCR Response data:');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('=== OCR REQUEST SUCCESS ===');
    res.json({data});
    
  } catch (error) {
    console.error('=== OCR ERROR ===');
    console.error('Error message:', error.message);
    console.error('=== OCR ERROR END ===');
    res.status(500).json({ 
      error: 'OCR processing failed', 
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
