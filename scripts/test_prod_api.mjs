const BACKEND = 'https://builderseye-backend.onrender.com';
const PASSWORD = 'HhAjzrMkw0ODQfr_tH9k1Y81';

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
  console.log('Logged in! Sending query...');

  res = await fetch(`${BACKEND}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query: 'เงินเดือนพนักงานเฉลี่ยเท่าไหร่', conversationId: 'test-' + Date.now() })
  });
  data = await res.json();
  console.log('Chat response:', data.answer ? data.answer.substring(0, 50) + '...' : data);
  console.log('✅ Injected audit log directly via API.');
}
testApi();
