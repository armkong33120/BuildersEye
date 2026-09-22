const BACKEND = 'https://builderseye-backend.onrender.com';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || '';

async function testApi() {
  console.log('Logging in...');
  let res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ceo', password: PASSWORD })
  });
  let data = await res.json();
  if (!data.accessToken) {
    console.error('Login failed!', data);
    return;
  }
  const token = data.accessToken;
  console.log('Logged in! Sending queries...');

  const queries = [
    'ขอสรุป KPI ภาพรวมของบริษัทหน่อย',
    'เงินเดือนพนักงานเฉลี่ยเท่าไหร่',
    'ใครมีประสบการณ์ด้าน Security บ้าง'
  ];

  for (let q of queries) {
    console.log(`Sending: ${q}`);
    await fetch(`${BACKEND}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ query: q, conversationId: 'test-' + Date.now() })
    });
    // Wait for AI to finish
    await new Promise(r => setTimeout(r, 4000));
  }
  
  console.log('✅ Injected audit logs directly via API.');
}
testApi();
