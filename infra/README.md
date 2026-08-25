# Deploying to Cloud Run

Project `project-4613cb69-f64b-4160-bc3`, region `asia-south1` (Mumbai). Razorpay is
India-based and we have five seconds to acknowledge a webhook whose timing we do not
control, so the region is not arbitrary.

**Everything runs from GitHub Actions.** The project belongs to somebody else, so there is
no Cloud console to click and nothing is installed locally. A service-account key lives in a
GitHub secret and the workflows do the work from a runner — including the one-time setup
that would normally be a terminal session.

Two services, deliberately.

| Service | Contains | Why separate |
|---|---|---|
| `sentinel-api` | The API and the console's built assets | Same origin as the session cookie it issues, so the authenticated path needs no CORS |
| `sentinel-shop` | The demo storefront | A public, anonymous, untrusted page has no business sharing an origin with an authenticated session — on one origin, a compromised shop page could read the console's CSRF token and act as the analyst |

The shop learns the API's address from `API_BASE_URL` at start-up rather than having it
compiled in, which is what lets each service build from the repository without knowing about
the other.

## The workflows

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/gcp-setup.yml` | Manual, `provision` | Enables the APIs, creates the Artifact Registry repository |
| `.github/workflows/deploy.yml` | Push to `main` | Builds both images, deploys whichever changed |
| `.github/workflows/gcp-setup.yml` | Manual, `configure` | Sets environment variables on both services and points them at each other |

Configuration is deliberately not in `deploy.yml`. A push to `main` changes which image runs
and nothing else, so it can never quietly alter how production is configured.

`deploy.yml` calls `verify.yml` first and every build job waits on it, so lint, typecheck,
the unit suite, the format check, the payload-leak guard and gitleaks all have to pass
before an image is built. `fast.yml` calls the same file for pull requests — one definition,
because a gate that is duplicated is a gate that drifts, and the half that drifts is the one
guarding production.

---

## 1. Repository secrets

<https://github.com/Aswin-Kumar7/buildathon/settings/secrets/actions>

Nine values. **New repository secret**, one at a time.

| Name | Value |
|---|---|
| `GCP_SA_KEY` | The entire service-account JSON file, opened in a text editor and pasted whole — including the outer braces |
| `GCP_PROJECT_ID` | `project-4613cb69-f64b-4160-bc3` |
| `GCP_SA_EMAIL` | The `client_email` from that JSON |
| `APP_DATABASE_URL` | `DATABASE_URL` from `.env` |
| `APP_PSEUDONYM_KEY` | `PSEUDONYM_KEY_V1` from `.env` |
| `APP_PAYLOAD_KEY` | `PAYLOAD_KEY_V1` from `.env` |
| `APP_RAZORPAY_KEY_ID` | `RAZORPAY_KEY_ID` from `.env` |
| `APP_RAZORPAY_KEY_SECRET` | `RAZORPAY_KEY_SECRET` from `.env` |
| `APP_RAZORPAY_WEBHOOK_SECRET` | `RAZORPAY_WEBHOOK_SECRET` from `.env` |

GitHub masks these in workflow logs, so a value that reaches a log line prints as `***`.
That masking is best-effort on exact matches and will not catch a value that gets
transformed or split, which is why the configure step writes them to a file rather than a
command line.

## 2. Link billing to the project

Having a billing account is not the same as the project using it. A project with no billing
account attached refuses image pushes with

```
denied: This API method requires billing to be enabled
```

which says nothing about billing being unlinked, and sends you looking at permissions.

<https://console.cloud.google.com/billing/linkedaccount?project=project-4613cb69-f64b-4160-bc3>

**Link a billing account** → pick the account → Set account. Or, from a terminal with
`roles/billing.user` on the account:

```bash
gcloud billing projects link project-4613cb69-f64b-4160-bc3 --billing-account=BILLING_ACCOUNT_ID
```

Confirm it took:

```bash
gcloud billing projects describe project-4613cb69-f64b-4160-bc3
```

`billingEnabled: true` is the answer you want.

**Then wait two or three minutes before the next step.** Billing takes time to propagate,
and until it has, commands fail with `BILLING_DISABLED` on a project that already reports
`billingEnabled: true`. The fix is to run the same command again.

A free-trial account is fine for all of this — Cloud Run and Artifact Registry both work on
trial credits. What is not fine is a trial that has **ended**: the console shows a banner
about upgrading to prevent service disruption, and until the account is upgraded to paid
(which still spends the remaining credits) nothing will deploy.

## 3. Bootstrap — the project owner runs this once

The deploy account cannot enable APIs or create repositories, and should not be able to:
those need project-admin rights, and a key that lives in a GitHub secret has no business
holding them. So this part is a human action, once, in the owner's Cloud Shell.

<https://shell.cloud.google.com/?project=project-4613cb69-f64b-4160-bc3>

```bash
export PROJECT=project-4613cb69-f64b-4160-bc3
export SA=aswin-647@project-4613cb69-f64b-4160-bc3.iam.gserviceaccount.com
```

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project=$PROJECT
```

```bash
gcloud artifacts repositories create sentinel --repository-format=docker --location=asia-south1 --project=$PROJECT
```

Artifact Registry is where the container image lives. Cloud Run does not build or store
anything — it runs an image that must already exist somewhere it can pull from, and every
route to Cloud Run puts one there. `gcloud run deploy --source` creates a repository called
`cloud-run-source-deploy` and uses that instead. Naming it ourselves is what lets the
cleanup policy above cap it at ten images; the automatic one grows forever.

```bash
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=$role --condition=None; done
```

Three roles, and no more:

- `roles/run.admin` — create and update services, and make them publicly reachable
- `roles/artifactregistry.writer` — push images, not administer the repository
- `roles/iam.serviceAccountUser` — deploying a Cloud Run service means acting as its runtime
  service account. This one looks redundant and is not; without it the deploy fails with a
  permission error that names neither account clearly

Then, from GitHub: Actions → **GCP setup** → **Run workflow** → step `provision`.

It tries the same three things and does not mind failing at them — what it reports on is the
end state. Green means the repository exists and Cloud Run is reachable with these
credentials, whoever created them. Red prints the commands above into the job summary.

## 4. Deploy

Push to `main`, or Actions → **Deploy** → **Run workflow**.

Builds both images and creates both services. **The API will not be healthy yet** — it has
no database, and it refuses to start without one in production rather than falling back to
the embedded database that loses every row on restart. Expected here, and fixed by the next
step.

## 5. Configure

Actions → **GCP setup** → **Run workflow** → step `configure`.

Sets the environment on `sentinel-api`, makes both services publicly reachable, points the
shop at the API and adds the shop's origin to the API's CORS list. Both URLs are printed in
the run summary.

The settings that are not cosmetic:

- **`TRUST_PROXY=true`** — Cloud Run terminates TLS and forwards the client address in
  `X-Forwarded-For`. Without it every request appears to come from Google's frontend, the IP
  pseudonym collapses to one constant value, and the detector's per-network velocity signal
  silently dies. Safe only *because* this really is behind a proxy we control; it must stay
  `false` anywhere else.
- **`--no-cpu-throttling`** — Cloud Run allocates CPU only while a request is in flight by
  default. The inbox drain is a `setInterval`, so without this it runs when traffic happens
  to arrive and stalls when it does not.
- **`--min-instances=1`** — the same reason, plus no cold start on the webhook path, where
  the budget is five seconds.
- **`--max-instances=1`** — the drain polls the inbox from inside this process, so two
  instances would poll the same rows. Nothing corrupts (deduplication is a database
  constraint and the canonical insert is idempotent), but they would duplicate work and
  inflate the attempt counter, dead-lettering a row before its three attempts are up.
- **`SEED_DEMO_USERS=true`** — creates the accounts whose password is published, so a judge
  can sign in. Deliberate and visible here rather than defaulted somewhere in the code.

## 6. Point Razorpay at it

Webhook URL: `<API URL>/api/webhooks/razorpay`, with the same secret that went into
`APP_RAZORPAY_WEBHOOK_SECRET`. Active events: `payment.failed`, `payment.authorized`,
`payment.captured`, `order.paid`.

The console's **System health** page should report "configured", and the counts should move
on the first real delivery.

---

## After this, a push deploys

`deploy.yml` watches `main` and builds only what changed — a documentation commit rebuilds
nothing.

<https://github.com/Aswin-Kumar7/buildathon/actions>

**A push updates the services; it never creates a second one.** `gcloud run deploy` is
keyed on the service name and region, both constants here, so an existing service is updated
in place: same name, same URL, a new revision that takes all the traffic. A service is only
created when none of that name exists in that region, which happens exactly once.

What *does* accumulate is revisions and images, and that is the point of them:

| | Accumulates | Costs | Why keep them |
|---|---|---|---|
| Cloud Run revisions | yes | nothing while they hold no traffic | each one is a rollback target |
| Artifact Registry images | yes | storage | the image a revision points at |

Revisions with no traffic run no instances and are free. Images are capped at the ten most
recent by the cleanup policy that `provision` sets.

Roll back by shifting traffic to an earlier revision, which needs no rebuild:

```bash
gcloud run revisions list --service=sentinel-api --region=asia-south1
gcloud run services update-traffic sentinel-api --region=asia-south1 --to-revisions=REVISION_NAME=100
```

Re-run `configure` whenever a configuration value changes.

## About the service-account key

A key is a long-lived credential: it does not expire, anyone who can read the repository
secret can deploy with it, and in a project we do not own it cannot be audited from our
side.

**Workload Identity Federation is the better arrangement** — GitHub proves which repository
is asking and Google mints a short-lived token from that claim, so no key exists anywhere.
It needs one setup from someone with IAM admin on the project:

```bash
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github-provider --location=global --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" --attribute-condition="assertion.repository_owner=='Aswin-Kumar7'"
gcloud iam service-accounts add-iam-policy-binding SA_EMAIL --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/Aswin-Kumar7/buildathon"
```

The `--attribute-condition` is the part that matters: without it, *any* GitHub repository in
the world can request a token from that pool.

Then in both workflows replace

```yaml
credentials_json: ${{ secrets.GCP_SA_KEY }}
```

with

```yaml
workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
service_account: ${{ secrets.GCP_SA_EMAIL }}
```

add `id-token: write` to `permissions`, and delete both the `GCP_SA_KEY` secret and the key
itself. Nothing else changes.

Until then: **delete the downloaded JSON file once the secret is saved.** A key sitting in a
Downloads folder is a key that gets committed, screenshotted or pasted eventually.
`.gitignore` now refuses `*-key.json`, `*service-account*.json` and `project-*-*.json` as a
backstop, but the file has no reason to exist locally at all.

## Building by hand

`infra/cloudbuild.api.yaml` and `infra/cloudbuild.storefront.yaml` do the same build and
deploy from Cloud Build instead of GitHub — for shipping something not committed yet, or
when the workflow itself is what is broken. They need `cloudbuild.builds.editor` and the
Cloud Build API enabled.

## Cost

Three different things get called "free", and only the first one applies here.

| | What it is | Covers this deployment? |
|---|---|---|
| Free **trial** credits | $300, 90 days, drawn down first | Yes — this is what pays for it |
| Always Free **tier** | A permanent monthly allowance per service | Barely. 180,000 vCPU-seconds a month is about 50 hours; an always-on instance uses roughly 730 |
| Free | Nothing here | — |

The shape that costs money is `--min-instances=1 --no-cpu-throttling`: one instance running
24/7 with CPU allocated the whole time, which is the opposite of what Cloud Run is cheap at.
At list prices for 1 vCPU and 1 GiB that is roughly **$45–55 a month** after the free-tier
allowance — call it a third of the trial credits over the 90 days. Check the real number in
the billing console rather than trusting this paragraph.

The storefront scales to zero and costs approximately nothing.

**Planned run is two months**, which comes to roughly $90–110 and fits inside the 90-day
trial. That is the reason the always-on instance stays: the alternative — a Cloud Scheduler
job calling a drain endpoint, allowing `--min-instances=0` — would save money we already
have, cost an hour, and add a cold start to the one path with a hard five-second deadline.
The architecture plan names that trade as "always-on instance versus trigger plus scheduled
sweep"; it is the right change for a longer-lived deployment and the wrong one for this.

Set a budget alert anyway, at something like $150 so it fires well before the credits do:

<https://console.cloud.google.com/billing/budgets>

## Stopping it

When the two months are up, scaling to zero ends the charge without deleting anything —
URLs, revisions and images all survive, and a later `--min-instances=1` brings it back:

```bash
gcloud run services update sentinel-api --region=asia-south1 --min-instances=0 --cpu-throttling
```

To remove it entirely:

```bash
gcloud run services delete sentinel-api --region=asia-south1
gcloud run services delete sentinel-shop --region=asia-south1
```

Worth doing deliberately rather than relying on the credits running out. A trial that
expires with services still running is how a personal card gets charged, if the account has
been upgraded by then.

## What this does not do yet

- No custom domain, so the URLs are the generated `run.app` ones.
- Billing must be enabled on the project. Artifact Registry refuses a push without it, with
  an error about an API method rather than about billing being off, and only the project
  owner can turn it on.
- The drain runs inside the API process, which is why `--max-instances=1` is set. Lifting it
  means claiming rows with `FOR UPDATE SKIP LOCKED`, or moving the drain to its own
  single-instance service and letting the API scale freely — the shape the architecture plan
  assumes.
