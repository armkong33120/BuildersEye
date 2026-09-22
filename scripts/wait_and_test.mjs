const BACKEND = 'https://builderseye-backend.onrender.com';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';

async function waitAndTest() {
  console.log('Waiting for Render deploy to finish...');
  while (true) {
    const r = await fetch('https://api.render.com/v1/services/srv-d9p0e6ugekts73evnivg/deploys?limit=1', {
      headers: { 'Authorization': `Bearer ${RENDER_API_KEY}` }
    });
    const data = await r.json();
    const status = data[0].deploy.status;
    console.log('Deploy status:', status);
    if (status === 'live') {
      console.log('✅ Deploy is LIVE!');
      break;
    }
    if (status === 'build_failed' || status === 'update_failed') {
      console.error('❌ Deploy failed!', data);
      return;
    }
    await new Promise(r => setTimeout(r, 10000));
  }

  // Add 10 seconds buffer for service to start accepting traffic
  await new Promise(r => setTimeout(r, 10000));

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
waitAndTest();
