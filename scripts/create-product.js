require('dotenv').config();
const fetch = require('node-fetch');

const PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  return data.access_token;
}

async function createProduct() {
  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'SubText Conversation Analysis',
      description: 'AI-powered conversation analysis and insights',
      type: 'SERVICE',
      category: 'SOFTWARE',
      image_url: 'https://example.com/image.jpg',
      home_url: 'https://subtext.ai'
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Failed:', data);
    return;
  }

  console.log('\n✅ Product created!');
  console.log('\nProduct ID:', data.id);
  console.log('\nAdd this to your .env file:');
  console.log(`PAYPAL_PRODUCT_ID=${data.id}`);
}

createProduct().catch(console.error);
