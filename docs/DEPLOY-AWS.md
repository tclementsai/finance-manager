# AWS Deployment Guide (Free Tier)

This guide deploys the Ledger finance manager to AWS using three services:
- **EC2 t2.micro** — FastAPI backend (free for 12 months)
- **AWS Amplify** — Next.js frontend (generous free tier)
- **S3** — optional nightly encrypted-at-rest JSON backups of your data

The frontend (Amplify) talks to the backend by pointing an `API_URL` environment
variable straight at the EC2 instance's public address. No reverse proxy or tunnel
is required for a basic setup — see [Part 4](#part-4--stable-ip--https-notes) for the
trade-offs and how to harden it.

---

## Part 1 — EC2 Instance (Backend)

### 1.1 Launch the instance

1. Go to **EC2 → Launch Instance** in the AWS console
2. Set:
   - **Name:** `ledger-backend`
   - **AMI:** Ubuntu Server 24.04 LTS (free tier eligible)
   - **Instance type:** `t2.micro` (free tier eligible)
3. **Key pair:** Create a new key pair → download the `.pem` file and keep it safe
4. **Network settings → Edit:**
   - Allow SSH (port 22) — your IP only
   - Add rule: Custom TCP, port **8077**, source **Anywhere** (or your IP for tighter security)
5. **Storage:** 8 GB gp2 (default, free tier eligible)
6. Click **Launch instance**

### 1.2 Attach an IAM role (SSM access + S3 backups)

An IAM role lets the instance (a) be reached via Session Manager without an SSH key
and (b) write backups to S3 without storing any AWS access keys on the box.

1. Go to **IAM → Roles → Create role**
2. Trusted entity: **AWS service → EC2**
3. Attach policy: `AmazonSSMManagedInstanceCore` (for Session Manager)
4. Name it `ledger-ec2-ssm-role` → Create
5. Back in EC2 → select your instance → **Actions → Security → Modify IAM role** → attach `ledger-ec2-ssm-role`

> The S3 write permission is added later, in [Part 5](#part-5--s3-nightly-backups-optional),
> once the bucket exists. Skip that part if you don't want backups.

### 1.3 Connect to the instance

**Option A — SSM (no SSH key needed, requires IAM role from 1.2):**
```
EC2 console → select instance → Connect → Session Manager → Connect
```

**Option B — SSH:**
```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
```

---

## Part 2 — Deploy the Backend

Run all of the following inside the EC2 instance.

### 2.1 Install dependencies

```bash
sudo apt update && sudo apt install -y python3-pip python3-venv git
```

### 2.2 Clone the repo

```bash
cd /home/ubuntu
git clone https://github.com/<your-username>/<your-repo>.git finance-manager
cd finance-manager/backend
```

> If your repo is private, use a GitHub personal access token:
> `git clone https://<token>@github.com/<user>/<repo>.git finance-manager`

### 2.3 Set up Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> If you plan to enable S3 backups (Part 5), also install boto3, which is **not**
> in `requirements.txt`:
> ```bash
> pip install boto3
> ```

### 2.4 Configure environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:
```
APP_PASSWORD=choose-a-strong-password
SECRET_KEY=choose-a-long-random-string
DATABASE_URL=sqlite:///./ledger.db
```

To enable nightly S3 backups, also add (see Part 5):
```
BACKUP_S3_BUCKET=your-ledger-backups-bucket
```

### 2.5 Seed demo data (optional)

```bash
python -m app.seed
```

### 2.6 Create a systemd service

```bash
sudo nano /etc/systemd/system/ledger.service
```

Paste (note the path matches the clone location from 2.2 — `finance-manager`):
```ini
[Unit]
Description=Ledger FastAPI Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/finance-manager/backend
ExecStart=/home/ubuntu/finance-manager/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8077
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ledger
sudo systemctl start ledger
sudo systemctl status ledger
```

### 2.7 Verify the backend is running

```bash
curl http://localhost:8077/api/health
# Expected: {"status":"ok","stripe":false}
```

From your own machine:
```
http://<ec2-public-ip>:8077/docs
```

---

## Part 3 — Amplify Hosting (Frontend)

### 3.1 Push your code to GitHub

Amplify pulls from a Git provider. Make sure your repo is pushed to GitHub (or GitLab/Bitbucket).

### 3.2 Create the Amplify app

1. Go to **AWS Amplify → Create new app**
2. Choose **GitHub** → authorize → select your repo and branch (`main`)
3. On the "Configure build settings" step, click **Edit** and replace with:

```yaml
version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - cd frontend && npm install
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: frontend/.next
        files:
          - '**/*'
      cache:
        paths:
          - frontend/node_modules/**/*
    appRoot: frontend
```

4. Click **Next → Save and deploy**

### 3.3 Point the frontend at the backend

1. In the Amplify console → your app → **Environment variables**
2. Add:
   - Key: `API_URL`
   - Value: `http://<ec2-public-ip>:8077`
3. Click **Save** → go to **Deployments → Redeploy** the latest build

Whenever the EC2 public IP changes (see Part 4), update this value and redeploy.

---

## Part 4 — Stable IP & HTTPS notes

### 4.1 Keep the IP stable with an Elastic IP (recommended)

By default EC2 assigns a **dynamic** public IP that changes every time the instance
stops and starts (a plain reboot keeps it; a stop/start or underlying host migration
does not). When it changes you must update `API_URL` in Amplify and redeploy — annoying,
and it means downtime until you notice.

An **Elastic IP (EIP)** is a fixed public IP you allocate once and keep.

**Cost (this is the part you asked about):**
Since **1 February 2024**, AWS charges **$0.005/hour (~$3.60/month)** for *every* public
IPv4 address — including the dynamic one your instance already has. An Elastic IP
**attached to a running instance costs the same $0.005/hour**, so switching to one adds
**no extra cost** over what you're already paying today. The only case that costs *more*
is an EIP you allocate but leave **unattached** (idle) — also billed at $0.005/hour — so
release any EIP you're not using.

**Bottom line:** an Elastic IP gives you a permanent address at effectively zero
additional cost. Recommended.

To set one up:
1. **EC2 → Elastic IPs → Allocate Elastic IP address** → Allocate
2. Select it → **Actions → Associate Elastic IP address** → choose your instance → Associate
3. Update `API_URL` in Amplify to the new Elastic IP and redeploy
4. If you ever terminate the instance, **release** the Elastic IP so it doesn't sit idle

### 4.2 A note on HTTPS / mixed content

Amplify serves your frontend over `https://`. Pointing `API_URL` at a plain
`http://<ec2-ip>:8077` backend means the browser is making `http://` requests from an
`https://` page — **mixed content**, which modern browsers block by default. If your
current setup works, you're likely relying on the browser allowing it, testing over
HTTP, or an exception you've granted.

If you hit blocked requests, the options to serve the backend over HTTPS are, roughly
from simplest to most robust:

- **Caddy or nginx + a domain on the EC2 box** — put a reverse proxy in front of
  uvicorn that terminates TLS (Caddy auto-provisions a Let's Encrypt cert). Point
  `API_URL` at `https://api.yourdomain.com`. Needs a domain name.
- **Application Load Balancer + ACM certificate** — AWS-native TLS termination. Robust,
  but an ALB is **not** free-tier-friendly (~$16+/month), so it undercuts the goal here.
- **A tunnel (e.g. Cloudflare Tunnel)** — gives you an `https://` URL with no domain or
  open inbound port, at no cost. This was the previous recommendation; it's still a valid
  option if you'd rather not manage certs or a domain.

Pick based on whether you have a domain and how much you want to spend. For a personal,
single-user deployment the direct-IP approach is the cheapest and simplest.

---

## Part 5 — S3 Nightly Backups (optional)

The backend can push a daily JSON snapshot of each user's data (transactions, entities,
categories, accounts) to an S3 bucket. It's driven by the `_nightly_backup()` task in
`backend/app/main.py` and the manual `export_data()` endpoint in
`backend/app/routers/settings.py` — both no-op unless `BACKUP_S3_BUCKET` is set.

### 5.1 Create the bucket

1. **S3 → Create bucket**
2. Name: e.g. `your-ledger-backups` (globally unique), same region as your EC2 instance
3. Keep **Block all public access** enabled (backups should never be public)
4. (Recommended) enable **Default encryption** (SSE-S3) and **Versioning**
5. Create

### 5.2 Grant the EC2 role write access

Add an inline policy to the `ledger-ec2-ssm-role` created in Part 1.2:

1. **IAM → Roles → `ledger-ec2-ssm-role` → Add permissions → Create inline policy**
2. Use the JSON editor and paste (replace the bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::your-ledger-backups/*"
    }
  ]
}
```

3. Name it `ledger-s3-backup` → Create

Because the instance uses an IAM role, boto3 picks up credentials automatically — you do
**not** put any AWS access key in `.env`.

### 5.3 Install boto3 and enable the bucket

On the EC2 instance:

```bash
cd /home/ubuntu/finance-manager/backend
source .venv/bin/activate
pip install boto3

# add the bucket to .env
echo "BACKUP_S3_BUCKET=your-ledger-backups" >> .env

sudo systemctl restart ledger
```

> `boto3` is imported at the top of `_nightly_backup()` before the bucket check, so if it
> isn't installed the backup task fails on startup (silently, as a background task). Install
> it whenever `BACKUP_S3_BUCKET` is set.

### 5.4 How it behaves

- The task waits ~2 minutes after startup, then runs once every 24 hours.
- Objects are written per user to `backups/user-<id>/YYYY/MM/DD.json`.
- Manual exports from the Settings page also drop a copy at `backups/YYYY/MM/DD/HHMMSS.json`.
- Backups are **best-effort**: any failure is logged and swallowed, never blocking the app.
- Check it's working with `sudo journalctl -u ledger | grep -i backup`, or look for the
  objects appearing in the bucket the day after enabling it.

---

## Part 6 — Update the App

When you push changes to GitHub:
- **Frontend:** Amplify redeploys automatically
- **Backend:** SSH/SSM into EC2 and run:

```bash
cd /home/ubuntu/finance-manager
git pull
cd backend
source .venv/bin/activate
pip install -r requirements.txt  # only if requirements changed
sudo systemctl restart ledger
```

---

## Cost Summary (Free Tier)

| Service | Free Tier | After 12 months |
|---|---|---|
| EC2 t2.micro | 750 hrs/month free for 12 months | ~$8–10/month |
| EBS 8 GB | 30 GB/month free | ~$0.80/month |
| Public IPv4 (dynamic or Elastic) | None — billed from day 1 | ~$3.60/month per address |
| Amplify Hosting | 1,000 build min, 15 GB/month | Pay per use (cheap) |
| S3 backups | 5 GB free for 12 months | Cents/month for JSON snapshots |

> The IPv4 charge applies whether you use the auto-assigned IP or an Elastic IP — an
> Elastic IP does not add cost while attached to a running instance.

---

## Security Checklist Before Going Live

- [ ] Change `APP_PASSWORD` and `SECRET_KEY` in `.env` from defaults
- [ ] Restrict EC2 security group port 8077 to the addresses that need it (your IP, or
      leave open only if you accept the exposure of a single-password backend)
- [ ] Keep port 22 restricted to your IP only
- [ ] Do not commit your `.env` file to git
- [ ] Keep the S3 backup bucket private (Block all public access) and scope the IAM
      policy to `s3:PutObject` on that one bucket only
