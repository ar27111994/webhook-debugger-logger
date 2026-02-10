# Apify $1M Challenge: Quick Reference Cheat Sheet

## One-Page Reference for Solo Developers (43 Days Remaining)

---

## CHALLENGE ESSENTIALS (NON-NEGOTIABLE)

### ✅ MUST DO

- **Pay-per-Event (PPE)** pricing ONLY (Rental/PPR = ineligible)
- **Actor Quality Score** ≥ 65 (aim for 75+)
- Input schema + Output schema required
- Comprehensive README with examples
- Published AFTER Nov 3, 2025
- Only 5 Actors count toward prize pool

### ❌ AUTOMATIC DISQUALIFICATION

- Raw scrapers of: YouTube, LinkedIn, Instagram, Facebook, TikTok, X, Apollo, Amazon, Google Maps/Search/Trends
- Metrics gaming or fraud
- Spamming communities
- Duplicating old code
- Third-party license violations

### 💰 REWARD STRUCTURE

- **Per Actor**: $2 × MAU (max $2,000 at 1,000 MAU)
- **Weekly Spotlight**: $2,000 (9 weeks remaining)
- **Grand Prizes**: $30K, $20K, $10K
- **Minimum Threshold**: 50 MAU to qualify

---

## THE 5 ACTORS TO BUILD (PRIORITY ORDER)

| #   | Actor            | Days | Target MAU | Revenue | Status           |
| --- | ---------------- | ---- | ---------- | ------- | ---------------- |
| 1   | Webhook Debugger | 3-4  | 250+       | $500+   | 🔴 LAUNCH FIRST  |
| 2   | Email Validator  | 4-5  | 300+       | $600+   | 🔴 LAUNCH SECOND |
| 3   | Social Scheduler | 5-6  | 400+       | $800+   | 🟠 Week 2        |
| 4   | Price Monitor    | 5-6  | 500+       | $1000+  | 🟠 Week 2-3      |
| 5   | API Rate Limiter | 4-5  | 150+       | $300+   | 🟠 Week 3+       |

**Total Expected**: 1,600+ MAU = $1,200-$1,600 challenge bonus

---

## WEEKLY TIMELINE (STARTING TODAY)

### Week 1: LAUNCH PHASE

```
Mon-Wed: Build Webhook Debugger MVP
Thu: Publish Actor #1
Fri-Sun: Build Email Validator + Start Marketing
```

**Goal**: 50-75 MAU, 70+ quality, organic buzz

### Week 2: MOMENTUM PHASE

```
Mon: Publish Actor #2 (Email Validator)
Tue-Wed: Build Actor #3 (Social Scheduler)
Thu: Publish Actor #3
Fri-Sun: Optimize + Start Marketing Push
```

**Goal**: 150-200 MAU, 75+ quality, revenue flowing

### Week 3: SCALE PHASE

```
Mon-Wed: Build Actor #4 (Price Monitor)
Thu: Publish Actor #4
Fri-Sun: Heavy marketing + bug fixes
```

**Goal**: 400-600 MAU, $300-500+ revenue

### Week 4+: MAXIMIZE PHASE

```
Build/Launch Actor #5, optimize for revenue, maintain MAU
```

**Goal**: 1,000+ MAU by Jan 31

---

## QUALITY SCORE FORMULA (75+ TARGET)

**5 Scoring Dimensions**:

- 📊 **Reliability** (25%): Error rate <2%, success >98%
- 📝 **Documentation** (25%): README with 5+ examples + video
- 👥 **Ease of Use** (20%): Good input schema, clear errors
- ⭐ **User Adoption** (20%): 50+ MAU, 4.5+ stars rating
- 🔧 **Maintenance** (10%): Regular updates, Limited permissions

**Quick Wins**:

1. Add demo video (huge boost)
2. Write comprehensive README
3. Fix all bugs immediately
4. Respond to user comments within 24hrs
5. Optimize error messages

---

## README STRUCTURE (COPY-PASTE FORMAT)

```
## What does [Actor] do?
[1-2 sentences + keyword]

## Why use [Actor]?
[Problem statement + 3 benefits]

## What can it do?
[Features table]

## Input example
[JSON + screenshot]

## Output example
[JSON + CSV table]

## How to get started
[5 steps with screenshots]

## Pricing
[$X per event + examples]

## Advanced features
[3-5 features for power users]

## FAQ & Troubleshooting
[5+ Q&A pairs]

## See also
[Related Actors]
```

**Quality Multiplier**: Add 2-3 min demo video = +10 quality score

---

## PRICING PSYCHOLOGY FRAMEWORK

### Charm Pricing (5-15% conversion boost)

- ❌ $0.10 per event
- ✅ $0.099 per event

### By Actor Type

| Type            | Low Volume  | Medium     | High Volume |
| --------------- | ----------- | ---------- | ----------- |
| Data Processing | $0.01-0.02  | $0.03-0.05 | $0.05-0.10  |
| API Wrappers    | $0.005-0.01 | $0.01-0.02 | $0.02-0.05  |
| AI Tools        | $0.50-1.00  | $1.00-2.00 | $2.00-5.00  |

### Revenue Examples

- **Email Validator**: 300 MAU × 100 emails × $0.03 = $900/month
- **Social Scheduler**: 400 MAU × 2 posts × 30 × $0.07 = $1,680/month
- **Webhook Debugger**: 250 MAU × 50 events × $0.01 = $125/month
- **Price Monitor**: 500 MAU × 20 products × $0.015 = $150/month

---

## MARKETING CHANNELS (ANONYMOUS, NO INTERACTION)

### Reddit (Highest ROI)

- r/webdev, r/programming, r/SideHustle
- Format: "Spent 3 hours on [problem], built this tool"
- Expected: 50-200 upvotes = 20-50 new users per post

### Stack Overflow (Authority + SEO)

- Find [problem] questions in your niche
- Answer + include link naturally
- Expected: 5-50 views/upvotes = 2-10 conversions

### Dev.to / Hashnode (Content)

- Write "How to [solve] without expensive tools"
- Gets organic traffic for months
- Expected: 500-2000 views = 20-50 users

### Twitter/X (Community)

- Daily: Share demo, answer questions, engage
- Weekly: Thread about your problem/solution
- Expected: 5-50 clicks/week per consistent posting

**Golden Rule**: Add value FIRST, mention tool SECOND

---

## ANTIGRAVITY PROMPT TEMPLATE (READY TO USE)

```
You're building an Apify Actor called "[Name]".

OBJECTIVE:
[2 sentences on what it does]

REQUIREMENTS:

1. INPUT SCHEMA:
   [List all input fields]

2. FUNCTIONALITY:
   [Step-by-step what Actor does]

3. OUTPUT:
   [Output format + example]

4. ERROR HANDLING:
   [Common errors + responses]

TECH STACK:
[Languages, libraries, frameworks]

QUALITY TARGET:
[75+ score with why]

BUILD APPROACH:
Phase 1: [Core functionality]
Phase 2: [Enhancements]
Phase 3: [Polish]

Make it production-ready, not skeleton code.
```

---

## QUALITY OPTIMIZATION CHECKLIST (PRE-LAUNCH)

### Schema ✅

- [ ] Input schema: All fields documented
- [ ] Input schema: Good defaults provided
- [ ] Output schema: All fields clear
- [ ] Output schema: Sample values shown

### README ✅

- [ ] "What does it do?" (1-2 sentences)
- [ ] "Why use it?" (problem + benefits)
- [ ] Features table
- [ ] Input example (JSON + screenshot)
- [ ] Output example (JSON + CSV)
- [ ] "How to get started" (5 steps)
- [ ] Pricing explained
- [ ] FAQ (5+ Q&A)
- [ ] Video link (HUGE)
- [ ] 5+ links (internal + external)

### Code Quality ✅

- [ ] Try-catch blocks (all errors handled)
- [ ] Helpful error messages (not cryptic)
- [ ] Performance: <5 min for typical use
- [ ] Memory optimized (tested with large data)
- [ ] Edge cases tested (empty input, max size)

### Support ✅

- [ ] Plan to respond within 24 hours
- [ ] Monitor dashboard daily
- [ ] Fix bugs immediately
- [ ] Track user feedback for README updates

---

## WEEKLY PROGRESS TRACKING

```
WEEK [#]:
Actor 1: [Name] | MAU: [X] | Quality: [X] | Rating: [X]/5
Actor 2: [Name] | MAU: [X] | Quality: [X] | Rating: [X]/5
[...]

MARKETING:
Reddit posts: [X] (upvotes: [X], clicks: [X])
SO answers: [X] (upvotes: [X], clicks: [X])
Dev.to articles: [X] (views: [X], clicks: [X])

COMBINED METRICS:
Total MAU: [X]
Total Revenue: $[X]
Challenge Bonus Progress: [X]%

TOP PRIORITY NEXT:
- [ ] Action 1
- [ ] Action 2
- [ ] Action 3
```

---

## MILESTONES & DEADLINES

| Milestone          | Target Date | Goal                       |
| ------------------ | ----------- | -------------------------- |
| 2 Actors Published | Dec 22      | 50-75 MAU, 70+ quality     |
| 4 Actors Published | Dec 31      | 300+ MAU, 75+ quality      |
| 5 Actors Published | Jan 15      | 800+ MAU                   |
| Final Push         | Jan 31      | 1,000+ MAU = $1,000+ bonus |

---

## DO'S & DON'T'S (CRITICAL)

### ✅ DO

- Start immediately (43 days = short window)
- Focus on QUALITY not QUANTITY
- Market organically (genuine, not spammy)
- Respond fast (24-hour response = quality factor)
- Use PPE pricing (required for eligibility)
- Test thoroughly before publishing
- Iterate based on feedback

### ❌ DON'T

- Overengineer MVP (ship fast)
- Build 10 Actors (5 great > 10 mediocre)
- Spam communities (auto-disqualification)
- Ignore quality score (<65 = ineligible)
- Use Rental/PPR pricing (wrong model)
- Copy competitor code
- Ignore user feedback

---

## SUCCESS METRICS (TRACK WEEKLY)

| Metric          | Target        | Red Flag               |
| --------------- | ------------- | ---------------------- |
| MAU (per Actor) | 50+ by Week 4 | <30 by Week 4          |
| Quality Score   | 75+           | <65 = ineligible       |
| User Rating     | 4.5+ stars    | <3.5 = major problem   |
| Error Rate      | <2%           | >5% = optimize         |
| Response Time   | <30 sec       | >2 min = slow          |
| Churn Rate      | <10%/month    | >20% = retention issue |

---

## BONUS: ANTIGRAVITY WORKFLOW

1. **Planning Phase**: Let Agent create task breakdown
2. **Code Generation**: Generate production-ready code
3. **Enhancement**: Add features (TTL, filtering, etc.)
4. **Quality Optimization**: README + error handling
5. **Testing**: Unit tests + edge cases
6. **Publish**: Deploy to Apify Store
7. **Monitor**: Watch quality score + user feedback
8. **Iterate**: Fix bugs + respond to comments

---

## FINAL CHECKLIST (BEFORE LAUNCHING EACH ACTOR)

- [ ] Quality score ≥ 70 (aim for 75)
- [ ] README complete with video link
- [ ] Input/output schemas documented
- [ ] Error handling comprehensive
- [ ] 3+ input/output examples included
- [ ] Pricing clearly explained (PPE)
- [ ] Tested thoroughly (0 bugs)
- [ ] Demo recorded (2-3 min)
- [ ] First Reddit post drafted
- [ ] Stack Overflow answers prepared

---

## YOU'VE GOT THIS! 🚀

**43 days. 5 Actors. $1,000+ bonus potential.**

Pick Actor #1 (Webhook Debugger), fire up Antigravity, and build.

The only thing between you and passive income is execution.

**Start today. 💪**

---

**Last Updated**: December 19, 2025 | **Status**: Ready to Execute
