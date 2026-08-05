/* ==========================================================================
   BUILDERSEYE INTERACTIVE TOUR GUIDE CONTROLLER
   Pure ES6 State Machine Engine - Zero External Dependencies
   ========================================================================== */

export class TourGuideController {
  constructor() {
    this.currentStep = 0;
    this.isActive = false;
    this.typewriterTimer = null;
    this.resizeHandler = null;
    this.scrollHandler = null;
    this.keydownHandler = null;

    // 5 Interactive Steps Specification Blueprint
    this.steps = [
      {
        step: 1,
        id: 'select-role',
        targetSelector: '[data-tour-step="1"]',
        title: '1/5: เลือกบัญชีทดสอบ (Employee - emp144)',
        desc: 'จำลองการเข้าใช้งานด้วยบทบาทพนักงานทั่วไปที่มีสิทธิ์จำกัดเฉพาะข้อมูลส่วนบุคคล',
        onEnter: () => this.setupStep1()
      },
      {
        step: 2,
        id: 'type-query',
        targetSelector: '[data-tour-step="2"]',
        title: '2/5: พิมพ์คำถาม RAG Chat',
        desc: 'พิมพ์คำถามความปลอดภัยสูง "เงินเดือน CEO เท่าไหร่?" ผ่านช่องทาง AI Chat เพื่อทดสอบระบบ Governance Policy',
        onEnter: () => this.setupStep2()
      },
      {
        step: 3,
        id: 'graph-pulse',
        targetSelector: '[data-tour-step="3"]',
        title: '3/5: 3D Org-Graph Node Highlight',
        desc: 'สังเกตเห็น Node พนักงาน emp144 และ CEO กระพริบสว่างบน 3D Pyramidal Tree พร้อมลำแสงแสดงสายบังคับบัญชา',
        onEnter: () => this.setupStep3()
      },
      {
        step: 4,
        id: 'rbac-block',
        targetSelector: '[data-tour-step="4"]',
        title: '4/5: RBAC Governance Policy Enforcement',
        desc: 'ระบบ Policy Gate (server/policy.js) สกัดกั้นคำถามข้ามสิทธิ์ทันที โดยไม่ส่งข้อมูล PII/เงินเดือนไปยัง LLM',
        onEnter: () => this.setupStep4()
      },
      {
        step: 5,
        id: 'tour-complete',
        targetSelector: '[data-tour-step="5"]',
        title: '5/5: ทัวร์เสร็จสิ้น — พร้อมทดลองใช้งานจริง!',
        desc: 'คุณได้สัมผัสการทำงานของ RAG + 3D Org-Graph + RBAC แล้ว กดเปิดแอป 3D เพื่อทดลองใช้งานจริง',
        isLast: true,
        onEnter: () => this.setupStep5()
      }
    ];

    this.backdropEl = null;
    this.spotlightEl = null;
    this.tooltipEl = null;

    this.initDOM();
  }

  /**
   * Inject Tour Overlay DOM Elements into Document Body
   */
  initDOM() {
    if (document.querySelector('.tour-backdrop')) {
      this.backdropEl = document.querySelector('.tour-backdrop');
      this.spotlightEl = document.querySelector('.tour-spotlight-box');
      this.tooltipEl = document.querySelector('.tour-tooltip');
      return;
    }

    // 1. Backdrop Overlay
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'tour-backdrop';
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) this.end();
    });

    // 2. Spotlight Box
    this.spotlightEl = document.createElement('div');
    this.spotlightEl.className = 'tour-spotlight-box';

    // 3. Tooltip Card
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tour-tooltip';
    this.tooltipEl.innerHTML = `
      <div class="tour-header">
        <span class="tour-step-badge" id="tour-step-badge">Step 1 of 5</span>
        <button class="tour-skip-btn" id="tour-btn-skip" title="ปิด Tour Guide (Esc)">✖</button>
      </div>
      <div class="tour-body">
        <div class="tour-title" id="tour-title"></div>
        <div class="tour-desc" id="tour-desc"></div>
      </div>
      <div class="tour-step-dots" id="tour-step-dots"></div>
      <div class="tour-footer">
        <button class="tour-btn tour-btn-back" id="tour-btn-back">◀️ ย้อนกลับ</button>
        <button class="tour-btn tour-btn-next" id="tour-btn-next">ถัดไป ▶️</button>
      </div>
    `;

    document.body.appendChild(this.backdropEl);
    document.body.appendChild(this.spotlightEl);
    document.body.appendChild(this.tooltipEl);

    // Bind Internal Controls
    const skipBtn = this.tooltipEl.querySelector('#tour-btn-skip');
    const backBtn = this.tooltipEl.querySelector('#tour-btn-back');
    const nextBtn = this.tooltipEl.querySelector('#tour-btn-next');

    if (skipBtn) skipBtn.addEventListener('click', () => this.end());
    if (backBtn) backBtn.addEventListener('click', () => this.prev());
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.steps[this.currentStep]?.isLast) {
          window.location.href = '/app.html?preview=1';
        } else {
          this.next();
        }
      });
    }

    // Render 5 Step Dots
    const dotsContainer = this.tooltipEl.querySelector('#tour-step-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      this.steps.forEach((_, idx) => {
        const dot = document.createElement('button');
        dot.className = 'tour-step-dot';
        dot.setAttribute('aria-label', `Go to step ${idx + 1}`);
        dot.addEventListener('click', () => this.showStep(idx));
        dotsContainer.appendChild(dot);
      });
    }
  }

  /**
   * Start Interactive Tour Guide Process
   */
  start() {
    this.isActive = true;

    // Smooth scroll to Section 3 Demo
    const demoSection = document.getElementById('demo');
    if (demoSection) {
      demoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Activate Overlays
    if (this.backdropEl) this.backdropEl.classList.add('active');
    if (this.spotlightEl) this.spotlightEl.classList.add('active');
    if (this.tooltipEl) this.tooltipEl.classList.add('active');

    // Attach Event Listeners
    this.resizeHandler = () => this.updatePosition();
    this.scrollHandler = () => this.updatePosition();
    this.keydownHandler = (e) => this.handleKeydown(e);

    window.addEventListener('resize', this.resizeHandler, { passive: true });
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    window.addEventListener('keydown', this.keydownHandler);

    this.showStep(0);
  }

  /**
   * Keyboard Shortcuts Handler (Esc, Left, Right, Enter)
   */
  handleKeydown(e) {
    if (!this.isActive) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.end();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (this.steps[this.currentStep]?.isLast) {
        window.location.href = '/app.html?preview=1';
      } else {
        this.next();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    }
  }

  /**
   * Navigate to Specific Step Index (0..4)
   */
  showStep(index) {
    if (index < 0 || index >= this.steps.length) return;

    // Stop ongoing typewriter effect
    if (this.typewriterTimer) {
      clearTimeout(this.typewriterTimer);
      this.typewriterTimer = null;
    }

    this.currentStep = index;
    const step = this.steps[index];

    // Toggle body step active classes for keyframe animations
    this.steps.forEach((_, idx) => {
      document.body.classList.remove(`tour-step-active-${idx + 1}`);
    });
    document.body.classList.add(`tour-step-active-${index + 1}`);

    // Execute Step Specific OnEnter Callback
    step.onEnter();

    // Update Tooltip Content
    const stepBadge = this.tooltipEl.querySelector('#tour-step-badge');
    const titleEl = this.tooltipEl.querySelector('#tour-title');
    const descEl = this.tooltipEl.querySelector('#tour-desc');
    const backBtn = this.tooltipEl.querySelector('#tour-btn-back');
    const nextBtn = this.tooltipEl.querySelector('#tour-btn-next');

    if (stepBadge) stepBadge.innerText = `Step ${index + 1} of ${this.steps.length}`;
    if (titleEl) titleEl.innerText = step.title;
    if (descEl) descEl.innerText = step.desc;

    // Update Dots Status
    const dots = this.tooltipEl.querySelectorAll('.tour-step-dot');
    dots.forEach((dot, idx) => {
      dot.classList.remove('active', 'completed');
      if (idx === index) {
        dot.classList.add('active');
      } else if (idx < index) {
        dot.classList.add('completed');
      }
    });

    // Update Control Buttons State
    if (backBtn) {
      backBtn.disabled = (index === 0);
    }

    if (nextBtn) {
      if (step.isLast) {
        nextBtn.innerText = '🚀 เปิดใช้งานแอปจริง (Finish)';
        nextBtn.className = 'tour-btn tour-btn-finish';
      } else {
        nextBtn.innerText = 'ถัดไป (Next) ▶️';
        nextBtn.className = 'tour-btn tour-btn-next';
      }
    }

    // Target Scroll & Position Engine
    const targetEl = document.querySelector(step.targetSelector);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Allow scroll animation to settle before computing exact bounds
      setTimeout(() => this.updatePosition(), 250);
    } else {
      this.updatePosition();
    }
  }

  next() {
    if (this.currentStep < this.steps.length - 1) {
      this.showStep(this.currentStep + 1);
    }
  }

  prev() {
    if (this.currentStep > 0) {
      this.showStep(this.currentStep - 1);
    }
  }

  /**
   * Recalculate Spotlight Cutout & Floating Tooltip Positioning
   */
  updatePosition() {
    if (!this.isActive) return;
    const step = this.steps[this.currentStep];
    if (!step) return;

    const targetEl = document.querySelector(step.targetSelector);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const padding = 8;

    // 1. Position Spotlight Box Box-Shadow Cutout
    const spotTop = Math.max(0, rect.top - padding);
    const spotLeft = Math.max(0, rect.left - padding);
    const spotWidth = rect.width + (padding * 2);
    const spotHeight = rect.height + (padding * 2);

    if (this.spotlightEl) {
      this.spotlightEl.style.top = `${spotTop}px`;
      this.spotlightEl.style.left = `${spotLeft}px`;
      this.spotlightEl.style.width = `${spotWidth}px`;
      this.spotlightEl.style.height = `${spotHeight}px`;
    }

    // 2. Position Tooltip Container
    if (!this.tooltipEl) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Mobile viewport (< 768px): Mobile media query handles bottom position
    if (vw <= 768) {
      this.tooltipEl.style.top = '';
      this.tooltipEl.style.left = '';
      return;
    }

    const tooltipWidth = this.tooltipEl.offsetWidth || 360;
    const tooltipHeight = this.tooltipEl.offsetHeight || 220;

    let top = 0;
    let left = 0;

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= tooltipHeight + 24) {
      top = rect.bottom + 16;
    } else if (spaceAbove >= tooltipHeight + 24) {
      top = rect.top - tooltipHeight - 16;
    } else {
      top = Math.max(20, (vh - tooltipHeight) / 2);
    }

    left = rect.left + (rect.width / 2) - (tooltipWidth / 2);

    // Boundary Clamp
    left = Math.max(20, Math.min(left, vw - tooltipWidth - 20));
    top = Math.max(20, Math.min(top, vh - tooltipHeight - 20));

    this.tooltipEl.style.top = `${top}px`;
    this.tooltipEl.style.left = `${left}px`;
  }

  /* ------------------------------------------------------------------------
     STEP SPECIFIC MOCK INTERACTIVITY HELPERS
     ------------------------------------------------------------------------ */

  /**
   * Step 1 Setup: Highlight Employee emp144 role badge
   */
  setupStep1() {
    const roleBadges = document.querySelectorAll('.mock-role-badge');
    roleBadges.forEach(b => {
      if (b.getAttribute('data-role') === 'emp144') {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
      chatHeader.innerText = '💬 AI Chat Assistant (Role: Employee emp144)';
    }

    const input = document.getElementById('mock-chat-input');
    if (input) input.value = '';

    const userMsg = document.getElementById('mock-user-msg');
    if (userMsg) userMsg.style.display = 'none';

    const blockedMsg = document.getElementById('mock-blocked-msg');
    if (blockedMsg) blockedMsg.style.display = 'none';
  }

  /**
   * Step 2 Setup: Typewriter animation for "เงินเดือน CEO เท่าไหร่?"
   */
  setupStep2() {
    this.setupStep1(); // preserve role selection
    const input = document.getElementById('mock-chat-input');
    if (!input) return;

    const queryText = 'เงินเดือน CEO เท่าไหร่?';
    input.value = '';
    input.classList.add('typing');

    let idx = 0;
    const typeNext = () => {
      if (!this.isActive || this.currentStep !== 1) return;
      if (idx < queryText.length) {
        input.value += queryText.charAt(idx);
        idx++;
        this.typewriterTimer = setTimeout(typeNext, 65);
      } else {
        input.classList.remove('typing');
      }
    };
    typeNext();
  }

  /**
   * Step 3 Setup: Highlight 3D Org Graph Nodes (CEO & Emp144 pulse)
   */
  setupStep3() {
    const input = document.getElementById('mock-chat-input');
    if (input) input.value = 'เงินเดือน CEO เท่าไหร่?';

    const userMsg = document.getElementById('mock-user-msg');
    if (userMsg) userMsg.style.display = 'block';

    const blockedMsg = document.getElementById('mock-blocked-msg');
    if (blockedMsg) blockedMsg.style.display = 'none';
  }

  /**
   * Step 4 Setup: RBAC Governance Warning Card Display
   */
  setupStep4() {
    const input = document.getElementById('mock-chat-input');
    if (input) input.value = 'เงินเดือน CEO เท่าไหร่?';

    const userMsg = document.getElementById('mock-user-msg');
    if (userMsg) userMsg.style.display = 'block';

    const blockedMsg = document.getElementById('mock-blocked-msg');
    if (blockedMsg) blockedMsg.style.display = 'flex';
  }

  /**
   * Step 5 Setup: Completion Card & Tour Finished
   */
  setupStep5() {
    this.setupStep4();
  }

  /**
   * End Tour & Reset State
   */
  end() {
    this.isActive = false;

    if (this.typewriterTimer) {
      clearTimeout(this.typewriterTimer);
      this.typewriterTimer = null;
    }

    if (this.backdropEl) this.backdropEl.classList.remove('active');
    if (this.spotlightEl) this.spotlightEl.classList.remove('active');
    if (this.tooltipEl) this.tooltipEl.classList.remove('active');

    // Remove event listeners
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    if (this.scrollHandler) window.removeEventListener('scroll', this.scrollHandler);
    if (this.keydownHandler) window.removeEventListener('keydown', this.keydownHandler);

    this.steps.forEach((_, idx) => {
      document.body.classList.remove(`tour-step-active-${idx + 1}`);
    });
  }
}

// Auto-instantiate singleton instance
export const tourController = new TourGuideController();

// Global init trigger binding helper
export function initTourGuide() {
  const startBtns = document.querySelectorAll('#btn-start-tour, #btn-start-tour-header, .tour-start-btn');
  startBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      tourController.start();
    });
  });
}

// Auto bind on module load if DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTourGuide);
} else {
  initTourGuide();
}
