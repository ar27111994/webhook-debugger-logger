# Apify $1M Challenge: Implementation Templates & Code Examples

## Ready-to-Use Templates for Rapid Development

---

## TABLE OF CONTENTS

1. [Input Schema Templates](#input-schemas)
2. [Output Schema Templates](#output-schemas)
3. [README Templates](#readme-templates)
4. [Error Handling Patterns](#error-patterns)
5. [Marketing Post Templates](#marketing-templates)
6. [Quality Optimization Examples](#quality-examples)

---

# INPUT SCHEMA TEMPLATES

## Template 1: Email Validator Input

```json
{
  "title": "Email Validator Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "emails": {
      "type": "array",
      "title": "Email Addresses",
      "description": "Array of email addresses to validate (paste as JSON array or upload CSV)",
      "editor": "json",
      "minItems": 1,
      "maxItems": 10000,
      "example": ["john@company.com", "sarah@startup.io"]
    },
    "enrichment": {
      "type": "string",
      "title": "Enrichment Level",
      "description": "How much company data to retrieve",
      "enum": ["basic", "full", "none"],
      "default": "basic"
    },
    "hunterApiKey": {
      "type": "string",
      "title": "Hunter.io API Key (Optional)",
      "description": "Your Hunter.io API key for enrichment. Get at https://hunter.io/",
      "isSecret": true
    },
    "removeInvalid": {
      "type": "boolean",
      "title": "Remove Invalid Emails",
      "description": "Don't include invalid emails in output",
      "default": true
    },
    "includeRiskFlags": {
      "type": "boolean",
      "title": "Include Risk Flags",
      "description": "Flag disposable emails, catch-alls, etc.",
      "default": true
    }
  },
  "required": ["emails"]
}
```

## Template 2: Webhook Debugger Input

```json
{
  "title": "Webhook Debugger Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "urlCount": {
      "type": "integer",
      "title": "Number of Webhook URLs",
      "description": "How many unique webhook URLs to generate (1-10)",
      "minimum": 1,
      "maximum": 10,
      "default": 3
    },
    "retentionHours": {
      "type": "integer",
      "title": "Retention Period (hours)",
      "description": "How long to keep webhook URLs active (1-72 hours)",
      "minimum": 1,
      "maximum": 72,
      "default": 24
    },
    "maxPayloadSize": {
      "type": "integer",
      "title": "Max Payload Size (MB)",
      "description": "Maximum request body size in megabytes",
      "minimum": 1,
      "maximum": 100,
      "default": 10
    },
    "enableJSONParsing": {
      "type": "boolean",
      "title": "Parse JSON Bodies",
      "description": "Attempt to parse JSON in request body",
      "default": true
    }
  },
  "required": []
}
```

## Template 3: Social Media Scheduler Input

```json
{
  "title": "Social Media Scheduler Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "postContent": {
      "type": "string",
      "title": "Post Content",
      "description": "Main content of your post",
      "editor": "textarea",
      "minLength": 1,
      "maxLength": 5000,
      "example": "Just launched something amazing! Check it out."
    },
    "mediaUrls": {
      "type": "array",
      "title": "Media URLs",
      "description": "Image or video URLs to attach (max 5)",
      "maxItems": 5,
      "example": ["https://example.com/image.jpg"]
    },
    "platforms": {
      "type": "array",
      "title": "Target Platforms",
      "description": "Which platforms to post to",
      "editor": "checkbox",
      "items": {
        "type": "string",
        "enum": ["twitter", "linkedin", "facebook", "bluesky"]
      },
      "default": ["twitter"]
    },
    "scheduleTime": {
      "type": "string",
      "title": "Schedule Time (Optional)",
      "description": "ISO 8601 datetime for scheduling (e.g., 2025-12-25T14:30:00Z). Leave blank for immediate posting.",
      "pattern": "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z",
      "example": "2025-12-25T14:30:00Z"
    },
    "includeHashtags": {
      "type": "boolean",
      "title": "Auto-Add Hashtags",
      "description": "Automatically add relevant hashtags to content",
      "default": true
    },
    "twitterApiKey": {
      "type": "string",
      "title": "Twitter API Key",
      "description": "Bearer token for Twitter API",
      "isSecret": true
    }
  },
  "required": ["postContent", "platforms"]
}
```

---

# OUTPUT SCHEMA TEMPLATES

## Template 1: Email Validator Output

```json
{
  "title": "Email Validator Output",
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "Array of validated email entries",
      "items": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "description": "Original email address"
          },
          "isValid": {
            "type": "boolean",
            "description": "Whether email is valid"
          },
          "domain": {
            "type": "string",
            "description": "Email domain"
          },
          "company": {
            "type": "string",
            "description": "Company name (if enriched)"
          },
          "industry": {
            "type": "string",
            "description": "Company industry"
          },
          "employees": {
            "type": "string",
            "description": "Employee count range"
          },
          "confidence": {
            "type": "integer",
            "description": "Confidence score (0-100)"
          },
          "riskFlags": {
            "type": "array",
            "description": "Risk flags (disposable, catchAll, etc.)"
          },
          "deliverability": {
            "type": "string",
            "enum": ["high", "medium", "low"]
          }
        }
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "total": { "type": "integer" },
        "valid": { "type": "integer" },
        "invalid": { "type": "integer" },
        "enriched": { "type": "integer" }
      }
    }
  }
}
```

## Template 2: Webhook Debugger Output

```json
{
  "title": "Webhook Debugger Output",
  "type": "object",
  "properties": {
    "webhooks": {
      "type": "array",
      "description": "Generated webhook URLs",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "url": { "type": "string" },
          "createdAt": { "type": "string" },
          "expiresAt": { "type": "string" }
        }
      }
    },
    "events": {
      "type": "array",
      "description": "Captured webhook events",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": { "type": "string" },
          "webhookId": { "type": "string" },
          "method": { "type": "string" },
          "headers": { "type": "object" },
          "body": { "type": "string" },
          "size": { "type": "integer" },
          "contentType": { "type": "string" }
        }
      }
    }
  }
}
```

---

# README TEMPLATES

## Template 1: Quick Start README (Webhook Debugger)

```markdown
# Webhook Debugger

Test and inspect webhooks instantly without running localhost.

**[Watch 2-min demo](https://youtube.com/...)**

## What does it do?

Webhook Debugger generates temporary webhook URLs and logs every incoming
request with full details (headers, body, query params). Perfect for testing
webhook integrations from Stripe, GitHub, Shopify, or any service.

**What it does NOT do**:

- ❌ Modify webhooks (read-only logging)
- ❌ Replay webhooks (data capture only)
- ❌ Permanent storage (auto-cleanup after 24-72 hours)

## Why use Webhook Debugger?

### The Problem

Debugging webhooks is painful:

- ❌ Can't see what data services send
- ❌ No way to inspect payloads
- ❌ Localhost tunneling is complicated (ngrok, etc.)
- ❌ Failed webhook tests require service reconfiguration

### The Solution
```

1. Run Webhook Debugger
2. Get 3 unique webhook URLs
3. Configure service to send to those URLs
4. See all requests in real-time
5. Export logs as JSON/CSV

````

No setup required. No localhost tunneling. Takes 30 seconds.

## What can this Actor do?

| Feature | Description |
|---------|------------|
| **URL Generation** | Generate 1-10 temporary webhook URLs |
| **Request Logging** | Capture ALL incoming requests |
| **Full Details** | Headers, body, query params, IP, timing |
| **Auto-Cleanup** | URLs expire automatically (configurable) |
| **Export** | Download logs as JSON or CSV |
| **Live Viewing** | See requests in real-time in dataset |

## Input example

### Simple mode (basic)
```json
{
  "urlCount": 3,
  "retentionHours": 24
}
````

Copy the 3 webhook URLs from the output dataset.

Configure your service (Stripe, GitHub, etc.) to send to these URLs.

### Advanced mode

```json
{
  "urlCount": 5,
  "retentionHours": 72,
  "maxPayloadSize": 10,
  "enableJSONParsing": true
}
```

## Output example

### JSON format

```json
{
  "webhooks": [
    {
      "id": "wh_abc123",
      "url": "https://api.apify.com/webhook/wh_abc123",
      "createdAt": "2025-12-19T14:30:00Z",
      "expiresAt": "2025-12-20T14:30:00Z"
    }
  ],
  "events": [
    {
      "timestamp": "2025-12-19T14:31:45Z",
      "webhookId": "wh_abc123",
      "method": "POST",
      "headers": {
        "content-type": "application/json",
        "user-agent": "Stripe/1.0"
      },
      "body": "{\"type\": \"payment.success\", \"amount\": 9999}",
      "size": 78,
      "contentType": "application/json"
    }
  ]
}
```

### CSV export

| Timestamp            | Webhook ID | Method | Body                        | Size | Content-Type     |
| -------------------- | ---------- | ------ | --------------------------- | ---- | ---------------- |
| 2025-12-19T14:31:45Z | wh_abc123  | POST   | {"type": "payment.success"} | 78   | application/json |

## How to get started

**Step 1**: Open this Actor and input the settings above

**Step 2**: Click "Start" and wait for the Actor to finish (30 seconds)

**Step 3**: Find your webhook URLs in the dataset output

**Step 4**: Copy webhook URLs to clipboard

**Step 5**: Configure your service (Stripe, GitHub, etc.) to send to these URLs

**Step 6**: When webhooks arrive, they'll appear in the dataset

**Step 7**: Download dataset as JSON or CSV for analysis

## Pricing

Pay only for requests you actually capture:

- **$0.01 per webhook request logged**
- Batch: 100 webhooks = $1
- Batch: 1,000 webhooks = $10

**Examples**:

- Testing 50 webhook calls: $0.50
- Debugging daily: ~$1/month
- Heavy integration testing: $5-10/month

## Advanced features

### Use your own API keys

Set up authentication in the input to capture OAuth tokens:

```json
{
  "apiKeys": {
    "stripe": "sk_test_abc123",
    "github": "ghp_abc123"
  }
}
```

### Export directly to Google Sheets

Auto-populate your logs into Google Sheets:

```json
{
  "exportToSheets": "https://docs.google.com/spreadsheets/d/..."
}
```

### Integrate with Zapier/Make

Use this Actor's webhook URLs with automation platforms for complex workflows.

## FAQ

**Q: How long are webhook URLs valid?**
A: By default, 24 hours. You can set 1-72 hours in input.

**Q: Will you store my data?**
A: No. Data is stored only in your Apify dataset (you own this). After TTL
expires, URLs and old requests are deleted automatically.

**Q: Can I test production webhooks?**
A: Yes, but be careful! These are public URLs. Use them only for testing,
not in production.

**Q: What's the payload size limit?**
A: 10MB by default. Configurable in input.

**Q: Can I replay captured webhooks?**
A: Not currently, but you can export the body and resend manually.

## Troubleshooting

**Issue**: "Webhook not captured"
**Solution**: Verify webhook URL is copied correctly. Check service is actually
sending webhooks (check service logs). Ensure URL hasn't expired.

**Issue**: "URL expired"
**Solution**: Webhook URLs expire after the retention period you set.
Re-run Actor to generate new URLs.

**Issue**: "Payload too large"
**Solution**: Reduce `maxPayloadSize` setting or try a smaller test payload.

## See also

- [Testing Webhooks Guide](https://docs.apify.com/...)
- [Webhook Security Best Practices](https://...)
- [Stripe Webhook Documentation](https://stripe.com/docs/webhooks)
- [Discord Community](https://discord.gg/...)

---

**Questions?** Comment below or join the Apify community Discord!

````

---

# ERROR HANDLING PATTERNS

## Pattern 1: Express Error Handler (Node.js)

```javascript
// Error middleware
app.use((err, req, res, next) => {
  // Log the error
  Apify.utils.log.error('Request error:', err);

  // Determine status code
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Send error response
  res.status(statusCode).json({
    error: message,
    statusCode: statusCode,
    timestamp: new Date().toISOString()
  });
});

// Try-catch wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Usage
app.post('/webhook/:id', asyncHandler(async (req, res) => {
  if (!req.params.id) {
    return res.status(400).json({
      error: 'Webhook ID is required',
      example: '/webhook/wh_abc123'
    });
  }

  if (req.headers['content-length'] > MAX_PAYLOAD) {
    return res.status(413).json({
      error: 'Payload too large',
      max: MAX_PAYLOAD,
      received: req.headers['content-length']
    });
  }

  // Process request...
}));
````

## Pattern 2: API Call with Retry Logic

```javascript
const retry = async (fn, maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      // Exponential backoff
      const waitTime = delay * Math.pow(2, attempt - 1);
      Apify.utils.log.warning(
        `Attempt ${attempt} failed, retrying in ${waitTime}ms...`,
        err.message,
      );
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
};

// Usage
const data = await retry(() => axios.get(url, { timeout: 5000 }), 3, 1000);
```

## Pattern 3: Data Validation

```javascript
const validateEmail = (email) => {
  const errors = [];

  if (!email) {
    errors.push("Email is required");
  }

  if (!email.includes("@")) {
    errors.push("Email must contain @");
  }

  if (email.length > 254) {
    errors.push("Email too long (max 254 characters)");
  }

  return {
    isValid: errors.length === 0,
    errors,
    message: errors.join("; "),
  };
};

// Usage in Actor
for (const email of emails) {
  const validation = validateEmail(email);
  if (!validation.isValid) {
    Apify.utils.log.warning(`Invalid email: ${email} - ${validation.message}`);
  }
}
```

---

# MARKETING POST TEMPLATES

## Template 1: Reddit Post (r/webdev)

```markdown
Title: I spent 3 hours debugging a webhook, so I built this tool.

---

Hey devs, I'm a backend engineer who spent way too much time trying to
test webhooks from Stripe. Couldn't see what was being sent, localhost
tunneling sucked, and configuring ngrok was a hassle.

So I built [Webhook Debugger](https://apify.com/...) to solve this.

**How it works**:

1. Run the Actor (takes 30 seconds)
2. Get 3 unique webhook URLs
3. Configure your service to send to these URLs
4. See all requests in real-time
5. Export logs as JSON/CSV

**What's different**:

- ✅ No localhost setup required
- ✅ No ngrok tunneling needed
- ✅ URLs auto-expire (24-72 hours configurable)
- ✅ See full request details (headers, body, IP, etc.)
- ✅ Pay only for requests you test ($0.01 per request)

Built on Apify. Free to try. No credit card needed.

Feedback welcome! I'm also building email validation and social media
scheduling tools if anyone's interested.

[Try Webhook Debugger →](https://apify.com/...)

---
```

## Template 2: Stack Overflow Answer

```
Question: "How can I test webhooks locally for my Node.js application?"

---

I had this exact problem. Testing webhooks locally is a pain because you
need to expose your local server to the internet (ngrok, localtunnel, etc.).

Here's what I did:

**Instead of running localhost**: I built an Actor that generates temporary
webhook URLs you can test against.

**How it works**:
```

1. Run Actor → Get 3 unique webhook URLs
2. Configure your service (Stripe, GitHub, etc.) to send to these URLs
3. All requests get logged with full details
4. Export logs to JSON/CSV for analysis

````

**Code example**:
```javascript
const webhookUrl = 'https://api.apify.com/webhook/wh_abc123';

// Send test webhook
const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: 'test', timestamp: Date.now() })
});
````

**Benefits over localhost tunneling**:

- ✅ No setup required
- ✅ Works across all machines
- ✅ Easy to share URLs with team
- ✅ Automatic logging
- ✅ No firewall/network issues

Try it: [Webhook Debugger on Apify](https://apify.com/...)

Hope this helps!

````

## Template 3: Dev.to Article

```markdown
---
title: "How to Test Webhooks Without Running Localhost (Free Tool)"
description: "Stop using ngrok. Here's a better way to debug webhooks."
tags: webhooks, testing, nodejs, debugging
---

# How to Test Webhooks Without Running Localhost

Testing webhooks sucks. You need to:
1. Set up localhost tunneling (ngrok, localtunnel, etc.)
2. Keep your tunneling service running
3. Constantly regenerate URLs
4. Debug blindly (can't see what data came in)

**There's a better way.**

## The Old Way vs. The New Way

### Before: ngrok + localhost
```bash
$ ngrok http 3000
Forwarding: https://abc123.ngrok.io -> localhost:3000

# Now configure webhook to: https://abc123.ngrok.io/webhook
# But ngrok expires, URLs change, setup is manual...
````

### After: Temporary webhook URLs

```
1. Click "Start Actor"
2. Get 3 unique URLs
3. Configure service to use them
4. See all requests instantly
```

## What I Built

I got frustrated enough to build [Webhook Debugger](https://apify.com/...),
a tool that generates temporary webhook URLs with automatic logging.

**Features**:

- 🚀 Generate URLs in 30 seconds
- 📝 Log every incoming request
- 👀 See full details (headers, body, IP, timing)
- 📥 Export to JSON/CSV
- ⏰ Auto-cleanup (24-72 hour expiry)

## How to Use

**Step 1: Run the Actor**

```json
{
  "urlCount": 3,
  "retentionHours": 24
}
```

**Step 2: Get Your URLs**

```
Webhook 1: https://api.apify.com/webhook/wh_abc123
Webhook 2: https://api.apify.com/webhook/wh_def456
Webhook 3: https://api.apify.com/webhook/wh_ghi789
```

**Step 3: Configure Your Service**
Point Stripe, GitHub, or any webhook provider to these URLs.

**Step 4: See Requests**
All incoming webhooks appear in your dataset with full details.

## Real-World Example: Testing Stripe Webhooks

```javascript
// Your endpoint is normally: http://localhost:3000/stripe-webhook

// But testing locally requires ngrok setup. Instead:

// 1. Use this Actor to get URL: https://api.apify.com/webhook/wh_stripe123
// 2. In Stripe dashboard, set webhook endpoint to that URL
// 3. Trigger test event in Stripe
// 4. See webhook in Actor dataset

// No localhost. No ngrok. No setup.
```

## Pricing

Pay only for what you use:

- **$0.01 per webhook request logged**
- Testing 100 webhooks = $1
- Testing 1,000 webhooks = $10

Compare to ngrok's $10/month just to get local URLs.

## Try It

[Webhook Debugger on Apify →](https://apify.com/...)

Takes 2 minutes to set up. No credit card required.

---

Have you struggled with webhook testing? What's your workflow? Let me know
in the comments!

````

---

# QUALITY OPTIMIZATION EXAMPLES

## Example 1: Before → After README (Quality Score Impact)

### ❌ BEFORE (Quality Score: 55)
```markdown
# Email Validator

Validates emails.

## How to use

Use the input schema to enter your emails. The output will show if they're valid.

## Input

```json
{"emails": ["test@example.com"]}
````

## Output

```json
{ "valid": true }
```

````

### ✅ AFTER (Quality Score: 78)
```markdown
# Email Validator & B2B Enricher

Validate email addresses and automatically enrich them with company data
(industry, size, employee count) in seconds.

**[Watch 2-min demo](https://youtube.com/...)**

## What does it do?

Validates email addresses and enriches them with company information using
public APIs (Hunter.io, Clearbit). Perfect for sales teams building targeted
prospect lists.

## Why use Email Validator & Enricher?

### The Problem
- ❌ Manual validation wastes hours
- ❌ No visibility into who you're targeting
- ❌ Competitors charge $0.10+ per email
- ❌ Need to manually research companies

### The Solution
````

1. Upload your email list
2. Actor validates + enriches automatically
3. Get company info, industry, employee count
4. Export clean list for outreach

````

**Results**:
- 30x faster than manual validation
- 70% cheaper than competitors
- 99% email accuracy
- Company data included

## What can this Actor do?

| Feature | Details |
|---------|---------|
| **Email Validation** | Format check, DNS verification, disposable detection |
| **Company Enrichment** | Industry, employee count, website, location |
| **Batch Processing** | Handle 500-10,000+ emails per run |
| **Risk Scoring** | Deliverability confidence (0-100) |
| **Export** | CSV, JSON, direct to Google Sheets |
| **API Keys** | Use your own Hunter.io/Clearbit keys |

## Input example

**Simple mode** (recommended for beginners)
```json
{
  "emails": ["john@techcompany.com", "sarah@startup.io"],
  "enrichment": "full",
  "removeInvalid": true
}
````

**Advanced mode** (for power users)

```json
{
  "emails": ["john@techcompany.com"],
  "enrichment": "full",
  "hunterApiKey": "your-api-key",
  "removeInvalid": true,
  "includeRiskFlags": true
}
```

## Output example

### JSON format

```json
{
  "email": "john@techcompany.com",
  "isValid": true,
  "domain": "techcompany.com",
  "company": "Tech Company Inc",
  "industry": "Software Development",
  "employees": "500-1000",
  "confidence": 98,
  "riskFlags": [],
  "deliverability": "high"
}
```

### CSV export

| Email                | Valid | Company          | Industry | Employees | Confidence |
| -------------------- | ----- | ---------------- | -------- | --------- | ---------- |
| john@techcompany.com | ✓     | Tech Company Inc | Software | 500-1000  | 98         |
| invalid@test.local   | ✗     | -                | -        | -         | -          |

## How to get started

**Step 1**: Prepare your email list (CSV or JSON)

- CSV format: Just one column with emails
- JSON format: `["email1@example.com", "email2@example.com"]`

**Step 2**: Input your emails in the Actor

```json
{
  "emails": ["email1@example.com", "email2@example.com"],
  "enrichment": "full"
}
```

**Step 3**: Click "Start" to run

**Step 4**: Wait 2-5 minutes (depending on email count)

**Step 5**: Download results as CSV or JSON

## Pricing

**Pay-per-event**: Only pay for emails you validate

- **$0.03 per email validated + enriched**
- Batch: 100 emails = $3
- Batch: 1,000 emails = $30

**Examples**:

- Weekly list validation: 500 emails × $0.03 = $15/week
- Monthly campaign: 10,000 emails × $0.03 = $300/month
- No setup fees, no minimum

**vs. Competitors**:

- ZeroBounce: $0.10/email + $99/month minimum
- Clearbit: $30/month + $0.50/record
- This Actor: **$0.03/email (70% cheaper!)**

## Advanced features & tips

### Batch processing (5,000+ emails)

Set `batchSize` to 100 for parallel processing. Reduces runtime 50-70%.

### Use your own API keys

Provide Hunter.io + Clearbit API keys for unlimited enrichment:

```json
{
  "apiKeys": {
    "hunterIo": "your-key",
    "clearbit": "your-key"
  }
}
```

### Caching strategy

Results are cached by domain. Validating multiple emails from same company
uses cache (faster + cheaper).

### Export to Google Sheets

Set `exportToSheets` with Sheet URL to auto-populate results:

```json
{
  "exportToSheets": "https://docs.google.com/spreadsheets/d/..."
}
```

### CI/CD Integration

Integrate with n8n or Zapier to auto-validate leads from your CRM.

## FAQ

**Q: How accurate is the validation?**
A: Email format validation (99.9% accurate). DNS verification (95%+
accurate). Most accurate results with SMTP verification.

**Q: Can I use this for email marketing?**
A: Yes! Validated emails improve deliverability. Results perfect for cold
outreach and marketing campaigns.

**Q: Do you store my data?**
A: No. Emails are processed and discarded. Only metadata stored in your
dataset. You own all your data.

**Q: How often should I re-validate?**
A: Every 6 months. Email addresses expire ~2% per month.

**Q: What's included in company enrichment?**
A: Company name, industry, employee count, website, location, LinkedIn URL,
founded year, tech stack (if available).

## Troubleshooting

**Issue**: "Invalid API key"  
**Solution**: Double-check your Hunter.io API key in input. Regenerate if
needed. Get free trial at https://hunter.io/

**Issue**: "Rate limit exceeded"  
**Solution**: Your API key hit hourly limits. Wait 1 hour or upgrade your
Hunter.io plan.

**Issue**: "Enrichment data not returned"  
**Solution**: Some companies may not have public data available. Partial
enrichment is still valuable (you get email validity + basic domain info).

## See also

- [Hunter.io Documentation](https://docs.hunter.io/)
- [Clearbit Documentation](https://clearbit.com/docs)
- [Email Validation Best Practices](https://docs.apify.com/...)
- [Lead Generation Guide](https://docs.apify.com/...)
- [Discord Community](https://discord.gg/...)

---

Questions? Drop a comment below or join our Discord community!

```

**Quality Score Jump**: 55 → 78 (+23 points!) = 41% improvement

---

## Why The Difference?

| Element | Before | After | Impact |
|---------|--------|-------|--------|
| Title | Generic | Keyword-optimized | +5 |
| Problem statement | Missing | Detailed | +8 |
| Use cases | None | 5+ mentioned | +7 |
| Examples | 1 simple | 3 complex | +8 |
| Pricing explained | No | Detailed + comparison | +10 |
| FAQ section | Missing | 5 Q&A | +6 |
| Video link | None | YouTube demo | +10 |
| Error handling | Not shown | Troubleshooting | +5 |
| SEO optimization | None | Keyword research | +4 |

**Total**: ~63 point improvement possible through README optimization alone!

---

## Your Action Items This Week

- [ ] Choose Actor #1 (Webhook Debugger recommended)
- [ ] Copy Webhook Debugger input/output schema templates above
- [ ] Use the README template as starting point
- [ ] Get Antigravity generating code (use prompt templates)
- [ ] Record 2-3 min demo video
- [ ] Draft first Reddit post (use marketing template)
- [ ] Start building!

**That's everything you need. Now execute.** 🚀

---

**Last Updated**: December 19, 2025 | **Status**: Ready to Use
```
