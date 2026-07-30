import fs from 'fs';

// 50 Ambiguous or General Questions to test Clickable Suggestions
const testQuestions = [
  "ขอดูข้อมูลการเงินหน่อย",
  "ยอดขายเดือนนี้เป็นไงบ้าง",
  "พนักงานคนไหนผลงานดีสุด",
  "ขอสถิติการลาหยุด",
  "ค่าใช้จ่ายตอนนี้",
  "งบประมาณเหลือเท่าไหร่",
  "ลูกค้าหลักของเราคือใคร",
  "ใครมีแนวโน้มลาออก",
  "สรุปรายงาน",
  "มีอะไรอัปเดตบ้าง",
  "โปรเจกต์ล่าช้าไหม",
  "ใครได้ KPI สูงสุด",
  "ความเสี่ยงตอนนี้คืออะไร",
  "ข้อร้องเรียนล่าสุด",
  "มีปัญหาอะไรไหม",
  "สวัสดิการพนักงาน",
  "ดูผลประเมิน",
  "เครื่องมือ IT",
  "ผลประกอบการ",
  "แนวโน้มปีนี้",
  "ค่าลิขสิทธิ์ซอฟต์แวร์",
  "สัญญาลูกค้า",
  "กำไรบริษัท",
  "ใครรับผิดชอบงานนี้",
  "ค่าเช่าออฟฟิศ",
  "เปรียบเทียบปีที่แล้ว",
  "ดูทักษะพนักงาน",
  "ค่ายิงแอดโฆษณา",
  "ผลสำรวจความผูกพัน",
  "สรุปแผนก IT",
  "ต้นทุนบานปลายไหม",
  "โบนัสปีนี้",
  "การเข้าออกอาคาร",
  "การอบรมพนักงาน",
  "นโยบายบริษัท",
  "ใครทำงานล่วงเวลาเยอะสุด",
  "ปัญหาลูกค้า",
  "ยอดขายเทียบเป้า",
  "ประสิทธิภาพการทำงาน",
  "งบการตลาด",
  "โปรเจกต์ใหม่",
  "ดูรายชื่อพนักงาน",
  "ค่าไฟเดือนนี้",
  "ความก้าวหน้าพนักงาน",
  "คนที่มีทักษะภาษาอังกฤษ",
  "สรุปการประชุม",
  "การเบิกเงิน",
  "ค่าเดินทาง",
  "ความปลอดภัย",
  "ใบเซอร์พนักงาน"
];

// We will test 50 different "viewer contexts" (roles/departments) to see how suggestions change
const roles = [
  "CEO", "HR Manager", "IT Manager", "Sales Director", "Engineering Head", 
  "Marketing Manager", "Finance Manager", "Procurement Head", "Legal Counsel", "Customer Service Manager"
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simple keyword overlap scorer (0.0 to 1.0)
function calculateRelevance(question, suggestions) {
  if (!suggestions || suggestions.length === 0) return 0;
  const qWords = question.split(' ');
  let score = 0;
  suggestions.forEach(opt => {
    qWords.forEach(qw => {
      if (opt.includes(qw) || qw.includes(opt)) score += 0.1;
    });
  });
  return Math.min(score, 1.0); // Rough mock score
}

async function run() {
  console.log('Starting 50x50 Suggestions Test with Caffeinate (Anti-Sleep)...');
  const fd = fs.openSync('suggestions_test_results.csv', 'w');
  fs.writeSync(fd, 'ViewerRole,Question,SuggestedOptions,RelevanceScore,TimeTakenMs\n');
  
  let count = 0;
  let totalScore = 0;
  
  // 50 iterations: 5 roles x 10 cycles = 50 
  // 50 x 50 = 2500
  for (let cycle = 0; cycle < 50; cycle++) {
    const role = roles[cycle % roles.length];
    
    for (let qIdx = 0; qIdx < 50; qIdx++) {
      const query = testQuestions[qIdx];
      
      try {
        const startTime = Date.now();
        const res = await fetch('http://localhost:5199/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: query, 
            viewer: { role: role, employeeId: 1 }
          })
        });

        const data = await res.json();
        const timeTaken = Date.now() - startTime;
        
        const suggestions = data.suggestedOptions || [];
        const suggStr = JSON.stringify(suggestions).replace(/"/g, '""');
        const score = calculateRelevance(query, suggestions);
        
        totalScore += score;
        
        fs.writeSync(fd, `"${role}","${query}","${suggStr}","${score.toFixed(2)}","${timeTaken}"\n`);
        count++;
        
        console.log(`[${count}/2500] ${role} | Q: ${query.substring(0,20)}... -> Score: ${score.toFixed(2)} | Sugg: ${suggestions.length}`);
        
        // Anti-rate limit delay
        await delay(2000); 

      } catch (err) {
        console.error(`[${count}/2500] ERROR: ${err.message}`);
        fs.writeSync(fd, `"${role}","${query}","ERROR","0","0"\n`);
        await delay(10000); // backoff
      }
    }
  }
  fs.closeSync(fd);
  console.log(`✅ Test complete! Avg Relevance Score: ${(totalScore/2500).toFixed(2)}`);
}

run();
