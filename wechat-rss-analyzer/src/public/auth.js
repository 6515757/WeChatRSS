// ─── 认证系统：答题 + 信封 ─────────────────────────────────────────────────────

(function() {
  var AUTH_API = '/api/auth';
  var overlay = null;
  var state = 'loading'; // loading | quiz | letter | done

  // 页面加载时检查认证
  window.addEventListener('DOMContentLoaded', function() {
    checkAuth();
  });

  function checkAuth() {
    fetch(AUTH_API + '/me')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.authenticated) {
          // 已认证，不显示遮罩
          return;
        }
        showQuiz();
      })
      .catch(function() {
        showQuiz();
      });
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fdfbf7;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:24px;';
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  // ─── 答题界面 ───────────────────────────────────────────────────────────────

  var currentQuestions = [];
  var userAnswers = [null, null, null, null, null];

  function showQuiz() {
    createOverlay();
    state = 'quiz';
    overlay.innerHTML = '<div style="text-align:center;font-family:Kalam,Patrick Hand,sans-serif;font-size:1.2rem;color:#2d2d2d;">正在为你准备题目... ✏️</div>';
    loadChallenge();
  }

  function loadChallenge() {
    fetch(AUTH_API + '/challenge')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { overlay.innerHTML = '<div style="color:#ff4d4d;font-family:Kalam,sans-serif;text-align:center;">' + esc(d.error) + '<br><button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;border:2px solid #2d2d2d;border-radius:20px 6px 22px 8px / 8px 20px 6px 22px;background:#fff;cursor:pointer;font-family:Patrick Hand,sans-serif;">重试</button></div>'; return; }
        currentQuestions = d.questions;
        userAnswers = [null, null, null, null, null];
        renderQuiz();
      })
      .catch(function(e) {
        overlay.innerHTML = '<div style="color:#ff4d4d;font-family:Kalam,sans-serif;text-align:center;">加载失败: ' + esc(e.message) + '</div>';
      });
  }

  function renderQuiz(results) {
    var html = '<div style="max-width:560px;width:100%;margin:0 auto;">';
    html += '<div style="text-align:center;margin-bottom:32px;">';
    html += '<div style="font-family:Kalam,sans-serif;font-size:2rem;font-weight:700;color:#2d2d2d;transform:rotate(-2deg);">💌 验证一下</div>';
    html += '<div style="font-family:Patrick Hand,sans-serif;font-size:1.1rem;color:#2d2d2d;opacity:0.7;margin-top:8px;">回答关于我们的 5 个小问题</div>';
    html += '</div>';

    for (var i = 0; i < currentQuestions.length; i++) {
      var q = currentQuestions[i];
      var isWrong = results && results[i] && !results[i].correct;
      var borderColor = isWrong ? '#ff4d4d' : '#2d2d2d';
      var rot = (i % 2 === 0) ? '-1deg' : '1deg';
      html += '<div style="background:#fff;border:2px solid ' + borderColor + ';box-shadow:4px 4px 0 0 ' + borderColor + ';border-radius:24px 10px 26px 12px / 12px 24px 10px 26px;padding:20px 24px;margin-bottom:20px;transform:rotate(' + rot + ');">';
      html += '<div style="font-family:Kalam,sans-serif;font-size:1.1rem;font-weight:700;margin-bottom:12px;color:#2d2d2d;">' + (i + 1) + '. ' + esc(q.text) + '</div>';
      if (isWrong) {
        html += '<div style="font-family:Patrick Hand,sans-serif;font-size:0.85rem;color:#ff4d4d;margin-bottom:8px;">💔 这道答错了，再想想~</div>';
      }
      for (var j = 0; j < q.options.length; j++) {
        var selected = userAnswers[i] === j;
        var bg = selected ? (isWrong ? '#ffe0e0' : '#fff9c4') : '#fdfbf7';
        var border = selected ? (isWrong ? '#ff4d4d' : '#2d2d2d') : '#e5e0d8';
        html += '<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:6px;border:2px solid ' + border + ';border-radius:16px 6px 18px 8px / 8px 16px 6px 18px;background:' + bg + ';cursor:pointer;font-family:Patrick Hand,sans-serif;font-size:1rem;transition:all 0.1s ease;" onmouseover="this.style.transform=\'rotate(-0.5deg)\'" onmouseout="this.style.transform=\'\'">';
        html += '<input type="radio" name="q' + i + '" value="' + j + '" ' + (selected ? 'checked' : '') + ' onchange="window._authSelectAnswer(' + i + ',' + j + ')" style="accent-color:#ff4d4d;width:16px;height:16px;">';
        html += '<span>' + esc(q.options[j]) + '</span>';
        html += '</label>';
      }
      html += '</div>';
    }

    html += '<div style="text-align:center;margin-top:24px;">';
    html += '<button id="auth-submit-btn" onclick="window._authSubmit()" style="font-family:Kalam,sans-serif;font-size:1.2rem;font-weight:700;padding:12px 40px;border:3px solid #2d2d2d;background:#ff4d4d;color:#fff;border-radius:20px 6px 22px 8px / 8px 20px 6px 22px;box-shadow:4px 4px 0 0 #2d2d2d;cursor:pointer;transition:all 0.1s ease;">提交答案 💕</button>';
    html += '</div>';
    html += '</div>';

    overlay.innerHTML = html;
  }

  window._authSelectAnswer = function(qi, oi) {
    userAnswers[qi] = oi;
  };

  window._authSubmit = function() {
    // 检查是否全部作答
    for (var i = 0; i < 5; i++) {
      if (userAnswers[i] === null) {
        alert('还有题目没回答哦~');
        return;
      }
    }

    var btn = document.getElementById('auth-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '验证中...'; }

    fetch(AUTH_API + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: userAnswers }),
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          showLetter();
        } else {
          // 显示哪些错了
          renderQuiz(d.results);
        }
      })
      .catch(function(e) {
        alert('验证失败: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '提交答案 💕'; }
      });
  };

  // ─── 信封界面 ───────────────────────────────────────────────────────────────

  function showLetter() {
    state = 'letter';
    var html = '<div style="max-width:520px;width:100%;margin:0 auto;text-align:center;">';

    // 信封（未打开状态）
    html += '<div id="envelope-container" style="cursor:pointer;" onclick="window._openEnvelope()">';
    html += '<div style="font-family:Kalam,sans-serif;font-size:1.5rem;font-weight:700;color:#2d2d2d;margin-bottom:20px;transform:rotate(-2deg);">✨ 答对啦！有一封信给你 ✨</div>';
    html += '<div style="font-family:Patrick Hand,sans-serif;font-size:1rem;color:#2d2d2d;opacity:0.7;margin-bottom:24px;">点击信封打开 💌</div>';
    // 信封 SVG
    html += '<div style="display:inline-block;transform:rotate(-3deg);transition:transform 0.3s ease;" onmouseover="this.style.transform=\'rotate(0deg) scale(1.05)\'" onmouseout="this.style.transform=\'rotate(-3deg)\'">';
    html += '<svg width="200" height="140" viewBox="0 0 200 140"><rect x="5" y="30" width="190" height="105" rx="4" fill="#fff9c4" stroke="#2d2d2d" stroke-width="3"/><polygon points="5,30 100,85 195,30" fill="#fffbe0" stroke="#2d2d2d" stroke-width="3" stroke-linejoin="round"/><polygon points="5,135 80,80 100,95 120,80 195,135" fill="#fff3a0" stroke="#2d2d2d" stroke-width="2" stroke-linejoin="round" opacity="0.6"/><circle cx="100" cy="60" r="12" fill="#ff4d4d" stroke="#2d2d2d" stroke-width="2"/><text x="100" y="65" text-anchor="middle" font-family="Kalam" font-size="14" fill="#fff" font-weight="700">♥</text></svg>';
    html += '</div>';
    html += '</div>';

    // 信的内容（初始隐藏）
    html += '<div id="letter-content" style="display:none;">';
    html += '<div style="background:#fff;border:2px solid #2d2d2d;box-shadow:6px 6px 0 0 #2d2d2d;border-radius:30px 12px 28px 14px / 14px 30px 12px 28px;padding:32px 28px;text-align:left;transform:rotate(-1deg);margin-top:24px;">';
    html += '<div style="font-family:Kalam,sans-serif;font-size:1.3rem;font-weight:700;color:#ff4d4d;margin-bottom:16px;text-align:center;">写给宝宝的信 💌</div>';
    html += '<div style="font-family:Patrick Hand,sans-serif;font-size:1.05rem;color:#2d2d2d;line-height:2;">';
    html += '<p>亲爱的宝宝：</p>';
    html += '<p>还记得 1 月 8 号那天吗？那时候的我，大概怎么也想不到，一次普通的朋友介绍，会变成我人生里最重要的转折。</p>';
    html += '<p>第一次一起吃火锅，你笑起来的样子，让整个冬天都暖了。2 月 8 号我们确定关系，一起做了挂坠——那天我心里想的是，这个人，我想一直走下去。</p>';
    html += '<p>后来我们一起做了戒指，一起看了樱花，一起在家里涮火锅。每一个"第一次"都被我小心翼翼地记着，因为和你在一起的每一天，都值得被记住。</p>';
    html += '<p>这个小网站，是我偷偷给你做的。每天帮你看看公众号都在聊什么，省得你一篇篇翻。虽然它现在还有点粗糙，但就像我们的故事一样——会越来越好的。</p>';
    html += '<p style="text-align:right;margin-top:20px;color:#2d5da1;">永远喜欢你的<br><span style="font-family:Kalam,sans-serif;font-weight:700;font-size:1.2rem;">飞</span></p>';
    html += '</div>';
    html += '</div>';
    html += '<div style="margin-top:28px;">';
    html += '<button onclick="window._enterApp()" style="font-family:Kalam,sans-serif;font-size:1.1rem;font-weight:700;padding:12px 36px;border:3px solid #2d2d2d;background:#fff9c4;color:#2d2d2d;border-radius:20px 6px 22px 8px / 8px 20px 6px 22px;box-shadow:4px 4px 0 0 #2d2d2d;cursor:pointer;transition:all 0.1s ease;">进入主页 →</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    overlay.innerHTML = html;
  }

  window._openEnvelope = function() {
    var env = document.getElementById('envelope-container');
    var letter = document.getElementById('letter-content');
    if (env) env.style.display = 'none';
    if (letter) letter.style.display = 'block';
  };

  window._enterApp = function() {
    removeOverlay();
  };

  // ─── 工具 ───────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
