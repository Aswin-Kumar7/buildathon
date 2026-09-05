# Decisions

Why Sentinel is shaped the way it is. Two of these were reversals, and they are written up as
reversals rather than tidied into hindsight. What broke on the way there is in the
[engineering log](ENGINEERING_LOG.md); this file is only the reasoning.

| #   | Decision                                                                                          |
| :-- | :------------------------------------------------------------------------------------------------ |
| 1   | [Not training on real card data](#1--not-training-on-real-card-data)                               |
| 2   | [Gradient-boosted trees, after starting linear](#2--gradient-boosted-trees-after-starting-linear)  |
| 3   | [The model recommends; it never acts](#3--the-model-recommends-it-never-acts)                      |
| 4   | [Watching the actor, not the payment](#4--watching-the-actor-not-the-payment)                      |
| 5   | [Explanations compete instead of points adding up](#5--explanations-compete-instead-of-points-adding-up) |
| 6   | ["Could not tell" is its own answer](#6--could-not-tell-is-its-own-answer)                         |
| 7   | [Containment expires on its own](#7--containment-expires-on-its-own)                               |
| 8   | [The database is optional](#8--the-database-is-optional)                                           |
| 9   | [Trained in Python, served as arrays](#9--trained-in-python-served-as-arrays)                      |
| 10  | [CI regenerates every published number](#10--ci-regenerates-every-published-number)                |
| 11  | [Defence only, by construction](#11--defence-only-by-construction)                                 |
| 12  | [Two lint rules off for the console](#12--two-lint-rules-off-for-the-console)                      |

---

## 1 · Not training on real card data

**The model trains on a synthetic scenario corpus, and says so on its own page.**

It did not start there. The first model in this repository trained on IEEE-CIS: 590,540 real card
transactions across 265,864 cards, with labels this project did not author. It was a reasonable
model.

- Held-out PR-AUC **0.363**, against a logistic baseline's 0.072
- False-decline rate **0.85%** at the cost-optimal threshold

We retired it anyway, because it could not be given the inputs the product actually has. Sentinel
scores an actor on ten numbers, and six of them cannot be built from that table at all:

- **Failure rate, approval rate, infrastructure share, recovery rate.** All four need to know _why_
  an attempt failed, and there is no decline column. Every row is a payment that went through.
- **Top session failure share, failing sessions.** Both need a session id, and there is no such
  column either.

Nothing else in the table can stand in for them, because most of what remains is anonymised: `V1`
through `V339` have no published meaning.

The label is the deeper mismatch. `isFraud` means a chargeback was filed, usually weeks later. Card
testing is a burst of declines that never become payments, so on the merchant being tested it mostly
produces nothing to charge back. The dataset records the payments that succeeded. The rows we need
are the ones that failed.

Keeping it would have meant a real-data number on the front page, earned by a model answering a
different question from the one served. So the model was retrained on the scenario corpus, where
every input it reads at request time genuinely exists, and the model page states plainly that the
labels are synthetic and where real ones will come from.

Two things from that work stayed:

- **The grouped split**, which is where we found out what a careless one costs
- **`scripts/check-data-size.mjs`**, which still refuses to let the restricted data be committed

## 2 · Gradient-boosted trees, after starting linear

**A temperature-scaled logistic regression was served first. It lost a measurement and was
replaced.**

Linear was not a default. It ran in the request path as ten multiplications, and its per-feature
contributions were exact, so the "why was this flagged" panel could read a coefficient rather than
estimate anything. PR-AUC 0.940.

When a tree ensemble came up, we argued against trying it: the learning curve had already flattened,
so more model was not going to help.

That argument was wrong, and wrong in a way worth recording. A flat learning curve says more _data_
will not help. It says nothing about more _capacity_. We had answered a question nobody asked and
used it to close the one we had.

So we measured instead. Same grouped split, same cost model, same threshold sweep. The cost column is
what the errors at each model's own operating point would come to, priced by the cost model in
`config.py`.

|                                 | PR-AUC | Cost of the mistakes |
| :------------------------------ | -----: | -------------------: |
| Gradient-boosted trees (served) |  0.991 |              ₹61,200 |
| Random forest                   |  0.988 |              ₹67,000 |
| Logistic regression             |  0.940 |             ₹124,000 |

Not close. The ensemble won on all five re-splits, worst case still ahead by 0.046, and it roughly
halved the cost of being wrong.

There are two alternatives on that ladder rather than one, deliberately. A linear model cannot
represent an interaction at all; a random forest averages independent trees instead of correcting
them in sequence. Beating both by similar margins says the gain belongs to the model class and not to
one library's settings.

The trade was explicit:

- **Given up.** Exact coefficients, which were the linear model's whole argument.
- **Bought back.** Attribution by measurement: hold one feature at its training median, score the row
  again, report the difference.

The ensemble only shipped because that second thing worked. If we could not still answer "why was
this flagged", 0.991 would not have been worth having.

The ladder keeps running on every build. One that only ever confirms the incumbent is a ladder nobody
needed to build, and the result worth having is the one where the simpler model turns out to be
enough.

## 3 · The model recommends; it never acts

**No model score contains anyone.** The most it can do is put a case in front of a person, and if the
rules have positively named a benign cause, it cannot even do that.

This is not caution for its own sake, and we have the number for it:

- **The model alone** flags 39 of 1,045 benign entities. Nearly all are billers retrying their own
  failed charges, which looks exactly like card testing from the outside.
- **The full pipeline** judges 1,105 entities and contains no benign one, because arbitration
  recognises those retries and refuses to let the score escalate.

That gap is the entire argument for the leash, which is why the model's own false-positive rate is
published next to the flattering number rather than instead of it.

## 4 · Watching the actor, not the payment

**Every attempt is judged three times over: as part of a session, a device, and a `/24` network
block.**

A payment webhook carries an order, an amount and a status. It does not carry a session, a device or
a network. One attacker spread across thirty sessions arrives as thirty unrelated events, and no
single payment ever looks wrong on its own.

The subnet, rather than the full IP, is what makes a shared proxy pool visible at all. We learned
that the hard way.

The cost we accepted is that one attacker can raise more than one incident. That reads as duplication
until you try to act on it, because containing a session and containing a subnet have very different
blast radii, and merging them would force an operator to take the bigger one to get the smaller.

## 5 · Explanations compete instead of points adding up

**Five explanations argue over the same evidence, and three of them argue against acting.**

The easy version is a scorecard: each rule adds points, a threshold decides. It scores about as well
and it cannot be argued with.

The real driver was outages. Telling an outage from an attack is not a matter of being more confident
about a number. The system has to be able to _say_ "this is an outage" and act on having said it.

That is why a `gateway_outage` run, which produces more traffic than any attack scenario in the
corpus, is correctly left alone on all 177 of its entities.

## 6 · "Could not tell" is its own answer

**Abstention is recorded as abstention, never as a zero.**

- `card_spread` stays silent until the distinct-card count is confirmed
- `machine_cadence` stays silent on two attempts, because the gap between two arrivals is not a
  rhythm

Recorded as a quiet zero, missing evidence reads as evidence of innocence, and it reads that way
against a shopper. So abstention shows in the console, it widens the interval around the score, and
the policy engine refuses to contain when arbitration abstained.

## 7 · Containment expires on its own

**A block is temporary by construction:**

- 30 minutes by default
- 2 hours maximum
- 2 extensions maximum
- Lifts immediately when someone releases it

A review queue assumes somebody comes back to it. An expiry assumes nobody does. That second
assumption is what makes it reasonable to act on a signal that is already half an hour old.

## 8 · The database is optional

**With no `DATABASE_URL` set, the API runs Postgres compiled to WebAssembly, in-process.** So
`pnpm dev` needs no database, no Docker and no cloud account, and the end-to-end suite uses the same
path, which means what CI exercises is what a reviewer runs.

The trade-off is real: a second process cannot share it. The deployed setup uses a real server, and
the integration suite runs against its own.

## 9 · Trained in Python, served as arrays

**The model ships as plain number arrays that the API walks directly in TypeScript.** No Python at
runtime, no ONNX, no native dependency to install.

That only works if the two sides agree, so the suite reimplements the walk from scratch and asserts
the two land within 1e-8 on the same input. Calling the model to check the model would prove nothing.

## 10 · CI regenerates every published number

Three gates, each of which fails the build:

- **`check:metrics`** re-runs the evaluation and fails if a published figure moved
- **`check:payload`** greps the built output for card-, email- and phone-shaped strings
- **`assert nothing changed`** fails if any earlier gate modified a tracked file, because a build
  that quietly fixes the tree means the committed state and the verified state were never the same
  thing

So the numbers in the README and in [PROOF](PROOF.md) cannot drift from the artifacts without CI
noticing. Anything hand-typed elsewhere still can, which is why those documents link to the generated
files instead of copying them.

## 11 · Defence only, by construction

**Nothing here can generate, replay or initiate a payment.** The simulator streams recorded attack
shapes through the real pipeline with no real card numbers, tagged `replay` from end to end.

We did that structurally rather than by policy: there is no outbound HTTP client in the corpus or the
replay path at all. A rule saying "do not do X" is worth whatever the next review is worth. A missing
capability holds on its own.

## 12 · Two lint rules off for the console

**`max-lines-per-function` and `complexity` are scoped off for the console's `.tsx` files only**,
with the reasoning written into `eslint.config.mjs`. Pointed at the console's components they
produced 58 violations.

Both rules measure how much logic a function carries, and in a component that returns JSX every line
of markup counts toward the length while every conditional render counts as a branch. Splitting a
view to satisfy a line count buys indirection, not clarity. They stay in force for every `.ts` file
in the repository, including all of the console's own hooks and API clients.

It is not a pass for genuine complexity. `SimulationPanel` sits at 46 and is recorded in
[PROOF](PROOF.md) as outstanding rather than hidden behind this.
