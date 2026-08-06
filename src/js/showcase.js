/* ==========================================================================
   BUILDERSEYE SHOWCASE INTERACTIVE LOGIC
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initBrainSelector();
  initCopyCredentials();
  initMockRoleSelector();
  checkBackendHealth();
});

/**
 * 1. Interactive Brain Selector (System Flow SVG)
 */
function initBrainSelector() {
  const buttons = document.querySelectorAll('.btn-brain');
  const pathA = document.getElementById('path-brain-a');
  const pathB = document.getElementById('path-brain-b');
  const pathC = document.getElementById('path-brain-c');
  const cardA = document.getElementById('svg-brain-a');
  const cardB = document.getElementById('svg-brain-b');
  const cardC = document.getElementById('svg-brain-c');

  if (!buttons.length) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetBrain = btn.getAttribute('data-brain');

      // Reset path & card highlights
      [pathA, pathB, pathC].forEach(p => p && p.classList.remove('active'));
      [cardA, cardB, cardC].forEach(c => c && c.classList.remove('active'));

      if (targetBrain === 'a') {
        if (pathA) pathA.classList.add('active');
        if (cardA) cardA.classList.add('active');
      } else if (targetBrain === 'b') {
        if (pathB) pathB.classList.add('active');
        if (cardB) cardB.classList.add('active');
      } else if (targetBrain === 'c') {
        if (pathC) pathC.classList.add('active');
        if (cardC) cardC.classList.add('active');
      }
    });
  });
}

/**
 * 2. Copy Credentials Button Handler
 */
function initCopyCredentials() {
  const copyButtons = document.querySelectorAll('.btn-copy-cred');

  copyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const user = btn.getAttribute('data-user');
      const pass = btn.getAttribute('data-pass');
      const textToCopy = `Username: ${user}\nPassword: ${pass}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          showCopySuccess(btn);
        }).catch(err => {
          console.error('Failed to copy text via clipboard API: ', err);
          fallbackCopyText(textToCopy, btn);
        });
      } else {
        fallbackCopyText(textToCopy, btn);
      }
    });
  });
}

function showCopySuccess(btn) {
  const originalText = btn.innerText;
  btn.innerText = 'คัดลอกแล้ว! ✅';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerText = originalText;
    btn.classList.remove('copied');
  }, 2000);
}

function fallbackCopyText(text, btn) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showCopySuccess(btn);
  } catch (err) {
    console.error('Fallback copy failed: ', err);
  }
  document.body.removeChild(textArea);
}

/**
 * 3. Backend Health Status Check + Warmup (ปลุก backend ทันทีที่คนเปิดหน้าเว็บ)
 * ตอน visitor อ่านหน้า landing 10-30 วิ → backend ตื่นแล้ว → ไม่เห็น cold start ตอน login
 */
async function checkBackendHealth() {
  const badge = document.getElementById('backend-status-badge');
  const backend = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RAG_BACKEND)
    || 'https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io';
  const endpoint = backend.replace(/\/$/, '') + '/api/health';

  try {
    if (badge) badge.innerHTML = '<span class="status-dot yellow"></span> Backend Status: Waking up… 🟡';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // รอ cold start ได้เต็มที่

    const startedAt = Date.now();
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (badge) badge.innerHTML = `<span class="status-dot green"></span> Backend Status: Online 🟢 (${secs}s)`;
      startKeepWarm(endpoint); // กันหลับระหว่างที่ visitor เปิดหน้าเว็บอยู่ (ฟรี)
      return;
    }
    throw new Error('not ok');
  } catch (err) {
    if (badge) badge.innerHTML = '<span class="status-dot red"></span> Backend Status: ไม่สามารถเชื่อมต่อได้ — ลองรีเฟรช 🔴';
  }
}

// ping เบาๆ ทุก 45 วิ ขณะหน้าเว็บเปิดอยู่ → ACA ไม่ scale-to-zero กลาง session ของ visitor
let _keepWarmTimer = null;
function startKeepWarm(endpoint) {
  if (_keepWarmTimer) return;
  _keepWarmTimer = setInterval(() => {
    fetch(endpoint, { method: 'GET', cache: 'no-store' }).catch(() => {});
  }, 45000);
}

/**
 * 4. Interactive Role Selector for Section 3 Mock UI
 */
function initMockRoleSelector() {
  const roleBadges = document.querySelectorAll('.mock-role-badge');
  const chatHeader = document.querySelector('.chat-header');

  if (!roleBadges.length) return;

  roleBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      roleBadges.forEach(b => b.classList.remove('active'));
      badge.classList.add('active');

      const roleRole = badge.getAttribute('data-role');
      if (chatHeader) {
        if (roleRole === 'ceo') {
          chatHeader.innerText = '💬 AI Chat Assistant (Role: CEO)';
        } else if (roleRole === 'hr') {
          chatHeader.innerText = '💬 AI Chat Assistant (Role: HR Manager)';
        } else if (roleRole === 'manager') {
          chatHeader.innerText = '💬 AI Chat Assistant (Role: IT Manager)';
        } else {
          chatHeader.innerText = '💬 AI Chat Assistant (Role: Employee emp144)';
        }
      }
    });
  });
}

