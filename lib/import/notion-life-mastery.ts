// One-off import of the Notion "Life Mastery Dashboard" (read 4 Oct 2026).
// Server-only: imported by app/api/import/notion/route.ts and nothing else, so this
// content never ships in browser code. After import the database is the source of truth.
//
// Left out on purpose (Nat's brief + my-spec.md: ordinary supplements only):
// the Injections & Peptides and PE Enhancement pages, every injection line, and every
// prescription-only or non-supplement drug. Tick boxes and scores are dropped (guides are
// reference, nothing to tick). Body format: see components/GuideBody.tsx.

export type ImportGuide = { key: string; title: string; icon: string; sort: number; body: string }
export type ImportBlock = { name: string; condition?: string; guide?: string; steps: string[] }
export type ImportRoutine = { key: string; name: string; sort: number; blocks: ImportBlock[] }

const K = {
  home: 'notion:38de16e53bb981549131c805060af1fb',
  daily: 'notion:38de16e53bb981528522fc4f915719b8',
  checklist: 'notion:38de16e53bb981efbe20cae4c5545950',
  skincare: 'notion:38de16e53bb981a9b77ce931f1b83b5d',
  nutrition: 'notion:38de16e53bb98163880fc2f55dfedafd',
  athletic: 'notion:38de16e53bb98178914ffc0ced3fe88c',
  gym: 'notion:38de16e53bb981fb9d51f4901f367040',
  supplements: 'notion:38de16e53bb981608749f729a7a34994',
  height: 'notion:38de16e53bb9811daff9d85fbe99c4c4',
  books: 'notion:38de16e53bb981ebaa7ae1725d180319',
  stock: 'notion:38de16e53bb981c292ebdbe0a68a1443',
  spiritual: 'notion:38de16e53bb9810f8244ed0a9ca44e77',
  goals: 'notion:38de16e53bb9817d8bf7ee84c4a08931',
  face: 'notion:38de16e53bb981b99617ef70b0d3f9d5',
  sleep: 'notion:38de16e53bb981809208c272111652eb',
  smell: 'notion:38de16e53bb98066ac93f1bf0468c609',
  fragrances: 'notion:38de16e53bb9802cb07ec9149cdf953f',
  party: 'notion:38de16e53bb9800e8e7fd80dd6249b28',
}

/** Pages not imported, shown on the preview so nothing is silently missing. */
export const SKIPPED_PAGES = ['Injections & Peptides', 'PE Enhancement']
export const LEFT_OUT_NOTE =
  'Injection lines and prescription-only drugs are left out of every guide and routine (ordinary supplements only). Tick boxes and scores are dropped.'

export const GUIDES: ImportGuide[] = [
  {
    key: K.home, title: 'Home', icon: '🏠', sort: 1, body: `
**Your complete system in one place.**

> Open [[Daily Routine]] first. That’s your whole day in one page.

## Your pages
### Daily use
| Page | What it’s for |
| [[Daily Routine]] | Your full day, morning to night |
| [[Daily Checklist]] | The full list of daily habits |
### Training
| Page | What it’s for |
| [[Gym Training]] | Upper template, form cues, progression rules |
| [[Athletic & Lower]] | McNally sessions, Owen sprints, weekly schedule |
| [[Nutrition]] | Pre-workout meal, protein target, daily eating |
### Body & health
| Page | What it’s for |
| [[Sleep]] | Sleep stack, wind-down protocol, habits |
| [[Supplements]] | AM stack + sleep stack with doses |
| [[Stock Tracker]] | 7-day reorder system, check every Sunday |
| [[Height & Posture]] | LSJL, decompression, fascia, posture sequence |
### Aesthetics
| Page | What it’s for |
| [[Skincare & Grooming]] | AM/PM protocols, makeup, hair |
| [[Face Aesthetics]] | What actually changes how your face looks |
### Mind & soul
| Page | What it’s for |
| [[Spiritual & Inner Life]] | Prayer, Bible, journal, philosophy, rules for life |
| [[Books]] | Reading list + Bible order |
### Tracking
| Page | What it’s for |
| [[Goals & Progress]] | Identity target, pillars; lifts, body, sprint, sleep tracking |

---
## Weekly structure
| Day | What you do |
| Mon | Lower body: foot/ankle prep (McNally) |
| **Tue** | **Upper gym** |
| Wed | Lower body: track plyo (McNally) |
| **Thu** | **Upper gym** + Lower body heavy |
| Fri | **Rest** |
| Sat | Owen: hard sprints |
| **Sun** | **Upper gym** + Lower body light |

> Thu heavy lower flagged: awaiting McNally schedule reply

---
## One rule
**Never skip two days in a row on anything. One miss is fine. Two misses is a new habit forming.**
` },
  {
    key: K.daily, title: 'Daily Routine', icon: '⚡', sort: 2, body: `
*Read through this. Live it. Not a checklist: a day.*

## Morning: 7:30 AM (~60 min)
**Wake**
No phone. Open curtains or step outside for 5–10 min of natural light. Drink 500ml water straight away.

**Prayer + Reading (~15 min)**: [[Spiritual & Inner Life]]
Short prayer: *“Guide me today. Help me become wiser, calmer, disciplined, honest, and closer to truth.”*
Then 10–15 min Bible or reading list. Read slowly. Highlight what hits you.

**Body Work (~20 min)**: [[Height & Posture]]
1. LSJL: jog in place 1 min + 10 shin taps → knees 12× → femur 8× → tibia 8× (5s ON/OFF each)
2. Decompression × 3 rounds: bed hang 2 min → pogo jumps 30s → diaphragmatic breathing 30s
3. Full Image Breathing, 4–6 cycles: hyperventilate 20–30s → hold exhale 40–60s → nasal recover 60–90s

**Shower + Skincare (~12 min)**: [[Skincare & Grooming]] · [[Smell & Clean]] · [[Fragrances]]

**Morning supplements + breakfast**: [[Supplements]]
Then have the build supplement with mushrooms.
Then have: MSM + HA + 500ml water + potassium.

---
## During the day
**Every 1–2 hours: 30 second posture reset**
Phone to eye level · nasal breathe · head over shoulders · ribs over pelvis

**Stomach vacuum**: 3–5 × 10–20s whenever you remember. Tightens waist.

**Food + water all day**
- 3–4L water sipped with electrolytes
- Protein at every meal: hit ~167g total
- Whole foods: meat, eggs, rice, fruit, veg
- Calcium once daily (milk, yogurt, cheese, sardines)
- Healthy fats at most meals

**Mental habits**
Observe: architecture, music, people, atmosphere, clothing. Ask *what world is this creating? what emotion is underneath this?*
Create more than you consume. Less scrolling.
Plan tomorrow’s 2–3 priorities before today ends.

---
## Training days: Tue / Thu / Sun
[[Nutrition]] · [[Gym Training]]

**45–60 min before**
Cream of rice 52g + honey + blueberries · collagen + vit C · caffeine

**Right before session**
3 breath resets: exhale ribs down → inhale into back ribs → stack tall

**Train**
Upper template ([[Gym Training]]) or McNally session ([[Athletic & Lower]]).
Log every set in Hevy: beat last week’s numbers.

**Within 1 hour after**
Protein + carb meal (chicken + rice / protein shake + fruit)

---
## Night: 9:45 PM
**9:45 PM**
Blue light blocking glasses on. Dim lights. No stress from here.

**10:00 PM**
Screens off. Phone away.

**Skincare (~10 min)**: [[Skincare & Grooming]]

**Body Work**: [[Height & Posture]]
*Minimum version (~20 min):* LSJL → decompression × 3 → image breathing → 90/90 hip lift + couch stretch + wall angels

**Spiritual (~30 min)**
Read 20 min (Bible / philosophy / poetry / film)
Journal 10–15 min, pick 2–3 prompts:
- What did I feel today?
- What am I chasing?
- What made me anxious?
- Where was my ego controlling me?
- What inspired me?
- What kind of man do I want to become?
- What went well? What did I struggle with?

Sit in silence 10 min: no phone, no music. Breathe, pray, reflect.

**Sleep Stack (10:20 PM)**: [[Sleep]]
Melatonin 5mg · glycine 3g · magnesium glycinate 400mg

**10:30 PM: Lights out**
Cool room (~18°C) · blackout · slow breathing · 9–10 hours

---
## Minimum effective day
*When life is busy, these never get skipped:*
| Block | Non-negotiable | Time |
| Morning | Prayer + LSJL + decompression + supplements | ~15 min |
| Day | Hit protein · drink water · posture resets | ongoing |
| Training | Show up, even a shorter session | — |
| Night | LSJL + decompression + image breathing + one journal sentence + sleep stack | ~25 min |

---
## The one rule
**Never skip two days in a row on anything.**
One miss is fine. Two misses is a new habit forming in the wrong direction.
` },
  {
    key: K.checklist, title: 'Daily Checklist', icon: '✅', sort: 3, body: `
*Reference list of the daily habits. Nothing to tick here.*

## Morning
| Habit | Detail |
| No phone | Don’t touch it yet |
| Morning light | 5–10 min outside |
| Water | 500ml immediately |
| Prayer | “Guide me today…” |
| Bible / reading | 10–15 min slow |
| LSJL | Warm-up → knees 12× → femur 8× → tibia 8× |
| Decompression × 3 | Bed hang 2 min → pogo 30s → breathing 30s |
| Full Image Breathing | 4–6 cycles |
| MSM + HA + potassium | 500ml water |
| Cleanse in shower | — |
| Ice roll | 1 min |
| Lymphatic drainage | 2 min |
| AM skincare | Azelaic → Vit C → Niacinamide/HA → Cicaplast → SPF |
| Lip balm | — |
| Makeup (if going out) | Brow pen → BB cream → contour → lashes |
| Hair | Scrunch → sea salt → diffuse → pomade |
| Vitamin D3 | With fat |
| Omega-3 | With meal |
| Creatine 5g | — |

## During the day
| Habit | Detail |
| Posture reset (every 1–2h) | Phone up · nasal breathe · head over shoulders |
| Stomach vacuum | 3–5 × 10–20s |
| Protein ~167g | Source at every meal |
| Water 3–4L | Sipped with electrolytes |
| Whole foods | Real food only |
| Calcium source | Milk / yogurt / cheese / sardines |
| Healthy fats | Eggs / olive oil / nuts / avocado |
| Observe | Architecture · music · people · atmosphere |
| Create > consume | Less scrolling |
| Plan tomorrow | 2–3 priorities written down |

## Training days: Tue / Thu / Sun only
| Habit | Detail |
| Pre-workout meal | Cream of rice + honey + fruit, 45–60 min before |
| Collagen + Vit C | 30–60 min before |
| Caffeine | 45 min before |
| Breath reset | 3 rounds before session |
| Train + log Hevy | Beat last week |
| Post-training meal | Protein + carbs within 1 hr |

## Night
| Habit | Detail |
| Blue light glasses | 9:45 PM |
| Dim lights | — |
| Screens off | 10:00 PM |
| Skincare protocol | Tret / Dermastamp / Recovery |
| Latisse on lashes | — |
| Minoxidil on brows | — |
| LSJL (minimum day) | Same as morning |
| Foam roller | Full sequence, skip if short |
| Ball release | Full sequence, skip if short |
| Posture work (minimum day) | 90/90 · couch stretch · SCM · thoracic · wall angels |
| Decompression × 3 (minimum day) | Bed hang · pogo · breathing · massage gun |
| Full Image Breathing (minimum day) | 4–6 cycles |
| MSM + HA + potassium | 500ml water |
| Read (minimum day) | 20 min |
| Journal (minimum day) | 10–15 min, 2–3 prompts |
| Silence (minimum day) | 10 min, no phone, no music |
| Melatonin 5mg | — |
| Glycine 3g | — |
| Magnesium 400mg | — |
| Lights out 10:30 | Cool · dark · slow breathing |

## Weekly reset (every Sunday)
- Recount all supplements ([[Stock Tracker]])
- Order anything under 7 days
- Review Hevy: beat last week?
- Check morning height gate (green / amber / red)
- Weekly journal: went well · struggled · next week priorities
` },
  {
    key: K.skincare, title: 'Skincare & Grooming', icon: '✨', sort: 4, body: `
- **Goal:** Golden olive bright glass skin + flat mole/jaw lightening + under-eye improvement + subtle canthal tilt lift.

---
- **Hydroquinone (HQ 2–4%):** lightens spots/moles/dark circles. Use spot/zone only. Risk: irritation, rebound pigmentation if SPF is poor, ochronosis with long-term use. **Cycle:** 8–12 weeks on, 4 weeks off.
- **Dermastamp (microneedling):** boosts absorption + collagen. **Skip strong actives around it** (see dermastamp rules below).

---
## Pre-routine (in shower)
1. Cleanse face with gentle cleanser, pat dry
2. Ice roll for 1 min after shower

## Hair
Scrunch dry → sea salt (5 sprays) → diffuse (circular) → clay/pomade through

## Goatee / shave lineup
1. **Rough shave:** electric shaver on sideburns + cheeks
2. **Close shave:** shaving cream + single-blade razor (sideburns + cheeks)
3. **Wash off** (warm water)
4. **Line-up:** shaving cream again + *small* single-blade razor (eyebrow-style) to line up **goatee + moustache**
5. **Scissors:** trim goatee + moustache with scissors
6. **Clean the lip line:** use scissors to remove hair off the lips
7. **Shape rule:** leave a small gap between the chin + goatee, about as wide as your mouth

*(Reference photo stays in Notion.)*

## AM skincare (~7 min)
| Step | Product | Note |
| 1 | Lymphatic drainage | 2 min: lotion chest/shoulders up neck, use fingers/gua sha, then serum: lymph nodes side of neck, SCM muscles, under cheekbones, temples, masseter, bring it all down. Then spread your palate for 20 secs, then pinch neck muscle |
| 2 | Gentle cleanser | Or water + massage if skin feels clean |
| 3 | Azelaic acid 20% | All over: brightens, evens olive tone, calms |
| 4 | Vitamin C serum | Optional, skip if rushed |
| 5 | Niacinamide + Multi-Peptide + HA | Layer for plumpness |
| 6 | Cicaplast B5 or Lipikar | Seal: ceramide moisturiser |
| 7 | SPF 50+ mineral | Every single day |
| 8 | Tinted Vaseline | On lips |

Eye tilt: 20–30 sec gentle upward gua sha/massage.

---
## Night: choose each night
| Night type | When |
| **Tret night** | Default, most nights |
| **Dermastamp** | Every 2–3 weeks |
| **Recovery** | 1–2×/week |

### Tret night: sandwich method
| Step | Product | Note |
| 1 | Gentle cleanser, pat dry | — |
| 2 | Thin Lipikar/Cicalfate buffer | Wait 1–2 min |
| 3 | Tazarotene pea-sized, whole face | Start every other day → build to daily |
| 4 | Wait 5 min | — |
| 5 | Hydroquinone 2–4% | Spot only: under eyes + flat moles |
| 6 | Estriol cream | All over, especially under eyes and eye lids |
| 7 | Multi-Peptide + HA + Niacinamide | Repair + plumpness |
| 8 | Lipikar + Aquaphor | Thick on lips + under-eye pads |
| 9 | Latisse on lashes | — |
| 10 | Minoxidil on brows | — |

### Dermastamp night (every 2–3 weeks)
1. Gentle cleanser, pat dry
2. Dermastamp 1mm: whole face except eyes, grid
3. Plain HA or Cicaplast B5 immediately
4. Multi-Peptide + HA
5. Lipikar + Aquaphor (lips + under eyes)
6. Latisse + Minoxidil

> Skip: tazarotene/tretinoin · hydroquinone · azelaic · BHA this night AND next 24–48h

### Recovery night (1–2×/week)
1. Gentle cleanser, pat dry
2. Liquid BHA 1–2%
3. Estriol cream
4. Multi-Peptide + HA + Niacinamide
5. Lipikar + Aquaphor (lips + under eyes)
6. Latisse + Minoxidil

> Skip: tretinoin + hydroquinone this night

---
## Tanning (golden olive): sun
- SPF 50+ daily regardless.
- Short “safe sun” sessions (10–20 min) early/late a few times/week.
- Avoid peak sun; reapply SPF.
- Pause/adjust HQ if uneven darkening occurs.

---
## Adjusted daily long-term plan (maintenance)
Aim: control allergies + baseline swelling with minimal effort.
- Hypertonic saline (Sterimar Hypertonic): twice a day, morning and night
- Intranasal corticosteroid spray (Pirinase): once daily (usually 1–2 sprays per nostril in the morning)

**Order**
1. Quick saline spray (if using)
2. Wait 1–2 minutes
3. Steroid spray

---
## Makeup routine
| Step | Product | How |
| 1 | Brow pen | Hair-like strokes, follow natural shape |
| 2 | BB cream / tinted SPF | Under eyes · cheekbone · ramus · jawline · chin |
| 3 | Contour | Suck in cheeks → shade hollow → blend toward ear |
| 4 | Eyelash curler | Opens the eye |

*Keep it light and blended. Should look like your face, not product.*

---
## Hair routine
| Step | Product | Detail |
| 1 | Scrunch dry | Microfibre towel: squeeze, don’t rub |
| 2 | Sea salt spray | 5 sprays, scrunch in |
| 3 | Diffuse | Circular motion · medium heat · low speed |
| 4 | Clay/pomade mix | Work through once mostly dry |

---
## Tret progression
Every other day → 3–4×/week → daily as tolerated.
Move from 0.05% to 0.1% only when skin shows zero reaction for several weeks.
` },
  {
    key: K.nutrition, title: 'Nutrition', icon: '🍽️', sort: 5, body: `
*No calorie counting. Track protein and the scale.*

## The 3 rules
1. **Protein: ~167g/day**: protein source at every meal, spread across 3–4 meals (~40g each). This is the one number to track.
2. **Calories: use the mirror and scale**: weight up ~0.25kg per 1–2 weeks = right. Getting softer → eat less. Stalling + weight dropping → eat more.
3. **Pre-workout carbs: 50–100g fast carbs** 45–60 min before training

---
## Pre-workout meal: cream of rice
1. Boil 200ml water
2. Add 52g cream of rice (1 scoop)
3. Wait 60 seconds
4. Stir · microwave 30s
5. Add: 2 crumbled rice crispies + blueberries + honey

Total: ~60–120g carbs. Fast-digesting, easy on stomach.

---
## All day
- 3–4L water sipped with electrolytes
- Protein at every single meal
- Carbs mostly around training
- Fat ~0.6–0.8g/kg (eggs, olive oil, nuts, avocado): important for hormones
- Calcium daily: milk, yogurt, cheese, or sardines
- Mostly whole foods: meat, eggs, fish, rice, fruit, veg

---
## Post-training
Protein + carb meal within 1 hour: chicken + rice / protein shake + fruit
` },
  {
    key: K.athletic, title: 'Athletic & Lower', icon: '🏃', sort: 6, body: `
Aerobic 4–6× a week.
*McNally (TrainHeroic) + Owen (Saturday sprints). Sessions change weekly. This is the current structure.*

---
## Weekly schedule
| Day | Session | Load |
| Mon | Foot & ankle prep | Low |
| **Tue** | Upper gym only | Med |
| Wed | Track plyo | High |
| **Thu** | Upper gym + heavy lower ⚠ | Med+High |
| Fri | **REST** | Low |
| Sat | Owen: hard sprints | High |
| **Sun** | Upper gym + light lower | Med |

---
## Pre-workout (45–75 min before training)
The pre-workout supplement + all of this ([[Supplements]]):
| Supplement | Dose | Notes |
| Caffeine | 3–6 mg/kg | — |
| Collagen Peptides | 10–15 g | Sprinting only |
| Alpha-GPC | 600 mg | — |
| Epicatechin | 150 mg | — |
| Carbs | High carb meal + gel | — |

## Post-workout
| Supplement | Dose | Notes |
| Creatine | 5 g | With shake |
| Protein | Part of 167 g daily | With shake |
` },
  {
    key: K.gym, title: 'Gym Training', icon: '🏋️', sort: 7, body: `
*Upper template: run Tue / Thu / Sun*

---
## The template
*Bench warm-up only: empty bar × 8 → 2–3 quick ramps to working weight. Nothing else needs a separate warm-up. Leave 1–2 reps in reserve on everything. Lat raises: push to failure.*
| # | Exercise | Sets × Reps | Rest | Note |
| 1 | Incline Press (Smith) | 2 × 5–8 | 3m | Lower/mid chest: warm up first |
| 2 | Pec dec | 2 × 6–10 | 2.5m | Upper chest |
| 3 | Lat Pulldown or pull ups | 2 × 6–10 | 2m | Lats fresh = more weight: V-taper |
| 4 | Wide-Grip or T-Bar Row | 2 × 8–12 | 2m | Back thickness |
| 5 | Single arm Close-Grip Row | 2 × 8–12 | 1m45 | Lats/mid-back |
| 6 | **Lateral Raise (Cable)** | **2 × 12–20** | 1m30 | **#1 width lever: push these** |
| 7 | Shoulder Press (optional) | 1 × 6–10 | 2m | Front delt fullness |
| 8 | Single-Arm Triceps Extension | 2 × 8–12 each | 1m30 | Full stretch overhead |
| 9 | Dips/pushdowns | 2 × 6–10 | 2m | Flip before ext if dips feel weak |
| 10 | — | — | 1m | Rear delt + posture |
| 11 | Preacher Curl | 2 × 8–12 | 1m30 | Biceps |
| 12 | Reverse Curl | 1 × 12–15 | 1m | Brachioradialis: forearm size |
| 13 | Wrist Flexion Cable | 1 × 12–15 | 45s | Forearm underside (optional) |

---
## Form cues
| Exercise | Key cue |
| Flat Press | Blades pinched and down · elbows 45° · bar to lower chest · control down, explode up |
| Incline Smith | 30° bench · elbows tucked 45° · don’t let shoulders shrug up |
| Pulldown / Pull-Up | Lead elbows down and in · feel lats not arms · full stretch at top · no big lean back |
| Rows | Chest tall · retract blades · pull to lower ribs · squeeze 1 sec · no momentum |
| Lateral Raise | Lead with elbows · pour-the-jug tilt · no swinging · control the lowering |
| Shoulder Press | Ribs down · press without shrugging · stop short of lockout |
| Triceps Extension | Elbow stays fixed · full overhead stretch · only forearm moves |
| Dips | Slight forward lean · controlled depth · no bouncing |
| Face Pull | Pull to eye level · externally rotate (knuckles back) · squeeze rear delts |
| Curls | No swinging · control the lowering · full stretch at bottom |

---
## Progression
- **How to progress:** add reps each session until you hit the top of the range on all sets → add the smallest weight jump → start again from the bottom of the range
- **Bench:** add 1.25–2.5kg most weeks while hitting reps (newbie phase lasts 3–6 months)
- **Golden rule:** only add weight when every set hits top of range with clean form
- **Effort:** 1–2 reps in reserve most sets · lat raises go to 0–1 RIR
- **Deload:** every 6–8 weeks, or if you stall 2 sessions in a row / sprint times dip → half volume for 1 week
- **Log everything in Hevy**: beating last week’s numbers is the whole program

---
## Abs: 2–3× per week
| Exercise | Sets | Note |
| Hanging Leg Raise | 2–3 × 8–15 | Core control for sprinting too |
| Cable Crunch | 2 × 10–15 | Moderate weight, don’t go heavy |
| Plank or Ab-Wheel | 2 × 30–45s | — |
| Stomach Vacuum | 3–5 × 10–20s hold | Anytime, even at a desk |

> Never do heavy loaded twists or side bends: they thicken the obliques and make your waist look wider.

---
## Weekly volume (template × 3 sessions)
| Muscle | Weekly sets | Note |
| Chest | ~12 | Flat + incline both heads covered |
| Side delts | 9 | Only 3-set lift: your #1 width lever |
| Back | ~18 | Highest: weak point + V-taper priority |
| Triceps | ~12 | Extension + dips |
| Biceps | ~6 | Rows/pulldowns add more on top |
| Forearm | 3–6 | Reverse curl + optional wrist |
| Rear delt | 6 | Face pull |
` },
  {
    key: K.supplements, title: 'Supplements', icon: '💊', sort: 8, body: `
*Ordinary supplements only. Stock and reorders: [[Stock Tracker]].*

## AM stack (daily base)
| Supplement | Dose | Notes |
| Epicatechin | 150 mg | — |
| NAC | 600 mg | — |
| TUDCA | 600 mg | — |
| EPA/DHA | 2–3 g | — |
| Vitamin D3 + K2 | 10,000 IU + 800 mcg | K2: 360 days |
| Omega-3 | Standard | — |
| Ecdysterone | 150 mg | — |
| Citrus bergamot | 600 mg | 120 days |
| NMN + quercetin + resveratrol | 500 mg + 250 mg + 250 mg | 30 days |
| Saffron | 88.5 mg | — |
| Calcium (MCHA + P) | 1 g | — |
| Boron | 6 mg | — |
| Multivitamin | 1 serving | — |
| Fish Oil | Standard | — |
| Astaxanthin | 18 mg | — |
| Beta Carotene | 25,000 IU | — |
| Royal Jelly | 1 g | — |
| MSM + HA + Glucosamine + Chondroitin | 5 g total | — |
| Pterostilbene | 250 mg | — |
| Piperine | 10 mg | — |
| Iron (ferrous sulfate) | 200 mg | — |

## Pre-workout (45–75 min before training)
| Supplement | Dose | Notes |
| Caffeine | 3–6 mg/kg | — |
| Collagen Peptides | 10–15 g | Sprinting only |
| Alpha-GPC | 600 mg | — |
| Epicatechin | 150 mg | — |
| Carbs | High carb meal + gel | — |

## Post-workout
| Supplement | Dose | Notes |
| Creatine | 5 g | With shake |
| Protein | Part of 167 g daily | With shake |

## PM / night stack (30–45 minutes before bed)
| Supplement | Dose | Notes |
| Glycine | 3 g | — |
| Magnesium | 420 mg | — |
| Melatonin | 3 mg | — |
| Niacin (flush) | 500 mg | 1 hour before bed |
| Collagen Peptides | 10 g + 1 g MSM + HA | Night recovery |
` },
  {
    key: K.height, title: 'Height & Posture', icon: '📏', sort: 9, body: `
*Recovers posture-lost height (0.5–2cm), decompresses spine, corrects rib flare, fixes forward head. LSJL = low-risk experimental. Everything else is well-evidenced.*

---
## Progress gates
Check your morning height vs evening: if dropping more than usual, back off.
| Gate | Drop | Action |
| 🟢 Green | ≤ 1.5cm · quiet landings · no pain | Progress load/time |
| 🟡 Amber | 1.5–2.5cm or mild stiffness | Hold loads |
| 🔴 Red | > 2.5cm · pain · shrugging | Deload 40% for 7–10 days |

---
## Morning routine (~20 min)
### LSJL
*Warm-up: 1 min jog in place + 10 shin taps (high / mid / low)*
| Area | Protocol |
| Knees | 5s ON / 5s OFF × 12 per knee |
| Femur | 5s ON / 5s OFF × 8 |
| Tibia | 5s ON / 5s OFF × 8 |

### Decompression cycle × 3 rounds
| Step | Duration |
| Bed hang | 2 min |
| Pogo jumps | 30 sec, light and bouncy |
| Diaphragmatic breathing | 30 sec: full exhale, belly breathe, nasal inhale |

### Full Image Breathing: 4–6 cycles (immediately after)
Each cycle:
1. 20–30s light hyperventilation: inhale nose, exhale mouth
2. Full exhale → hold 40–60s
3. Nasal recovery 60–90s

*Finish: MSM + HA + 500ml water + potassium*

---
## Night routine (~20 min minimum / 40 min full)
### LSJL: same as morning

### Foam roller (full version)
| Area | Time each |
| Soles of feet | 1 min |
| Calves | 1 min |
| Quads | 1 min |
| Hip flexors | 45s |
| Glutes | 1 min |
| Thoracic spine | 1–2 min |
| Lats | 1 min |
| Pecs | 45s |

### Ball release (full version)
| Area | Time each |
| Back of head (suboccipitals) | 1–2 min |
| Upper traps | 1 min |
| Levator scapulae | 1 min |
| Rear delts | 45s |
| Pec minor | 45s |
| Lats | 45s |
| Glute medius | 1 min |
| Soles of feet | 1 min |

### Posture sequence
| Exercise | Sets | Detail |
| Couch Stretch | 2 × 20–30s each | Hip flexor fix |
| SCM Stretch | 2 × 20–30s each side | Tilt head away + slightly up |
| 90/90 Hip Stretch | 2 × 30–45s each | — |
| Hamstring Stretch | 1–2 × each | — |

### Decompression cycle × 3 rounds
| Step | Duration |
| Bed hang | 2 min |
| Pogo jumps | 30 sec |
| Diaphragmatic breathing | 1 min |
| Massage gun (clavicle + head) | 3 min each side |

### Strengthening / activation
| Exercise | Sets | Detail |
| 90/90 Hip Lift + Chin Tuck ISO | 2–3 × 30 s | Do when doing diaphragm breathing. Full exhale · ribs down · chin back · neck pressed into floor |
| Chin Tuck Curls | 2 × 15 | Do when doing bed hangs |
| Thoracic Extensions | 2 × 8–10 | Over foam roller |
| Band Over-and-Backs | 2 × 10–15 | Shoulder mobility |
| Feet-Elevated Scap Push-Ups | 2–3 × 10–15 | Serratus |
| Wall Angels | 2 × 12 | — |
| Wall Angel ISO Hold | 1 × near failure | — |
| Prone Y-T-W Isometrics | 2 rounds | Y=30s · T=30s · W=30s |
| Z-Press Breath Hold | 2–3 sets | Exhale · sit tall · slow nasal inhale |

### Full Image Breathing: 4–6 cycles
*Finish: MSM + HA + 500ml water + potassium*

---
## During the day (every 1–2 hours)
- Phone to eye level
- Nasal breathe
- Head over shoulders · ribs over pelvis · relaxed breathing
- 2-min breath reset: exhale ribs down → inhale back ribs → stack

---
## Maintenance (every 14 days)
**Morning:** bar hang 2 × 1 min → bed hang 3 min
**Night:** bar hang 2–3 × 1 min → bed hang 5 min → 1–2 min diaphragmatic breathing
` },
  {
    key: K.books, title: 'Books', icon: '📚', sort: 10, body: `
*20 min/day minimum: night wind-down. One takeaway per chapter.*

---
## Reading list
| # | Book | Theme | Start when |
| 1 | Atomic Habits, James Clear | Habits/systems | First |
| 2 | Meditations, Marcus Aurelius | Stoicism | Anytime |
| 3 | Man’s Search for Meaning, Viktor Frankl | Purpose | Anytime |
| 4 | Why We Sleep, Matthew Walker | Recovery | Early |
| 5 | Can’t Hurt Me, David Goggins | Mental toughness | Anytime |
| 6 | The Myth of Sisyphus, Albert Camus | Absurdism | After Meditations |
| 7 | Deep Work, Cal Newport | Focus / craft | Anytime |
| 8 | Dopamine Nation, Anna Lembke | Asceticism | Anytime |
| 9 | The Sports Gene, David Epstein | Athletic development | Anytime |
| 10 | How to Win Friends & Influence People, Carnegie | Relationships | Anytime |
| 11 | The Brothers Karamazov, Dostoevsky | Faith / depth | Later |
| 12 | The Republic, Plato | Philosophy | Later |

---
## Bible reading order
Gospel of John → Proverbs → Psalms → Ecclesiastes
*Before each book: watch the BibleProject overview video on YouTube. Read slowly. Highlight lines that emotionally hit you.*

---
## Habits
- 20 min reading daily (night wind-down)
- One takeaway written per chapter
- Review notes when finished each book
` },
  {
    key: K.stock, title: 'Stock Tracker', icon: '📦', sort: 11, body: `
*Recount every Sunday. Reorder anything under 7 days (🔴). Order soon at 7–14 days (🟡). Days left = qty on hand ÷ daily use.*

*Ordinary supplements only. A proper stock tracker (days left, reorder date, links) is a later stage.*

---
## Tracker
| Item | Qty on hand | Daily use |
| Creatine | _ g | 5g |
| Protein | _ servings | _ |
| Vitamin D3 | _ caps | 1 |
| Omega-3 | _ caps | 1–2 |
| Collagen | _ g | 15g |
| Caffeine/pre-workout | _ servings | _ |
| Melatonin | _ tabs | 1 |
| Glycine | _ g | 3g |
| Magnesium glycinate | _ caps | _ |

---
## Sunday checklist
1. Count all items above
2. Flag anything 🔴 or 🟡
3. Order flagged items
4. Update quantities above
` },
  {
    key: K.spiritual, title: 'Spiritual & Inner Life', icon: '🕊️', sort: 12, body: `
## Morning (15 min)
1. No phone immediately
2. Prayer: *“Guide me today. Help me become wiser, calmer, disciplined, honest, and closer to truth.”*
3. Bible 10–15 min: slow, highlight what hits you

**Bible order:** Gospel of John → Proverbs → Psalms → Ecclesiastes
*Watch BibleProject overview video before starting each book*

---
## Night (30–45 min)
1. Read 20 min: Bible / philosophy / poetry / film analysis
2. Journal 10–15 min
3. Sit in silence 10 min: no phone, no music

**Journal prompts: pick 2–3 each night**
- What did I feel today?
- What am I chasing?
- What made me anxious?
- Where was my ego controlling me?
- What inspired me?
- What habits are hurting me?
- What kind of man do I want to become?
- What went well today? What did I struggle with?

---
## 8 areas to develop
| Area | What it means | How |
| Body | Sleep · recovery · posture · energy, not just aesthetics | Train, sleep, recover, move with quality |
| Mind | Attention · reasoning · memory · communication | Read hard things · reduce overstimulation |
| Craft | Something refined over years | Sprinting · music · writing: pick one, go deep |
| Relationships | Communication · empathy · leadership | Pay real attention to people |
| Taste | Recognising quality · atmosphere · detail | Study film, music, architecture, fashion |
| Emotional stability | Feel without being consumed · stay composed | Discipline · reflection · sleep |
| Financial competence | Saving · investing · value creation | Money = freedom, not flexing |
| Inner life | Relationship with yourself when no one’s watching | Journal · solitude · hard questions |

---
## Life philosophy
| Philosophy | One rule | Apply it |
| **Absurdism** (Camus) | Don’t wait, act anyway | Tired → train. Unsure → talk. |
| **Stoicism** (Epictetus) | Effort is yours, results aren’t | Train, not physique yet. Revise, not grade yet. |
| **Pragmatism** (W. James) | Results over theory | Progressive overload. Past papers. Experience. |
| **Aristotle** | Become genuinely good at things | Real strength · real confidence, not performed |
| **Asceticism** | Remove what weakens focus | Less scrolling → more drive and clarity |

---
## The laws
- **Law of Attraction**: energy and attention shape what comes toward you
- **Law of Abundance**: there is enough
- **Law of Equivalent Exchange**: you get what you give
- **Law of Cause & Effect**: every action has a consequence
- **Karmic cycle**: what you put out returns, amplified

---
## Daily operating principles
- Create more than you consume
- Plan tomorrow before today ends: 2–3 priorities only
- Protect mornings
- Do the boring stuff first
- Never skip two days in a row
- Be consistent to the point that consistency IS you

---
## Art & culture: how to engage with depth
Don’t consume art just for hype. Ask:
- What world is this creating?
- What emotion is underneath this?
- What imagery appears repeatedly?
- What is the atmosphere and why?

**Film directors to study:** David Lynch · Andrei Tarkovsky · Terrence Malick
*Let them affect you emotionally first. Don’t force understanding.*

---
## What to avoid
- Fake intellectualism · forcing “aura”
- Nihilism · superiority complexes
- Self-hatred · doom spiralling
- Expecting instant transformation

**Real depth comes from:** humility · sincerity · curiosity · emotional honesty, not performance.
` },
  {
    key: K.goals, title: 'Goals & Progress', icon: '🧭', sort: 13, body: `
**Identity target:** Fast, explosive, aesthetic athlete: wide shoulders, strong bench, V-taper, lean, composed.
| Pillar | Goal | Primary lever |
| Athleticism | Faster sprints, better football | Sprint quality, kept fresh, always |
| Strength | Very strong bench | 3 bench sessions/week |
| Aesthetics | Wide shoulders + V-taper | Side delts + lat width |
| Leanness | Hold 10–12% BF | Protein + eating whole foods |
| Recovery | Train hard AND recover | Sleep #1 |
| Mind | Discipline + focus | Reading + routine |
| Depth | Spiritual + emotional intelligence | Bible + journal + philosophy |

**The operating rule:** Sprint quality is the crown jewel. Nothing is allowed to dull it.

---
## Aesthetic priority map (highest visual return first)
1. **Side delts** → shoulder width (3 sets every session)
2. **Lat width** → V-taper (pulldown 3 sets every session)
3. **Upper chest** → shelf (incline every session)
4. **Stay lean 10–12%** → multiplies everything
5. **Posture** → free height + better jawline

---
## What to track
*The Notion log tables were empty templates; lifts live in Hevy, sleep/recovery in Whoop.*
- **Lifts:** bench top set · incline Smith · pulldown · lat raise
- **Body:** bodyweight · BF% est · waist · shoulder width · photo
- **Sprint / athletic:** session · metric · felt fresh?
- **Sleep:** avg hours · quality /10
- **Whoop (weekly):** RHR · HRV · recovery % · sleep score
- **Confidence:** /10 · what boosted it · what hurt it
- **Social:** # talked to · where · approaches · convos · numbers/IG · dates set
- **Optional:** steps/day · resting HR / morning readiness · protein/day

---
## Adjustment rules
- Sprint times stalling → cut gym volume / add rest before anything else
- Sleep averaging < 7h → fix sleep before touching the program
- Deload every 6–8 weeks (~40% volume, 1 week)
- One change at a time: observe 2 weeks before changing again
` },
  {
    key: K.face, title: 'Face Aesthetics', icon: '😎', sort: 14, body: `
*What genuinely changes how your face looks, ranked by impact.*

---
## The levers (highest impact first)
| Lever | What to do | Reality |
| **Leanness** | Hold 10–12% body fat | #1 driver of jaw and cheekbone definition: nothing beats this |
| **Posture** | Fix forward head ([[Height & Posture]]) | Forward head ruins jawline visually. Fix posture = free face upgrade |
| **Reduce puffiness** | Sleep 9–10h · hydrate · less salt and alcohol | Less water retention = sharper features |
| **Grooming** | Haircut that frames face · brow pen · beard line | Biggest instant return |
| **Skin** | See [[Skincare & Grooming]] | Clear skin reads as a good face |
| **Nasal breathing** | Breathe through nose · tongue on palate | Harmless habit, better breathing |
| **Masseter** | Hard gum / mastic gum occasionally | Mild, very low risk: don’t overdo, jaw pain is real |

---
## Daily face habits
- Nasal breathe all day
- Tongue on palate (mewing posture)
- Head up, chin slightly back, not forward
- Stay hydrated: 3–4L
` },
  {
    key: K.sleep, title: 'Sleep', icon: '😴', sort: 15, body: `
*The highest-ROI section in the whole system. Everything (speed, strength, leanness, mood, height) runs through sleep.*

**Target: 9–10 hours. Fixed schedule. Weekend max 1 hour later than weekday.**
**Wake: 7:30 AM (8:00 AM weekends max) · Bed: 10:30 PM**

---
## Sleep stack (take at 10:20 PM)
| Supplement | Dose | Notes |
| Melatonin | 5mg | Try 0.5–1mg: often as effective |
| Glycine | 3g | Lowers core temp → deeper sleep |
| Magnesium glycinate | 400mg | Muscle recovery + sleep quality |

---
## Wind-down protocol
| Time | Action |
| 9:45 PM | Blue light glasses on |
| 9:45 PM | Dim lights · no stress · no intense training |
| 10:00 PM | Screens off · phone away |
| 10:05 PM | 10 min slow breathing / NSDR / box breathing |
| 10:15 PM | Into bed: read or journal |
| 10:20 PM | Take sleep stack |
| 10:30 PM | Lights out: slow breathing to sleep |

---
## Non-negotiable habits
| Habit | Detail |
| Fixed schedule | Same time daily: anchors everything |
| Weekend rule | Max 1 hr later: 2–3 AM kills HRV |
| Morning light | 5–10 min outdoor light immediately on waking |
| Cool dark room | ~18°C · blackout curtains |
| Caffeine cutoff | None within 8–10 h of bed |
| Last big meal | 2–3 h before bed |
| Hydration | 3–4L water/day |
` },
  {
    key: K.smell, title: 'Smell & Clean', icon: '🚿', sort: 16, body: `
## Shower routine
### 1. Hair (first)
- Wet hair thoroughly.
- Shampoo and massage scalp well.
- Condition (if using), then rinse thoroughly.

> **Why first:** keeps hair fresh and prevents body products from getting into your hair.

---
### 2. Body cleanse (daily)
**Step 1: Deep clean**
- Dettol Anti-Bacterial Bar Soap
- African Net Sponge

Scrub thoroughly: neck, chest, back, torso, arms, legs, outer groin & thighs. Rinse completely.

**Step 2: Scent layer**
- Method Simply Nourish Body Wash (Vanilla Coconut Shea Butter)

Using the African net sponge, focus on neck, chest, arms, legs. Leave on for **30–60 seconds** before rinsing for better fragrance.

---
### 3. Exfoliation (2–3× per week)
**Skip on other days.** Use Vanilla Sugar Scrub on damp skin: neck, chest, arms, legs, back.
Avoid: face, genitals. Massage gently in circular motions. Rinse thoroughly.

> On non-scrub days, the African net sponge provides enough daily exfoliation.

---
### 4. Genital cleaning (external only)
Daily: warm water. If needed: a tiny amount of Dove Sensitive Unscented Soap.
Clean gently: shaft, head, scrotum.
If uncircumcised:
1. Pull back foreskin gently.
2. Rinse underneath.
3. Return foreskin.

No harsh scrubbing. Always rinse thoroughly.

> Do this **after** washing the rest of your body.

---
## Finish shower
- Pat body dry with a clean towel.
- Leave skin slightly damp for moisturiser.
- Dry genitals completely to prevent moisture-related odour.

---
## Post-shower routine (within 5–10 minutes)
### 1. Moisturise
EOS Vanilla Lotion, generously on neck, chest, arms, legs. Use lightly (or skip) on genitals if sensitive.

### 2. Lock in moisture
Vanilla Vaseline Body Oil, layered over the lotion: neck, back of neck, chest, arms, wrists.

### 3. Deodorant
Vanilla/Coconut Deodorant on underarms only. Allow to dry.

### 4. Freshness powder (optional)
Talc-free body powder, lightly on scrotum, groin, inner thighs, base of penis area. Shake off excess.

### 5. Fragrance
[[Fragrances]]
Spray on pulse points:
- Back of neck
- Sides of neck
- Chest (2 sprays)
- Inner wrists

**Optional:** dab a tiny amount of Vaseline Body Oil onto pulse points before spraying for longer-lasting fragrance.
` },
  {
    key: K.fragrances, title: 'Fragrances', icon: '🧴', sort: 17, body: `
## 🎒 School
- Louis Vuitton Imagination ⭐
- YSL Y EDP
- Maahir Legacy
- Hawas

## ☀️ Summer
- Louis Vuitton Imagination ⭐
- Hawas
- Maahir Legacy
- YSL Y EDP

## ❄️ Winter
- Stronger With You Intensely ⭐
- Bianco Latte
- Khamrah Qahwa
- Afnan 9PM
- Hugo Boss The Scent

## 🎉 Parties / clubs
- Stronger With You Intensely ⭐
- Afnan 9PM
- Club de Nuit
- Dior Sauvage
- Hawas

## ❤️ First date
- Louis Vuitton Imagination ⭐
- Ani X
- Hugo Boss The Scent
- YSL Y EDP

## 🛋️ Her house / movie night
- Ani X ⭐
- Bianco Latte ⭐
- Stronger With You Intensely
- Hugo Boss The Scent
- Khamrah Qahwa

## 🏋️ Gym / football
- Hawas
- Louis Vuitton Imagination
- Maahir Legacy

---
## 🛒 Next buys
### Highest priority
1. Ani X *(if not owned)*
2. Side Effect
3. Bal d'Afrique Absolu
4. Liquid Brun Extrait
5. Kismet Angel

### Wishlist
- Love & Crime
- Ingenious Ginger
- Amouage Reflection
- Paris Corner Rifaaqat
- Wavechild 1015
- Pink Boa
- Sospiro Vibrato
- City Rhythm
- Bond No. 9
- Beach Afternoon
- Riffs Preva Platinum
- City of Miami
- Trouble in Paris
- Guerlain Spiritueuse Double Vanille
- Prisma Amethyst
` },
  {
    key: K.party, title: 'Pre-Party & Debloating', icon: '🎉', sort: 18, body: `
## Daily debloating / water management
- Aim for **2.5–3.5 litres** total fluids per day.
- Morning: 500–700 ml upon waking.
- Sip evenly throughout the day (pale yellow urine is ideal).
- MSM + Glucosamine fine in morning.

## Party day
**Water strategy**
- Normal intake until 2–3 hours before party → then sip lightly (100–200 ml if thirsty).
- Do **not** drink a big glass right before leaving.

**1–2 hours before the event**
- One use of **Otrivine** (decongestant nasal spray): max 1–2 times that day.
` },
]

export const ROUTINES: ImportRoutine[] = [
  {
    key: 'notion:3c9e16e53bb98090b3b6d96a17fae0df', name: 'Morning', sort: 1, blocks: [
      { name: 'Decompression cycle', guide: K.height, steps: [
        '2 rounds. Each round:',
        'Bed hang: 2 min',
        'Pogo jumps: 30 sec, light and bouncy',
        'Diaphragmatic breathing: 30–60 sec (full exhale, belly + lower ribs, nasal inhale, relax shoulders)',
        'Takes 6–8 min',
      ] },
      { name: 'Shower', guide: K.smell, steps: [
        'Cleanse face in the shower',
        'Finish cold',
        'Pat face dry',
        'Ice roll 1 min',
        'No second cleanse later',
        'Takes 8–10 min',
      ] },
      { name: 'Shave', condition: 'Shave days only', guide: K.skincare, steps: [
        'After shower, before teeth and skincare',
        'Rough shave: electric on sideburns + cheeks',
        'Close shave: cream + single-blade razor',
        'Wash off',
        'Line-up goatee + moustache with small razor',
        'Scissors on goatee + moustache',
        'Clean hair off the lips',
        'Leave a small gap between chin and goatee, about as wide as your mouth',
        'Takes 8–10 min',
      ] },
      { name: 'Brush teeth', steps: ['Before nasal and skincare', 'Takes 2–3 min'] },
      { name: 'Nasal + lymph + skincare', guide: K.skincare, steps: [
        'Nasal: Sterimar hypertonic',
        'Wait 1–2 min (use the wait to put lotion on chest / shoulders / neck)',
        'Pirinase 1–2 sprays per nostril',
        'Hydrocortisone on nose only on days you need to look good → wash off after 30 sec',
        'Massage: light circles on masseters + temporalis',
        'Lymph: chest/shoulders → neck → SCM → under cheekbones → temples → masseter → pull down',
        'Palms on face 20 sec',
        'Light neck pinch',
        'Keep lotion off the face',
        'Azelaic acid 20% all over → wait 1–2 min',
        'Vitamin C serum → wait 1 min',
        'Niacinamide + Multi-Peptide + HA → wait 30–60 sec',
        'Cicaplast B5 or Lipikar',
        'SPF 50+ mineral',
        'Tinted Vaseline on lips',
        'Takes 12–14 min',
      ] },
      { name: 'Hair', guide: K.skincare, steps: [
        'Scrunch dry: squeeze, don’t rub',
        'Sea salt: 5 sprays, scrunch in',
        'Diffuse: circular, medium heat, low speed',
        'Clay / pomade once mostly dry',
        'Takes 8–10 min',
      ] },
      { name: 'Hard chewing session 1', guide: K.face, steps: [
        'Do this while you chill',
        '10 min chewing: 1 min chew → 45 sec rest → repeat until 10 min',
        'Pre-molar focus, mouth open as much as possible',
        'Then 2 min masseter + temporalis massage',
        'Takes 12 min',
      ] },
      { name: 'Eat, supplements, dress, bag', guide: K.supplements, steps: [
        'Breakfast',
        'Saffron 88.5 mg',
        'D3 5,000 IU',
        'K2 MK-7 400 mcg',
        'Fish oil 2 g',
        'Astaxanthin 12 mg',
        'Quercetin 500 mg',
        'Resveratrol 1,000 mg',
        'Piperine 10 mg',
        'NACET 250 mg',
        'NMN 1,000 mg',
        'Boron 6 mg',
        'Forskolin 100 mg (only one forskolin dose)',
        'Multivitamin',
        'Dress, bag',
        'Takes 20–25 min',
      ] },
      { name: 'Leave for school', steps: [] },
    ],
  },
  {
    key: 'notion:3c4e16e53bb9804aa9c6dec3f024c107', name: 'Night', sort: 2, blocks: [
      { name: 'Wind-down start', guide: K.sleep, steps: [
        'Blue light blocking glasses on',
        'Dim lights',
        'No extra stress from here',
        'Screens off',
        'Phone away',
        'Takes 5 min',
      ] },
      { name: 'Gentle face work', guide: K.face, steps: [
        'Light circles on masseters + temporalis',
        'Takes 5 min',
      ] },
      { name: 'Hard chewing session 2', guide: K.face, steps: [
        '10 min chewing: 1 min chew → 45 sec rest → repeat until 10 min',
        'Pre-molar focus, mouth open as much as possible',
        'Then 2–3 min vigorous massage on masseters + temporalis',
        'Takes 13 min',
      ] },
      { name: 'Face wind-down', guide: K.face, steps: [
        'Orbital training: 10 sec upward eye pull + resisted squint',
        'Resistance side-to-side jaw: fists against the sides of the chin, slow left-right pushes, 10 each side',
        'Resisted jaw open: fists under the chin, open downward against the fists, 10 reps × 2',
        '30 sec light lymphatic downward strokes from face to neck',
        'Takes 4 min',
      ] },
      { name: 'Body work: release', guide: K.height, steps: [
        'Body work order: Release → LSJL → Decompression/jumps → Reset → Reinforce (40–50 min in all)',
        'Tuck the ribcage. Exhale all air. Hold that empty position for air hunger. Do not panic. After each hold, breathe only through the nose.',
        'Release comes before any jumps: 10–12 min',
        'Foam roller: soles of feet 45–60s each',
        'Foam roller: calves 45–60s each',
        'Foam roller: quads 45–60s each',
        'Foam roller: hip flexors 45s each',
        'Foam roller: glutes 45–60s each',
        'Foam roller: thoracic spine 1–2 min',
        'Foam roller: pecs 45s each',
        'Ball: back of head (suboccipitals) 1 min',
        'Ball: upper traps 45s each',
        'Ball: levator scapulae 45s each',
      ] },
      { name: 'LSJL', guide: K.height, steps: [
        'Order: warm-up → knees → femur → tibia. Loads are always 5s ON / 5s OFF.',
        'Warm-up: 1 min running in place',
        'Warm-up: 10 light shin taps (high, middle, low)',
        'Knees: 5s ON / 5s OFF × 12 per knee',
        'Femur: 5s ON / 5s OFF × 8',
        'Tibia: 5s ON / 5s OFF × 8',
      ] },
      { name: 'Decompression cycle', guide: K.height, steps: [
        '3 rounds (10–12 min):',
        'Bed hang: 2 min',
        'Pogo jumps: 30 sec',
        'Diaphragmatic breathing: 1 min, nose only',
        'After the third pogo, no more jumping',
      ] },
      { name: 'Reset stretches', guide: K.height, steps: [
        'Couch stretch: 20–30s each side',
        '90/90 hip stretch: 30s each side',
        'Hamstring stretch: 1 set each side',
        'Takes 6–8 min',
      ] },
      { name: 'Reinforce: posture circuit', guide: K.height, steps: [
        'Diaphragmatic 90/90 breathing, 4 reps: on your back, hips and knees at 90°, heels elevated, tailbone 1 inch off the floor, hands reach as far as possible, whole back on the floor. Inhale through the nose into the sides and low back, exhale until all air is gone, hold that empty rib-tucked state 5 sec.',
        'Isometric chin tuck, same 90/90, hold 30s: chin straight back into the throat at ~60% effort, back of the neck into the floor. Air hunger the whole 30s if possible.',
        'Deep neck curls, 15 reps or 30s iso: chin tucked, lift the head only 1 inch. 15 reps with a 3-sec hold, or a 30-sec hold to failure. Don’t let the big side-neck muscles pop out.',
        'Scapula remapping + scapula push-up, 10–15 reps: arms locked straight, only the shoulder blades move (pinch together, then push the floor away). Fixes winging and rounding.',
        'Y-T-W raises, 30s each, face down: Y palms down, T palms down, W palms pointing in. Squeeze mid-back, not upper traps.',
        'Full-contact wall angels, 10 slow reps: whole back, head and elbows on the wall, ribs tucked, chin retracted. Air hunger if possible.',
        'Wall angel isometric: 1 hold near failure, strict form and air hunger',
        'Z-press breath hold, 2–3 sets of 15s: strong L-sit, legs straight, arms in a Y (don’t shrug). Exhale all air, tuck ribs, hold empty for 15s with maximal chin tuck. Then nasal breathe.',
        'Takes 15–20 min',
      ] },
      { name: 'Sleep stack', guide: K.supplements, steps: [
        'Take it here so it kicks in at lights out',
        'Melatonin 100 mg + glycine 3 g',
        'Magnesium glycinate 400 mg',
      ] },
      { name: 'Spiritual', guide: K.spiritual, steps: [
        'Read 15–20 min (Bible / philosophy / poetry / film)',
        'Journal 8–10 min: pick 2–3 prompts',
        'What did I feel today? · What am I chasing? · What made me anxious? · Where was my ego controlling me? · What inspired me? · What kind of man do I want to become? · What went well? What did I struggle with?',
        'Silence is not deleted: do it during the skincare waits below',
      ] },
      { name: 'Night skincare', guide: K.skincare, steps: [
        'Choose the night type: Tazarotene (default, most nights) · Dermastamp (every 2–3 weeks) · Recovery (1–2× a week)',
        'While each layer waits, sit still: no phone, no music. Breathe, pray, reflect.',
        'Night nasal if using: Sterimar hypertonic once',
        'Takes 10–12 min',
      ] },
      { name: 'Tazarotene night (sandwich)', condition: 'Most nights', guide: K.skincare, steps: [
        'Gentle cleanser → pat fully dry',
        'Thin Lipikar / Cicalfate buffer → wait 1–2 min',
        'Pea-size tazarotene over face, avoid eyes/lips → wait 2–5 min',
        'Hydroquinone spot only on under-eyes + flat moles → wait 1–2 min',
        'Estriol cream, especially under eyes and lids → wait ~1 min',
        'Multi-Peptide + HA + niacinamide → wait 30–60 sec',
        'Lipikar + Aquaphor on lips and under-eye pads',
        'Latisse on upper lash line only',
        'Minoxidil on brows',
      ] },
      { name: 'Dermastamp night', condition: 'Every 2–3 weeks', guide: K.skincare, steps: [
        'Gentle cleanser → pat dry',
        'Dermastamp 1 mm: whole face except eyes, grid',
        'Plain HA or Cicaplast B5 immediately',
        'Multi-Peptide + HA',
        'Lipikar + Aquaphor on lips + under eyes',
        'Latisse + Minoxidil',
        'Skip this night and the next 24–48 h: tazarotene, hydroquinone, azelaic, BHA',
      ] },
      { name: 'Recovery night', condition: '1–2× a week', guide: K.skincare, steps: [
        'Gentle cleanser → pat dry',
        'Liquid BHA 1–2%',
        'Estriol cream',
        'Multi-Peptide + HA + niacinamide',
        'Lipikar + Aquaphor on lips + under eyes',
        'Latisse + Minoxidil',
        'Skip this night: tazarotene + hydroquinone',
      ] },
      { name: 'Lights out', guide: K.sleep, steps: [
        'Cool room (~18°C)',
        'Blackout',
        'Slow breathing',
        'Strong full-tongue mewing',
        'Aim 9–10 hours',
      ] },
      { name: 'Notes', steps: [
        'No Theragun for now',
        'No tone taping',
        'No maxilla pulling',
        'No zygo pushing',
        'Do not take the sleep stack at the start of the night',
      ] },
    ],
  },
]
