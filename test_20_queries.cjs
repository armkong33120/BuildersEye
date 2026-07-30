const http = require('http');

const queries = [
  "สรุปผลงานรวมๆ ของแผนกบัญชีให้ฟังหน่อย",
  "พนักงานคนไหนได้ KPI ต่ำกว่า 3.0 บ้าง",
  "มีพนักงานกี่คนที่มีปัญหาเรื่องความประพฤติ",
  "โปรเจค PRJ026 ใครเป็นหัวหน้า",
  "ขอดูรายชื่อคนที่มาสายบ่อยๆ หน่อย",
  "พนักงานเซลส์ที่ทำผลงานระดับ A มีใครบ้าง",
  "หัวหน้าฝ่ายไอทีคือใคร",
  "ขอข้อมูลของ EMP045 หน่อย",
  "แผนกไหนมีคนเยอะสุด",
  "ปีนี้มีใครได้เลื่อนขั้นบ้าง",
  "ฝ่าย HR อบรมเรื่องกฎหมายครบทุกคนหรือยัง",
  "พนักงานคนไหนโดนใบเตือนขั้นร้ายแรงบ้าง",
  "โปรเจคระบบคลาวด์มีปัญหาอะไรไหม",
  "ลูกทีมของธนกฤตมีใครบ้าง",
  "ขอดูคนที่มีโอกาสเป็น Top Talent ของบริษัท",
  "มีกี่คนที่ยังเรียนหลักสูตร Security ไม่จบ",
  "พนักงานที่ทำงานแย่ที่สุดในตอนนี้คือใคร",
  "แผนกกฎหมายมีกี่คน",
  "ใครเคยทะเลาะกับเพื่อนร่วมงานบ้าง",
  "สรุปข้อมูลของฝ่ายการตลาดทั้งหมด"
];

async function run() {
  console.log("=== RUNNING 20 CEO QUERIES ===");
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 5199,
          path: '/api/chat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ query: q, viewer: { role: 'CEO', employeeId: 1 } }));
        req.end();
      });
      
      console.log(`\n[Q${i+1}] ${q}`);
      console.log(`Intent :`, JSON.stringify(res._parsedIntent?.intents || []));
      console.log(`Filters:`, JSON.stringify(res._parsedIntent?.filters || []));
      console.log(`Matched:`, res.matchedEmployeePks ? res.matchedEmployeePks.length : 0, 'employees');
      console.log(`Answer :`, res.answer ? res.answer.replace(/\n/g, ' ').substring(0, 100) + '...' : 'No Answer');
    } catch (err) {
      console.log(`\n[Q${i+1}] ${q} -> ERROR: ${err.message}`);
    }
    // sleep 2s between requests to avoid OpenAI rate limits
    await new Promise(r => setTimeout(r, 2000));
  }
}
run();
