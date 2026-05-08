---
layout: home
---

<style>
/* 覆盖页面背景和容器 */
body {
  background: #0a0a0f !important;
}
.main-inner {
  max-width: 100% !important;
  width: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}
.header, .sidebar, .footer, .post-header, .post-meta-container, .post-nav, .pagination, .comments, .back-to-top, .reading-progress-bar, .headband {
  display: none !important;
}
.main {
  padding-bottom: 0 !important;
}
.content {
  padding: 0 !important;
}

/* 全屏容器 */
.landing {
  width: 100vw;
  height: 100vh;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #0a0a0f;
}

/* 背景光晕 */
.landing::before {
  content: '';
  position: absolute;
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(100, 130, 255, 0.25) 0%, transparent 70%);
  top: -200px;
  left: -150px;
  animation: driftA 20s ease-in-out infinite;
}
.landing::after {
  content: '';
  position: absolute;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(255, 100, 180, 0.2) 0%, transparent 70%);
  bottom: -150px;
  right: -100px;
  animation: driftB 25s ease-in-out infinite;
}

/* 额外光点 */
.orb-1, .orb-2 {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.orb-1 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(80, 200, 200, 0.18) 0%, transparent 70%);
  top: 30%;
  right: -100px;
  animation: driftC 18s ease-in-out infinite;
}
.orb-2 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, rgba(255, 200, 60, 0.12) 0%, transparent 70%);
  bottom: 20%;
  left: -80px;
  animation: driftA 22s ease-in-out infinite reverse;
}

@keyframes driftA {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(40px, -30px) scale(1.08); }
  50% { transform: translate(-20px, 20px) scale(0.95); }
  75% { transform: translate(30px, 10px) scale(1.05); }
}
@keyframes driftB {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(-50px, -20px) scale(1.1); }
  66% { transform: translate(20px, 30px) scale(0.93); }
}
@keyframes driftC {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-30px, -40px) scale(1.15); }
}

/* 卡片容器 */
.cards {
  display: flex;
  gap: 32px;
  position: relative;
  z-index: 10;
  padding: 0 40px;
}

/* 毛玻璃卡片 */
.card {
  width: 300px;
  height: 420px;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  text-decoration: none;
  position: relative;
  overflow: hidden;
  transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);

  /* 毛玻璃核心 */
  background: rgba(255,255,255,0.03);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.06);

  /* 内发光 */
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 4px 30px rgba(0,0,0,0.4);
}

.card:hover {
  transform: translateY(-12px);
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.15);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 20px 60px rgba(0,0,0,0.5),
    0 0 40px rgba(120,150,255,0.08);
}

/* 卡片顶部光条 */
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
  transition: opacity 0.4s;
}
.card:hover::before {
  opacity: 0;
}

/* 卡片底部微光 */
.card::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 40px;
  right: 40px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
}

/* 卡片内容 */
.card .icon {
  font-size: 56px;
  margin-bottom: 28px;
  filter: drop-shadow(0 4px 20px rgba(0,0,0,0.3));
  transition: transform 0.5s cubic-bezier(0.23, 1, 0.32, 1);
}
.card:hover .icon {
  transform: scale(1.12) translateY(-4px);
}

.card .label {
  font-size: 26px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  letter-spacing: 6px;
  margin-bottom: 12px;
  transition: color 0.4s;
}
.card:hover .label {
  color: #fff;
}

.card .hint {
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  letter-spacing: 3px;
  font-weight: 300;
  transition: color 0.4s;
}
.card:hover .hint {
  color: rgba(255,255,255,0.7);
}

.card .arrow {
  margin-top: 32px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.3);
  font-size: 14px;
  transition: all 0.4s;
}
.card:hover .arrow {
  border-color: rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.8);
  background: rgba(255,255,255,0.05);
  transform: translateX(4px);
}

@media (max-width: 1024px) {
  .cards {
    gap: 20px;
    padding: 0 24px;
  }
  .card {
    width: 240px;
    height: 360px;
  }
  .card .label {
    font-size: 22px;
    letter-spacing: 4px;
  }
}

@media (max-width: 768px) {
  .cards {
    flex-direction: column;
    gap: 16px;
  }
  .card {
    width: 280px;
    height: 160px;
    flex-direction: row;
    gap: 24px;
    padding: 0 32px;
  }
  .card .icon {
    font-size: 36px;
    margin-bottom: 0;
  }
  .card .label {
    font-size: 20px;
    letter-spacing: 4px;
  }
  .card .arrow {
    display: none;
  }
}
</style>

<div class="landing">
<div class="orb-1"></div>
<div class="orb-2"></div>

<div class="cards">

<a class="card" href="/categories/随笔/">
<span class="icon">✧</span>
<div class="label">随  笔</div>
<div class="hint">日常 · 杂记</div>
<div class="arrow">→</div>
</a>

<a class="card" href="/categories/摄影/">
<span class="icon">◷</span>
<div class="label">摄  影</div>
<div class="hint">照片 · 分享</div>
<div class="arrow">→</div>
</a>

<a class="card" href="/categories/技术笔记/">
<span class="icon">⬡</span>
<div class="label">技术笔记</div>
<div class="hint">Java · Python · AI</div>
<div class="arrow">→</div>
</a>

</div>
</div>
