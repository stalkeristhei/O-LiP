// O-LiP v2 — Content Script
(function () {
  'use strict';

  let panel = null, fullscreenEl = null, lastAnalysis = null, isScanning = false;

  // ── Page detection ────────────────────────────────────
  const isPRPage = () => /\/pull\/\d+/.test(window.location.pathname);
  const getPRTitle = () => document.querySelector('.js-issue-title, [data-testid="issue-title"]')?.textContent?.trim() || document.title;

  function isPRFilesPage() {
    if (/\/pull\/\d+\/(files|commits)/.test(window.location.pathname)) return true;
    return !!document.querySelector('.diff-table, .blob-code-addition, [data-code-marker="+"], [data-testid="file-diff"]');
  }

  // ── Diff extraction (4 strategies) ───────────────────
  function extractDiff() {
    let allDiff = '', filenames = [];

    // Strategy 1: Modern GitHub file blocks
    document.querySelectorAll('[data-testid="file-diff"], .file, [data-details-container-group="file"]').forEach(file => {
      const fnEl = file.querySelector('[data-testid="file-header-filename"], .file-header a[title], .file-info a, a[title]');
      const fname = fnEl?.getAttribute('title') || fnEl?.textContent?.trim() || '';
      if (fname) filenames.push(fname);
      file.querySelectorAll('tr').forEach(row => {
        const isAdded = !!(row.querySelector('.blob-code-addition, [data-code-marker="+"]') || row.classList.contains('addition'));
        const isDeleted = !!(row.querySelector('.blob-code-deletion, [data-code-marker="-"]') || row.classList.contains('deletion'));
        const codeCell = row.querySelector('.blob-code-inner, [data-testid="code-cell"], td.blob-code:not(.blob-num)');
        if (!codeCell) return;
        const code = codeCell.textContent;
        if (!code.trim()) return;
        allDiff += (isAdded ? '+' : isDeleted ? '-' : ' ') + code + '\n';
      });
      allDiff += '\n';
    });

    // Strategy 2: Direct marker selectors
    if (!allDiff.trim()) {
      document.querySelectorAll('tr').forEach(row => {
        const a = row.querySelector('.blob-code-addition .blob-code-inner');
        const d = row.querySelector('.blob-code-deletion .blob-code-inner');
        const p = row.querySelector('[data-code-marker="+"]');
        const m = row.querySelector('[data-code-marker="-"]');
        if (a) allDiff += `+${a.textContent}\n`;
        else if (d) allDiff += `-${d.textContent}\n`;
        else if (p) allDiff += `+${p.textContent}\n`;
        else if (m) allDiff += `-${m.textContent}\n`;
      });
    }

    // Strategy 3: CSS background color detection
    if (!allDiff.trim()) {
      document.querySelectorAll('table tr').forEach(row => {
        row.querySelectorAll('td').forEach(cell => {
          const bg = window.getComputedStyle(cell).backgroundColor;
          const text = cell.textContent?.trim();
          if (!text || /^\d+$/.test(text)) return;
          if (bg.includes('34, 134') || bg.includes('46, 160') || cell.className.includes('add')) allDiff += `+${text}\n`;
          else if (bg.includes('255, 106') || bg.includes('248, 81') || cell.className.includes('del')) allDiff += `-${text}\n`;
        });
      });
    }

    // Strategy 4: Pre/code fallback
    if (!allDiff.trim()) {
      document.querySelectorAll('pre, code').forEach(el => {
        const t = el.textContent;
        if (t.includes('+') || t.includes('-')) allDiff += t + '\n';
      });
    }

    if (!allDiff.trim()) return null;

    if (!filenames.length) {
      document.querySelectorAll('.file-header a[title], [data-testid="file-header-filename"], .file-info .Link--primary').forEach(el => {
        const n = el.getAttribute('title') || el.textContent?.trim();
        if (n) filenames.push(n);
      });
    }

    return { diff: allDiff.slice(0, 14000), filename: filenames.join(', ').slice(0, 300) || 'multiple files' };
  }

  // ── Helpers ───────────────────────────────────────────
  const escHtml = str => String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const scoreColor = s => s >= 80 ? '#50c878' : s >= 60 ? '#ffd040' : s >= 40 ? '#ff9020' : '#ff4040';
  const gradeColor = g => ({ A:'#50c878', B:'#80d860', C:'#ffd040', D:'#ff9020', F:'#ff4040' }[g] || '#888');

  function topSeverity(findings) {
    for (const s of ['critical','high','medium','low','info'])
      if (findings.some(f => f.severity === s)) return s;
    return 'clean';
  }

  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  // ── Mini panel ────────────────────────────────────────
  function createPanel() {
    if (document.getElementById('o-lip-panel')) return;
    panel = document.createElement('div');
    panel.id = 'o-lip-panel';
    panel.innerHTML = `
      <div class="sg-header" id="sg-header">
        <div class="sg-logo">
          <div class="sg-logo-icon">🛡</div>
          <div class="sg-logo-text">O-<span>LiP</span></div>
        </div>
        <div class="sg-header-actions">
          <span class="sg-badge sg-badge-scanning" id="sg-status-badge">READY</span>
          <button class="sg-icon-btn" id="sg-fullscreen-btn" title="Full screen analysis">⤢</button>
          <button class="sg-icon-btn" id="sg-collapse-btn" title="Collapse">⌃</button>
        </div>
      </div>
      <div class="sg-body" id="sg-body"></div>
      <div class="sg-footer" id="sg-footer" style="display:none">
        <div style="display:flex;gap:6px">
          <button class="sg-rescan-btn" id="sg-rescan-btn">⟳ Scan</button>
          <button class="sg-deep-btn" id="sg-deep-btn">🔬 Deep</button>
        </div>
        <div class="sg-footer-info" id="sg-footer-time"></div>
      </div>`;
    document.body.appendChild(panel);
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('sg-visible')));

    document.getElementById('sg-collapse-btn').addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('sg-collapsed');
      document.getElementById('sg-collapse-btn').textContent = panel.classList.contains('sg-collapsed') ? '⌄' : '⌃';
    });
    document.getElementById('sg-fullscreen-btn').addEventListener('click', e => { e.stopPropagation(); openFullscreen(); });
    document.getElementById('sg-rescan-btn').addEventListener('click', () => startScan(false));
    document.getElementById('sg-deep-btn').addEventListener('click', () => startScan(true));

    checkApiKeyAndMaybeScan();
  }

  // ── Fullscreen overlay ────────────────────────────────
  function openFullscreen() {
    if (document.getElementById('sg-fullscreen')) return;
    fullscreenEl = document.createElement('div');
    fullscreenEl.id = 'sg-fullscreen';

    if (lastAnalysis) {
      fullscreenEl.innerHTML = buildFullscreenHTML(lastAnalysis);
    } else {
      fullscreenEl.innerHTML = buildFullscreenHTML(null);
    }

    document.body.appendChild(fullscreenEl);
    requestAnimationFrame(() => requestAnimationFrame(() => fullscreenEl.classList.add('sg-fs-visible')));

    fullscreenEl.querySelector('#sg-fs-close').addEventListener('click', closeFullscreen);
    fullscreenEl.querySelector('#sg-fs-scan')?.addEventListener('click', () => { closeFullscreen(); startScan(false); });
    fullscreenEl.querySelector('#sg-fs-deep')?.addEventListener('click', () => { closeFullscreen(); startScan(true); });

    // Finding expand in fullscreen
    fullscreenEl.querySelectorAll('.sg-finding-header').forEach(h => {
      h.addEventListener('click', () => h.closest('.sg-finding').classList.toggle('expanded'));
    });
    fullscreenEl.querySelectorAll('.sg-copy-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const code = btn.closest('.sg-patch')?.querySelector('.sg-patch-code')?.textContent;
        if (code) navigator.clipboard.writeText(code).then(() => { btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Copy', 1500); });
      });
    });

    // Tab switching
    fullscreenEl.querySelectorAll('.sg-fs-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        fullscreenEl.querySelectorAll('.sg-fs-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        fullscreenEl.querySelectorAll('.sg-fs-tabpanel').forEach(p => p.style.display = 'none');
        const panel = fullscreenEl.querySelector(`[data-tabpanel="${target}"]`);
        if (panel) panel.style.display = 'block';
      });
    });
  }

  function closeFullscreen() {
    if (!fullscreenEl) return;
    fullscreenEl.classList.remove('sg-fs-visible');
    setTimeout(() => { fullscreenEl?.remove(); fullscreenEl = null; }, 300);
  }

  function buildFullscreenHTML(result) {
    if (!result) {
      return `<div class="sg-fs-wrap">
        <div class="sg-fs-header">
          <div class="sg-fs-title"><span class="sg-fs-shield">🛡</span> O-<span style="color:#ff6035">LiP</span> — Deep Analysis</div>
          <button class="sg-fs-close-btn" id="sg-fs-close">✕</button>
        </div>
        <div class="sg-fs-empty">
          <div style="font-size:48px;margin-bottom:16px">🔬</div>
          <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:8px">No scan results yet</div>
          <div style="color:rgba(255,255,255,0.45);font-size:13px;margin-bottom:24px">Run a scan first to see the full analysis report</div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="sg-rescan-btn" id="sg-fs-scan">⟳ Standard Scan</button>
            <button class="sg-deep-btn" id="sg-fs-deep">🔬 Deep Scan</button>
          </div>
        </div>
      </div>`;
    }

    const { score, grade, summary, riskLevel, findings = [], categories = {}, dependencyIssues = [], securityLearning, teamPolicyViolations = [], positives = [], scanDepth } = result;
    const color = scoreColor(score);
    const sev = findings.length ? topSeverity(findings) : 'clean';
    const sorted = [...findings].sort((a,b) => (sevOrder[a.severity]??9) - (sevOrder[b.severity]??9));

    const catLabels = { injection:'Injection', secrets:'Secrets', auth:'Auth', xss:'XSS', cryptography:'Crypto', dependencies:'Deps', ssrf:'SSRF', deserialization:'Deserial.', accessControl:'Access', dataExposure:'Data Exp.' };
    const catPills = Object.entries(catLabels).map(([k,label]) =>
      `<span class="sg-cat-pill ${categories[k] ? 'flagged' : 'clean'}">${categories[k]?'⚑ ':''}${label}</span>`).join('');

    const sevCounts = { critical:0, high:0, medium:0, low:0, info:0 };
    findings.forEach(f => { if (sevCounts[f.severity] !== undefined) sevCounts[f.severity]++; });

    const findingsList = sorted.length ? sorted.map(f => renderFindingFull(f)).join('') :
      `<div class="sg-clean"><div class="sg-clean-icon">✅</div><div class="sg-clean-text">No issues found</div><div class="sg-clean-sub">This diff looks clean!</div></div>`;

    const depHtml = dependencyIssues.length
      ? dependencyIssues.map(d => `<div class="sg-dep-row"><span class="sg-badge sg-badge-${d.severity}">${d.severity.toUpperCase()}</span><code class="sg-dep-pkg">${escHtml(d.package)}@${escHtml(d.version||'?')}</code><span class="sg-dep-issue">${escHtml(d.issue)}</span></div>`).join('')
      : `<div class="sg-empty-state">No dependency issues detected.</div>`;

    const learningHtml = securityLearning ? `
      <div class="sg-learn-card">
        <div class="sg-learn-title">📚 ${escHtml(securityLearning.concept)}</div>
        <div class="sg-learn-section"><div class="sg-finding-label">What happened?</div><div class="sg-finding-text">${escHtml(securityLearning.explanation)}</div></div>
        <div class="sg-learn-section"><div class="sg-finding-label">How secure systems prevent this</div><div class="sg-finding-text">${escHtml(securityLearning.prevention)}</div></div>
        ${securityLearning.resources?.length ? `<div class="sg-learn-links">${securityLearning.resources.map(r => `<a href="${escHtml(r)}" target="_blank" class="sg-ref-link">📖 ${escHtml(r)}</a>`).join('')}</div>` : ''}
      </div>` : `<div class="sg-empty-state">No learning content for this scan.</div>`;

    const policyHtml = teamPolicyViolations.length
      ? teamPolicyViolations.map(p => `<div class="sg-policy-row"><span class="sg-policy-name">⚑ ${escHtml(p.policy)}</span><span class="sg-policy-violation">${escHtml(p.violation)}</span></div>`).join('')
      : `<div class="sg-empty-state" style="color:#50c878">✓ No team policy violations detected.</div>`;

    const positivesHtml = positives.length
      ? positives.map(p => `<div class="sg-positive-row">✓ ${escHtml(p)}</div>`).join('')
      : `<div class="sg-empty-state">Nothing specific noted.</div>`;

    return `<div class="sg-fs-wrap">
      <div class="sg-fs-header">
        <div class="sg-fs-title"><span class="sg-fs-shield">🛡</span> O-<span style="color:#ff6035">LiP</span> — ${scanDepth === 'DEEP' ? '🔬 Deep Analysis' : 'Security Report'}</div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="sg-rescan-btn" id="sg-fs-scan" style="font-size:11px;padding:6px 12px">⟳ Re-scan</button>
          <button class="sg-deep-btn" id="sg-fs-deep" style="font-size:11px;padding:6px 12px">🔬 Deep Scan</button>
          <button class="sg-fs-close-btn" id="sg-fs-close">✕</button>
        </div>
      </div>

      <div class="sg-fs-body">
        <!-- Left sidebar -->
        <div class="sg-fs-sidebar">
          <div class="sg-fs-score-card">
            <div class="sg-fs-score-num" style="color:${color}">${score}</div>
            <div class="sg-fs-grade" style="color:${gradeColor(grade)}">${grade || '?'}</div>
            <div class="sg-score-label">Security Score</div>
            <div class="sg-score-bar-track" style="margin-top:12px"><div class="sg-score-bar-fill" style="width:${score}%;background:${color}"></div></div>
            <div class="sg-summary-text" style="margin-top:12px;font-size:12px">${escHtml(summary||'')}</div>
          </div>

          <div class="sg-fs-counts">
            ${Object.entries(sevCounts).map(([s,c]) => c > 0 ? `<div class="sg-count-row"><span class="sg-sev-dot sg-sev-${s}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px"></span><span style="color:rgba(255,255,255,0.7);font-size:12px;text-transform:capitalize">${s}</span><span style="margin-left:auto;font-family:monospace;font-size:13px;font-weight:700;color:#fff">${c}</span></div>` : '').join('')}
            ${!findings.length ? `<div style="color:#50c878;font-size:12px;text-align:center;padding:8px">✓ All clear</div>` : ''}
          </div>

          <div class="sg-fs-cats"><div class="sg-findings-header">Categories</div><div class="sg-categories" style="padding:0">${catPills}</div></div>

          ${positives.length ? `<div class="sg-fs-positives"><div class="sg-findings-header">✓ Secure Practices</div>${positivesHtml}</div>` : ''}
        </div>

        <!-- Main content -->
        <div class="sg-fs-main">
          <div class="sg-fs-tabs">
            <button class="sg-fs-tab active" data-tab="findings">Findings (${findings.length})</button>
            <button class="sg-fs-tab" data-tab="deps">Dependencies (${dependencyIssues.length})</button>
            <button class="sg-fs-tab" data-tab="learning">Security Learning</button>
            <button class="sg-fs-tab" data-tab="policy">Team Policy</button>
          </div>

          <div class="sg-fs-tabpanel" data-tabpanel="findings">${findingsList}</div>
          <div class="sg-fs-tabpanel" data-tabpanel="deps" style="display:none">${depHtml}</div>
          <div class="sg-fs-tabpanel" data-tabpanel="learning" style="display:none">${learningHtml}</div>
          <div class="sg-fs-tabpanel" data-tabpanel="policy" style="display:none">${policyHtml}</div>
        </div>
      </div>
    </div>`;
  }

  function renderFindingFull(f) {
    const sev = (f.severity || 'info').toLowerCase();
    const conf = f.confidence || 'medium';
    const confColor = { high: '#50c878', medium: '#ffd040', low: '#ff9020' }[conf] || '#888';
    const patchHtml = f.patch ? `
      <div class="sg-finding-section">
        <div class="sg-finding-label">Suggested Fix</div>
        <div class="sg-patch"><button class="sg-copy-btn">Copy</button><span class="sg-patch-code">${escHtml(f.patch)}</span></div>
      </div>` : '';
    const refsHtml = f.references?.length ? `
      <div class="sg-finding-section">
        <div class="sg-finding-label">References</div>
        ${f.references.map(r => `<a href="${escHtml(r)}" target="_blank" class="sg-ref-link">${escHtml(r)}</a>`).join('')}
      </div>` : '';
    const metaHtml = (f.owaspCategory || f.cweId) ? `
      <div class="sg-finding-section" style="display:flex;gap:8px;flex-wrap:wrap">
        ${f.owaspCategory ? `<span class="sg-meta-tag">🔷 ${escHtml(f.owaspCategory)}</span>` : ''}
        ${f.cweId ? `<span class="sg-meta-tag">🆔 ${escHtml(f.cweId)}</span>` : ''}
        <span class="sg-meta-tag" style="color:${confColor}">⬤ ${conf} confidence</span>
      </div>` : '';

    return `<div class="sg-finding sg-sev-${sev}">
      <div class="sg-finding-header">
        <div class="sg-sev-dot"></div>
        <div class="sg-finding-type">${escHtml(f.type||'Unknown')}</div>
        ${f.file ? `<div class="sg-finding-file">${escHtml(f.file)}</div>` : ''}
        ${f.line ? `<span class="sg-finding-file">L${escHtml(String(f.line))}</span>` : ''}
        <span class="sg-badge sg-badge-${sev}" style="margin-left:auto;flex-shrink:0">${sev.toUpperCase()}</span>
        <span class="sg-finding-expand">⌄</span>
      </div>
      <div class="sg-finding-body">
        ${metaHtml}
        <div class="sg-finding-section"><div class="sg-finding-label">Description</div><div class="sg-finding-text">${escHtml(f.description||'')}</div></div>
        <div class="sg-finding-section"><div class="sg-finding-label">Impact</div><div class="sg-finding-impact">${escHtml(f.impact||'')}</div></div>
        <div class="sg-finding-section"><div class="sg-finding-label">Recommendation</div><div class="sg-finding-text">${escHtml(f.recommendation||'')}</div></div>
        ${patchHtml}
        ${refsHtml}
      </div>
    </div>`;
  }

  // ── Mini panel states ─────────────────────────────────
  function showLoading(deep) {
    const body = document.getElementById('sg-body');
    const badge = document.getElementById('sg-status-badge');
    document.getElementById('sg-footer').style.display = 'none';
    badge.className = 'sg-badge sg-badge-scanning';
    badge.textContent = deep ? 'DEEP SCAN' : 'SCANNING';
    const steps = deep
      ? ['Extracting diff','Running OWASP checks','Deep AI analysis…','Checking dependencies','Building report']
      : ['Extracting diff','Running checks','Asking AI…','Building report'];
    let i = 0;
    body.innerHTML = `<div class="sg-loading"><div class="sg-spinner"></div><div class="sg-loading-text">${deep ? '🔬 Deep Analysis' : 'Analyzing code…'}<div class="sg-loading-steps" id="sg-loading-step">${steps[0]}</div></div></div>`;
    const interval = setInterval(() => { i++; const el = document.getElementById('sg-loading-step'); if (el && i < steps.length) el.textContent = steps[i]; else clearInterval(interval); }, 900);
  }

  function showError(msg) {
    const body = document.getElementById('sg-body');
    document.getElementById('sg-status-badge').className = 'sg-badge sg-badge-critical';
    document.getElementById('sg-status-badge').textContent = 'ERROR';
    document.getElementById('sg-footer').style.display = 'none';
    body.innerHTML = `<div class="sg-error"><div class="sg-finding-label">Error</div><div class="sg-error-text">${escHtml(msg)}</div></div>`;
  }

  function showNoDiff() {
    document.getElementById('sg-status-badge').className = 'sg-badge sg-badge-low';
    document.getElementById('sg-status-badge').textContent = 'N/A';
    document.getElementById('sg-body').innerHTML = `<div class="sg-loading" style="padding:20px 16px"><div style="font-size:24px">📄</div><div class="sg-loading-text">No diff found. Open the <strong>Files changed</strong> tab then re-scan.</div></div>`;
  }

  function showNoKey() {
    document.getElementById('sg-body').innerHTML = `<div class="sg-nokey"><div class="sg-nokey-title">API Key Required</div><div class="sg-nokey-text">Add your Groq, Gemini, or Anthropic API key in the O-LiP popup (toolbar icon → Settings).</div></div>`;
  }

  function showResults(result) {
    const { score, grade, findings = [], categories = {}, scanDepth } = result;
    const body = document.getElementById('sg-body');
    const badge = document.getElementById('sg-status-badge');
    const footer = document.getElementById('sg-footer');
    const sev = findings.length ? topSeverity(findings) : 'clean';
    const color = scoreColor(score);

    badge.className = `sg-badge sg-badge-${sev}`;
    badge.textContent = findings.length ? `${findings.length} ISSUE${findings.length > 1 ? 'S' : ''}` : 'CLEAN';

    const catLabels = { injection:'Injection', secrets:'Secrets', auth:'Auth', xss:'XSS', cryptography:'Crypto', dependencies:'Deps', ssrf:'SSRF', deserialization:'Deserial.', accessControl:'Access', dataExposure:'Data' };
    const catPills = Object.entries(catLabels).map(([k,l]) => `<span class="sg-cat-pill ${categories[k]?'flagged':'clean'}">${categories[k]?'⚑ ':''}${l}</span>`).join('');

    const topFindings = [...findings].sort((a,b) => (sevOrder[a.severity]??9) - (sevOrder[b.severity]??9)).slice(0, 4);
    const findingsHtml = topFindings.length
      ? `<div class="sg-findings"><div class="sg-findings-header">${findings.length} finding${findings.length>1?'s':''} — <span style="color:#ff6035;cursor:pointer" id="sg-view-all">View all ⤢</span></div>${topFindings.map(f => {
          const s = (f.severity||'info').toLowerCase();
          return `<div class="sg-finding sg-sev-${s}"><div class="sg-finding-header" style="cursor:default"><div class="sg-sev-dot"></div><div class="sg-finding-type">${escHtml(f.type||'?')}</div><span class="sg-badge sg-badge-${s}" style="margin-left:auto;font-size:9px">${s.toUpperCase()}</span></div></div>`;
        }).join('')}${findings.length > 4 ? `<div style="font-size:10px;color:rgba(255,255,255,0.35);padding:6px 12px">+${findings.length-4} more — click View all</div>` : ''}</div>`
      : `<div class="sg-clean"><div class="sg-clean-icon">✅</div><div class="sg-clean-text">No issues found</div><div class="sg-clean-sub">Code looks clean. Good work.</div></div>`;

    body.innerHTML = `
      <div class="sg-score-section">
        <div class="sg-score-row">
          <div>
            <div class="sg-score-number" style="color:${color}">${score} <span style="font-size:20px;color:${gradeColor(grade)}">${grade||''}</span></div>
            <div class="sg-score-label">${scanDepth === 'DEEP' ? '🔬 Deep ' : ''}Security Score</div>
          </div>
          <button class="sg-icon-btn" id="sg-mini-fullscreen" title="Full report" style="font-size:18px;width:32px;height:32px">⤢</button>
        </div>
        <div class="sg-score-bar-track"><div class="sg-score-bar-fill" style="width:${score}%;background:${color}"></div></div>
      </div>
      <div class="sg-categories">${catPills}</div>
      ${findingsHtml}`;

    body.querySelector('#sg-view-all')?.addEventListener('click', openFullscreen);
    body.querySelector('#sg-mini-fullscreen')?.addEventListener('click', openFullscreen);

    footer.style.display = 'flex';
    document.getElementById('sg-footer-time').textContent = new Date().toLocaleTimeString();
  }

  // ── Scan logic ────────────────────────────────────────
  function checkApiKeyAndMaybeScan() {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, settings => {
      if (!settings?.apiKey) { showNoKey(); return; }
      if (isPRFilesPage()) startScan(false);
      else {
        document.getElementById('sg-status-badge').textContent = 'READY';
        document.getElementById('sg-body').innerHTML = `<div class="sg-loading" style="padding:20px 16px"><div style="font-size:24px">👁</div><div class="sg-loading-text">Go to <strong>Files changed</strong> tab or click Scan.</div></div>`;
        document.getElementById('sg-footer').style.display = 'flex';
      }
    });
  }

  function startScan(deep = false) {
    if (isScanning) return;
    isScanning = true;
    document.getElementById('sg-rescan-btn').disabled = true;
    document.getElementById('sg-deep-btn').disabled = true;
    showLoading(deep);

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, settings => {
      if (!settings?.apiKey) { isScanning = false; showNoKey(); return; }
      const diffData = extractDiff();
      if (!diffData?.diff?.trim()) {
        isScanning = false;
        document.getElementById('sg-rescan-btn').disabled = false;
        document.getElementById('sg-deep-btn').disabled = false;
        showNoDiff();
        return;
      }

      chrome.runtime.sendMessage({
        type: 'ANALYZE_CODE',
        payload: { apiKey: settings.apiKey, apiProvider: settings.apiProvider || 'groq', diff: diffData.diff, filename: diffData.filename, prTitle: getPRTitle(), deepScan: deep }
      }, response => {
        isScanning = false;
        document.getElementById('sg-rescan-btn').disabled = false;
        document.getElementById('sg-deep-btn').disabled = false;
        if (response?.success) {
          lastAnalysis = response.data;
          showResults(response.data);
          // Update fullscreen if open
          if (fullscreenEl) { closeFullscreen(); setTimeout(() => openFullscreen(), 350); }
        } else {
          showError(response?.error || 'Unknown error');
        }
      });
    });
  }

  // ── SPA navigation ────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.getElementById('o-lip-panel')?.remove();
      document.getElementById('sg-fullscreen')?.remove();
      panel = fullscreenEl = lastAnalysis = null; isScanning = false;
      if (isPRPage()) setTimeout(() => { createPanel(); }, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  window.addEventListener('popstate', () => {
    if (isPRFilesPage() && panel && !isScanning) setTimeout(() => startScan(false), 800);
  });

  if (isPRPage()) setTimeout(() => createPanel(), 1200);
})();
