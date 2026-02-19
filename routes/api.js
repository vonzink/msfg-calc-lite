'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const https = require('https');

const siteConfigPath = path.join(__dirname, '..', 'config', 'site.json');
const promptsPath = path.join(__dirname, '..', 'config', 'ai-prompts.json');

function readSiteConfig() {
  try {
    return JSON.parse(fs.readFileSync(siteConfigPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function readPrompts() {
  try {
    return JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

// Memory-only storage — no files written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

/**
 * POST /api/ai/extract
 * Body: multipart form with `file` (image/PDF) and `slug` (string)
 * Returns: { success, data } or { success: false, message }
 */
router.post('/ai/extract', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded or unsupported file type.' });
  }

  const slug = (req.body.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ success: false, message: 'Missing calculator slug.' });
  }

  // Read AI config
  const siteConfig = readSiteConfig();
  if (!siteConfig || !siteConfig.ai || !siteConfig.ai.apiKey) {
    return res.status(400).json({ success: false, message: 'No AI API key configured. Go to Settings to add one.' });
  }

  const provider = siteConfig.ai.provider;
  if (provider !== 'openai') {
    return res.status(400).json({ success: false, message: 'AI extraction currently requires OpenAI. Set provider to "openai" in Settings.' });
  }

  // Read prompt config
  const prompts = readPrompts();
  if (!prompts || !prompts[slug]) {
    return res.status(400).json({ success: false, message: `No AI prompt configured for calculator "${slug}".` });
  }

  const promptConfig = prompts[slug];
  const model = promptConfig.model || 'gpt-4o';
  const systemPrompt = promptConfig.prompt;

  // Build base64 data URI
  const mimeType = req.file.mimetype;
  const base64 = req.file.buffer.toString('base64');

  // Build OpenAI Chat Completions request
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
            detail: 'high'
          }
        }
      ]
    }
  ];

  const requestBody = JSON.stringify({
    model: model,
    messages: messages,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  const options = {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + siteConfig.ai.apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', (chunk) => { data += chunk; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);

        if (apiRes.statusCode !== 200) {
          const errMsg = parsed.error?.message || ('OpenAI API error: HTTP ' + apiRes.statusCode);
          return res.status(502).json({ success: false, message: errMsg });
        }

        const content = parsed.choices?.[0]?.message?.content;
        if (!content) {
          return res.status(502).json({ success: false, message: 'No content in AI response.' });
        }

        // Parse the JSON response from GPT
        const extracted = JSON.parse(content);
        res.json({ success: true, data: extracted });
      } catch (err) {
        res.status(502).json({ success: false, message: 'Failed to parse AI response: ' + err.message });
      }
    });
  });

  apiReq.on('error', (err) => {
    res.status(502).json({ success: false, message: 'Connection error: ' + err.message });
  });

  apiReq.write(requestBody);
  apiReq.end();
});

module.exports = router;
