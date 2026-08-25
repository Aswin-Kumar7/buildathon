# Deploying to Azure Container Apps

Subscription: Azure for Students. Resource group `sentinel`, region `centralindia` —
Razorpay is India-based and we have five seconds to acknowledge a webhook whose timing we do
not control, so the region is not arbitrary.

**Everything runs from GitHub Actions.** Nothing is installed locally; the one-time bootstrap
happens in [Azure Cloud Shell](https://shell.azure.com), and the rest is workflows.

Authentication is **OpenID Connect**. GitHub presents a signed claim naming this repository
and branch, Azure trusts it directly, and no long-lived credential exists. An earlier attempt
on Google Cloud used a service-account key, which went through a chat transcript and a
Downloads folder before it was ever used — this arrangement has nothing to leak.

Two services, deliberately.

| Service | Contains | Why separate |
|---|---|---|
| `sentinel-api` | The API and the console's built assets | Same origin as the session cookie it issues, so the authenticated path needs no CORS |
| `sentinel-shop` | The demo storefront | A public, anonymous, untrusted page has no business sharing an origin with an authenticated session — on one origin, a compromised shop page could read the console's CSRF token and act as the analyst |

The shop learns the API's address from `API_BASE_URL` at start-up rather than having it
compiled in, which is what lets each image be built without knowing about the other service.

## The workflows

| File | Trigger | Does |
|---|---|---|
| `verify.yml` | called by the two below | lint, typecheck, unit tests, format, payload-leak guard, gitleaks |
| `fast.yml` | push and pull request | calls `verify` |
| `deploy.yml` | push to `main` | verifies, then builds and rolls out whichever service changed |
| `azure-setup.yml` | manual, `provision` | creates the environment and both apps |
| `azure-setup.yml` | manual, `configure` | sets environment variables and links the services |

Configuration is deliberately not in `deploy.yml`. A push changes which image runs and
nothing else, so it can never quietly alter how production is configured. And every deploy
job waits on `verify` — the two once fired independently on a push, so a commit could reach
production while its own tests were failing beside it.

---

## 1. Bootstrap, once, in Cloud Shell

<https://shell.azure.com> — the commands below are PowerShell, which is Cloud Shell's
default. Type `bash` first if you would rather use Bash.

```bash
$RG              = "sentinel"
$LOCATION        = "centralindia"
$SUBSCRIPTION_ID = az account show --query id -o tsv
$TENANT_ID       = az account show --query tenantId -o tsv
```

```bash
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az extension add --name containerapp --upgrade
```

All three, and `--wait` on each. A subscription that has never used a service is not
registered for it, and the failure names the namespace rather than saying what to do:
`MissingSubscriptionRegistration`. Registration is asynchronous, so without `--wait` the very
next command can fail for the same reason.

```bash
az group create --name $RG --location $LOCATION --output table
```

The identity GitHub deploys as:

```bash
$APP_ID = az ad app create --display-name sentinel-deploy --query appId -o tsv
az ad sp create --id $APP_ID
```

Contributor on this one resource group, not the whole subscription:

```bash
az role assignment create --assignee $APP_ID --role Contributor --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG"
```

Trust GitHub for this repository and `main` only. The `subject` is the security boundary —
without it, any repository in the world could request a token:

```bash
@'
{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:Aswin-Kumar7/buildathon:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}
'@ | Out-File -FilePath fed.json -Encoding utf8
```

```bash
az ad app federated-credential create --id $APP_ID --parameters "@fed.json"
```

The container registry. Names are globally unique, hence the suffix. `--admin-enabled` is
what lets the deploy workflow authenticate without needing role-assignment rights, which
Contributor deliberately excludes:

```bash
$ACR = "sentinelacr" + (Get-Random -Maximum 99999)
az acr create --name $ACR --resource-group $RG --sku Basic --location $LOCATION --admin-enabled true --output table
```

```bash
Write-Output "AZURE_CLIENT_ID $APP_ID"; Write-Output "AZURE_TENANT_ID $TENANT_ID"; Write-Output "AZURE_SUBSCRIPTION_ID $SUBSCRIPTION_ID"; Write-Output "AZURE_ACR_NAME $ACR"
```

## 2. Repository secrets

<https://github.com/Aswin-Kumar7/buildathon/settings/secrets/actions>

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | from the bootstrap output |
| `AZURE_TENANT_ID` | from the bootstrap output |
| `AZURE_SUBSCRIPTION_ID` | from the bootstrap output |
| `AZURE_ACR_NAME` | from the bootstrap output |
| `APP_DATABASE_URL` | `DATABASE_URL` from `.env` |
| `APP_PSEUDONYM_KEY` | `PSEUDONYM_KEY_V1` from `.env` |
| `APP_PAYLOAD_KEY` | `PAYLOAD_KEY_V1` from `.env` |
| `APP_RAZORPAY_KEY_ID` | `RAZORPAY_KEY_ID` from `.env` |
| `APP_RAZORPAY_KEY_SECRET` | `RAZORPAY_KEY_SECRET` from `.env` |
| `APP_RAZORPAY_WEBHOOK_SECRET` | `RAZORPAY_WEBHOOK_SECRET` from `.env` |

The first four are identifiers, not credentials. What authorises a deploy is GitHub's signed
claim about which repository is running.

## 3. Provision

Actions → **Azure setup** → **Run workflow** → `provision`.

Creates the Container Apps environment and both apps, already configured, running a
placeholder image.

## 4. Deploy

Push to `main`, or Actions → **Deploy** → **Run workflow**.

Builds both images, pushes them to the registry, and swaps them in. The API should come up
healthy on the first try, because provisioning gave it its database before any image ran.

## 5. Configure

Actions → **Azure setup** → **Run workflow** → `configure`.

Re-applies environment variables and links the two services to each other. Both URLs appear
in the run summary. Re-run this whenever a value changes.

## 6. Point Razorpay at it

Webhook URL: `<API URL>/api/webhooks/razorpay`, with the same secret that went into
`APP_RAZORPAY_WEBHOOK_SECRET`. Active events: `payment.failed`, `payment.authorized`,
`payment.captured`, `order.paid`.

The console's **System health** page should report "configured", and the counts should move
on the first real delivery.

---

## Settings that are not cosmetic

- **`TRUST_PROXY=true`** — Container Apps terminates TLS and forwards the client address.
  Without it every request appears to come from the ingress, the IP pseudonym collapses to
  one constant value, and the detector's per-network velocity signal silently dies. Safe only
  *because* this really is behind a proxy we control; it must stay `false` anywhere else.
- **`INBOX_DRAIN_INTERVAL_MS=5000`** — five seconds in production against one second locally.
  Container Apps bills a replica at the active rate whenever it exceeds 0.01 vCPU or receives
  more than 1 KB/s, and a drain waking every second keeps tripping that. Nothing downstream
  depends on redaction lag.
- **API `--min-replicas 1`** — the drain is a timer, and a stopped replica has no CPU to run
  it.
- **API `--max-replicas 1`** — the drain polls the inbox from inside the process, so two
  replicas would poll the same rows. Nothing corrupts (deduplication is a database constraint
  and the canonical insert is idempotent), but they would duplicate work and inflate the
  attempt counter, dead-lettering a row before its three attempts are up.
- **Shop `--min-replicas 0`** — a static file server with no background work has no reason to
  hold a replica open.

## Cost

Free grant: 180,000 vCPU-seconds, 360,000 GiB-seconds and 2M requests per subscription per
month. A 30-day month is 2,592,000 seconds, so an always-on replica burns through the grant
in the first two days and pays for the rest.

The API at 0.25 vCPU / 0.5 GiB — the smallest size Container Apps offers:

| | Billable after the grant | Idle rate | Active rate |
|---|---|---|---|
| vCPU | 468,000 s | $3.74 | $11.23 |
| Memory | 936,000 s | $0.94 | $2.81 |
| **Compute** | | **$4.68** | **$14.04** |
| Container Registry, Basic | | $5.00 | $5.00 |
| Storefront (scales to zero) | | ~$0 | ~$0 |
| **Total per month** | | **~$10** | **~$19** |

Which rate applies depends on how often the replica is doing something: Container Apps bills
the active rate whenever a replica exceeds 0.01 vCPU or receives more than 1 KB/s. A demo
that is idle most of the time sits near the left column, which is why the drain interval is
five seconds in production rather than one.

**Two months: roughly $20–38.** Against $100 of student credit, over 12 months.

Where the money actually goes, in order: the always-on replica, then the registry. If the
bill needs to be smaller than this, the levers are, in order of what they cost you:

1. **Delete the registry between demos** and recreate it on the next deploy — saves $5/month,
   costs one command.
2. **`--min-replicas 0` on the API** — takes compute to nearly zero, and costs the two things
   the architecture is built on: the drain stops running while idle, and a webhook arriving
   cold pays a start-up that will not fit inside Razorpay's five-second window. Razorpay
   retries, so events are not lost, but the "durable before acknowledgement, inside the
   contract" claim stops being demonstrable.

Check the real figure in Cost Management rather than trusting this table.

## Stopping it

Scaling to zero ends the compute charge without deleting anything:

```bash
az containerapp update --name sentinel-api --resource-group sentinel --min-replicas 0
```

Removing everything, registry included:

```bash
az group delete --name sentinel --yes
```

## What this does not do yet

- No custom domain, so the URLs are the generated `azurecontainerapps.io` ones.
- The drain runs inside the API process, which is why `--max-replicas 1` is set. Lifting it
  means claiming rows with `FOR UPDATE SKIP LOCKED`, or moving the drain to its own
  single-replica app and letting the API scale freely — the shape the architecture plan
  assumes.
