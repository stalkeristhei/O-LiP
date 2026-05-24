// O-LiP — Background Service Worker (Gemini + Anthropic)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_CODE') {
    analyzeCode(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['apiKey', 'apiProvider', 'autoScan', 'severity'], (data) => sendResponse(data));
    return true;
  }
  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.payload, () => sendResponse({ success: true }));
    return true;
  }
});

async function analyzeCode(payload) {
  const { apiKey, apiProvider, diff, filename, prTitle, deepScan } = payload;
  if (!apiKey) apiKey = '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';

  const depth = deepScan ? 'DEEP' : 'STANDARD';

  const systemPrompt = `You are O-LiP, an expert security code reviewer trained on OWASP Top 10 and CWE/SANS Top 25.
${deepScan ? 'Perform a DEEP analysis: check every line thoroughly, identify subtle logic flaws, race conditions, insecure design patterns, and provide detailed remediation with full code patches.' : 'Perform a standard security review focusing on high-impact vulnerabilities.'}
Respond ONLY with valid JSON. No markdown, no preamble, no backticks.

{
  "score": <0-100>,
  "grade": "<A|B|C|D|F>",
  "summary": "<2-3 sentence assessment>",
  "riskLevel": "<critical|high|medium|low|clean>",
  "findings": [
    {
      "id": "<short-unique-id>",
      "type": "<e.g. SQL Injection>",
      "severity": "<critical|high|medium|low|info>",
      "confidence": "<high|medium|low>",
      "file": "<filename>",
      "line": "<line number or null>",
      "description": "<clear explanation>",
      "impact": "<what attacker could do>",
      "owaspCategory": "<e.g. A03:2021 Injection>",
      "cweId": "<e.g. CWE-89>",
      "recommendation": "<specific actionable fix>",
      "patch": "<corrected code snippet or null>",
      "references": ["<url1>"]
    }
  ],
  "categories": {
    "injection": <true|false>, "secrets": <true|false>, "auth": <true|false>,
    "xss": <true|false>, "cryptography": <true|false>, "dependencies": <true|false>,
    "ssrf": <true|false>, "deserialization": <true|false>, "accessControl": <true|false>,
    "dataExposure": <true|false>
  },
  "dependencyIssues": [
    { "package": "<name>", "version": "<ver>", "issue": "<description>", "severity": "<high|medium|low>" }
  ],
  "securityLearning": {
    "concept": "<main vulnerability concept>",
    "explanation": "<beginner-friendly explanation>",
    "prevention": "<how secure systems prevent this>",
    "resources": ["<url>"]
  },
  "teamPolicyViolations": [
    { "policy": "<e.g. No hardcoded secrets>", "violation": "<what violated it>" }
  ],
  "positives": ["<things done well>"],
  "scanDepth": "${depth}"
}
Only flag added lines (+). Return valid JSON only. Never invent issues.`;

  const userPrompt = `PR: ${prTitle || 'Unknown PR'}
Files: ${filename || 'unknown'}
Scan depth: ${depth}

Diff:
\`\`\`
${diff}
\`\`\`

Analyze for: SQL/Command/LDAP injection, hardcoded secrets & API keys, auth/authz flaws, XSS, insecure crypto, SSRF, unsafe deserialization, path traversal, race conditions, privilege escalation, exposed sensitive data, insecure dependencies, missing input validation.${deepScan ? ' IMPORTANT: Be exhaustive — report ALL issues including minor ones. Do not skip or omit any finding regardless of severity. Check logic flow, subtle patterns, and edge cases.' : ''}`;

  if (!apiKey) apiKey = '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';
  const provider = apiProvider || 'groq';
  if (provider === 'groq') return await callGroq(apiKey, systemPrompt, userPrompt, deepScan);
  else if (provider === 'gemini') return await callGemini(apiKey, systemPrompt, userPrompt, deepScan);
  else return await callAnthropic(apiKey, systemPrompt, userPrompt, deepScan);
}

async function callGroq(apiKey, systemPrompt, userPrompt, deepScan) {
  // Use llama-3.3-70b for both — consistent quality, deep scan just gets more tokens
  const model = 'llama-3.3-70b-versatile';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: deepScan ? 6000 : 3000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${response.status}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Robust JSON extraction — find the outermost { } block
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON found in response. Try again.');
  const jsonStr = clean.slice(firstBrace, lastBrace + 1);

  try { return JSON.parse(jsonStr); }
  catch {
    // Last resort: try to salvage truncated JSON by closing open structures
    try {
      const salvaged = salvageJSON(jsonStr);
      return JSON.parse(salvaged);
    } catch {
      throw new Error('Failed to parse response. The diff may be too large — try scanning fewer files.');
    }
  }
}

function salvageJSON(str) {
  // Count unclosed braces and brackets and close them
  let openBraces = 0, openBrackets = 0, inString = false, escape = false;
  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  // Remove trailing comma if present before closing
  let result = str.trimEnd().replace(/,\s*$/, '');
  result += ']'.repeat(Math.max(0, openBrackets));
  result += '}'.repeat(Math.max(0, openBraces));
  return result;
}

async function callGemini(apiKey, systemPrompt, userPrompt, deepScan) {
  const model = deepScan ? 'gemini-2.0-flash' : 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: deepScan ? 4000 : 2000,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `Gemini API error: ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(clean); }
  catch { throw new Error('Failed to parse Gemini response. Try again.'); }
}

async function callAnthropic(apiKey, systemPrompt, userPrompt, deepScan) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: deepScan ? 4000 : 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(clean); }
  catch { throw new Error('Failed to parse Anthropic response.'); }
}
