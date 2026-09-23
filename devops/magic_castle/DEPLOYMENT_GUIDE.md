# Magic Castle + LLMHub deployment guide

End-to-end walkthrough for deploying a [Magic Castle](https://github.com/ComputeCanada/magic_castle)
cluster on NCSA's OpenStack (Radiant) with two NVIDIA A100 GPU compute nodes, and
running LLMHub (FastAPI backend + Next.js frontend) on the login node.

> **Placeholders.** This guide uses `<LOGIN_PUBLIC_IP>`, `<SUBNET_ID>`,
> `<PROJECT>`, and `<GUEST_PASSWORD>` in place of deployment-specific values.
> Look them up for your own project (§2) and never commit them.

## Cluster summary

| Instance | Flavor | Role |
|----------|--------|------|
| `mgmt1` | `gp.xlarge` (8 vCPU, 32 GB) | Puppet server, Slurm controller, FreeIPA, NFS |
| `login1` | `gp.xlarge` (8 vCPU, 32 GB) | Login node, JupyterHub, Caddy reverse proxy, LLMHub app |
| `node1` | `g1.a100.80gb.x1` (24 vCPU, 230 GB) | GPU compute node (A100 80 GB) |
| `node2` | `g1.a100.80gb.x1` (24 vCPU, 230 GB) | GPU compute node (A100 80 GB) |

---

## 1. Prerequisites

- Terraform >= 1.5.7 on your local machine
- Access to an NCSA OpenStack project with quota for GPU instances
- OpenStack RC file (Identity API v3), downloaded from Horizon: _Project → API Access_
- An SSH key pair (ed25519 recommended)
- OpenStack CLI: `pip install python-openstackclient`
- A local clone of [ComputeCanada/magic_castle](https://github.com/ComputeCanada/magic_castle),
  checked out at the `15.3.1` tag, with this folder's `main.tf` copied into its
  root — see [README](README.md#important-maintf-is-not-standalone). `main.tf`
  depends on the `./openstack` module that lives in that repo.

---

## 2. OpenStack environment details

Source your project's RC file first and enter your password when prompted:

```bash
source <PROJECT>-openrc.sh
```

### Image

```bash
openstack image list
```

This deployment uses **Rocky 9 latest**. Magic Castle's Puppet configuration
supports Rocky/RHEL 8 and 9; other images are not supported.

### Internal subnet

```bash
openstack subnet list
```

Pick the **internal** project subnet (a private range such as `192.168.x.0/24`)
and set its ID as `subnet_id` in `main.tf`.

> The external subnet (`ext-net-subnet`) is used automatically for floating IPs.
> Only specify the internal subnet in `main.tf`. `subnet_id` is required whenever
> the project has more than one subnet — otherwise Terraform fails with
> _"Your query returned more than one subnet"_.

### GPU flavor

```bash
openstack flavor list
```

This deployment uses `g1.a100.80gb.x1` — 24 vCPU, 230 GB RAM, 1× NVIDIA A100 80 GB.

> This flavor is **not public**. Your OpenStack project must be granted explicit
> access by a cloud admin before Terraform can use it.

---

## 3. Terraform configuration

The working configuration lives in [`main.tf`](main.tf). Key points:

- **`config_version`** pins the `puppet-magic_castle` release (`15.3.1` here).
- **`instances`** define the four nodes above. Tags drive Puppet roles:
  `puppet`/`mgmt`/`nfs` on mgmt1, `login`/`public`/`proxy` on login1, `node` on
  the GPU nodes.
- **`volumes`** back the NFS shares: `home` (150 GB), `project` (750 GB,
  resizable), `scratch` (200 GB). LLMHub, its models, and the Apptainer image all
  live under `/project`, so size that volume generously.
- **`nb_users`** creates guest accounts `user01`…`userNN` sharing `guest_passwd`.
- **`hieradata`** configures the Caddy reverse proxy on the login node. It is
  **commented out by default**; see below.

### Optional: exposing LLMHub over the network

The `hieradata` block in `main.tf` is only needed to publish LLMHub on the
public internet. The cluster provisions correctly without it, and you can still
use LLMHub over an SSH tunnel from your laptop:

```bash
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 centos@<LOGIN_PUBLIC_IP>
# then open http://localhost:3000
```

That is the simplest setup for testing, and it keeps the app off the public
internet while authentication and access control are still being configured.

To publish the frontend at `https://<cluster_name>.<domain>` instead, uncomment
the block in [`main.tf`](main.tf):

```hcl
hieradata = <<-EOT
  profile::reverse_proxy::main2sub_redir: "app"
  profile::reverse_proxy::subdomains:
    ipa: "ipa.%%{lookup('profile::freeipa::base::ipa_domain')}"
    mokey: "%%{lookup('terraform.tag_ip.mgmt.0')}:%%{lookup('profile::freeipa::mokey::port')}"
    app: "http://localhost:3000"
    metrix: "http://%%{lookup('terraform.tag_ip.mgmt.0')}:9000"
EOT
```

- `app` points Caddy at the Next.js frontend on port 3000, and
  `main2sub_redir: "app"` redirects the cluster root to that subdomain — so
  `https://<cluster>.<domain>` lands on LLMHub, with TLS handled by Caddy.
- Keep the `ipa` and `mokey` entries. Setting `profile::reverse_proxy::subdomains`
  replaces the entire default map, so dropping them takes FreeIPA and Mokey
  offline.
- The double `%%` is Terraform heredoc escaping for Puppet's `%{lookup(...)}`
  interpolation — leave it as-is.
- Changing `hieradata` on a running cluster only needs a Puppet run, not a
  rebuild: `terraform apply`, then wait for the next Puppet cycle on the login
  node (or force it) and confirm with `journalctl -u puppet -f`.
- If you set `BETTER_AUTH_URL` and `BACKEND_CORS_ORIGINS` (§8.2) to `localhost`
  for tunnel access, update them to the public URL when you switch the proxy on.

### Before you apply

Everything in this checklist is deployment-specific. The first three values come
from the OpenStack lookups in §2.

- Set `subnet_id` to your project's internal subnet.
- Set `image` to a supported Rocky/RHEL image available in your project
  (`Rocky 9 latest` here).
- Set the `instances` flavors to ones your project has quota for — in particular
  the GPU flavor, which needs explicit access granted by a cloud admin.
- Set `cluster_name` and `domain`. Together they form the cluster's public
  hostname (`llmhub.ncsa.illinois.edu` here), so the domain must be a DNS zone
  where the records can be created — either through the DNS modules commented out
  at the bottom of `main.tf`, or by whoever administers the zone.
- Set `public_keys` to your own public key path; this key becomes the sudoer
  account's authorized key and is your only way in.
- Set `guest_passwd` to a strong value, or leave it blank to have Magic Castle
  generate one.
- Size `volumes` for your workload. Models, the Apptainer image, and the LLMHub
  checkout all live under `/project`.
- Do **not** use `admin` as `sudoer_username`; it collides with a reserved system
  user on Rocky Linux. The default (`centos`) is used throughout this guide.

---

## 4. Deployment

### 4.1 Authenticate

```bash
source <PROJECT>-openrc.sh
```

### 4.2 Initialize and apply

Run these from the root of the Magic Castle clone, where you copied `main.tf`:

```bash
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

> The cluster is **not** ready when `apply` returns. Allow ~15 minutes for
> cloud-init and Puppet to converge.

### 4.3 Read the outputs

```bash
terraform output public_ip   # floating IP of login1  -> <LOGIN_PUBLIC_IP>
terraform output accounts    # guest account credentials (sensitive)
```

> `terraform.tfstate` contains generated passwords in cleartext. Keep it out of
> version control and off shared filesystems.

---

## 5. Post-deployment verification

### 5.1 SSH access

```bash
# login node
ssh -i ~/.ssh/id_ed25519 centos@<LOGIN_PUBLIC_IP>

# mgmt1 via jump host (no direct SSH firewall rule by default)
ssh -i ~/.ssh/id_ed25519 -J centos@<LOGIN_PUBLIC_IP> centos@mgmt1
```

> After a rebuild you may hit `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED`.
> Clear the stale key with `ssh-keygen -R <LOGIN_PUBLIC_IP>`.

### 5.2 Check Puppet completion

```bash
journalctl -u puppet | tail -50
journalctl -u puppet -f          # follow live
```

Look for `Applied catalog in X seconds` with no errors.

### 5.3 Verify Slurm

```bash
sinfo
scontrol show nodes
```

Expect `node1` and `node2` with `Gres=gpu:1`. State `IDLE+CLOUD` is normal for
Magic Castle — nodes power on when a job is scheduled.

### 5.4 Test a GPU job

```bash
ssh user01@<LOGIN_PUBLIC_IP>          # password from `terraform output accounts`
srun --gres=gpu:1 -p node --pty bash
nvidia-smi
```

Expect an `NVIDIA A100-SXM4-80GB` with CUDA 12.9 / driver 575.57.08 (whatever the
image ships — note the versions, they matter for the Apptainer build in §8).

---

## 6. Slurm account setup for `centos`

The `centos` sudoer account is not registered in the Slurm accounting database by
default, so its jobs are rejected with
`srun: Invalid account or account/partition`.

```bash
# inspect existing accounts and associations
sudo /opt/software/slurm/bin/sacctmgr show accounts
sudo /opt/software/slurm/bin/sacctmgr show users withassoc
```

Magic Castle creates the account `def-sponsor00`, with `user01`…`userNN`
pre-assigned. Add `centos` to it:

```bash
sudo /opt/software/slurm/bin/sacctmgr add user centos account=def-sponsor00
```

Then give `centos` a working directory on the project volume:

```bash
sudo chmod 755 /project/def-sponsor00
sudo mkdir -p /project/def-sponsor00/centos
sudo chown centos:centos /project/def-sponsor00/centos
```

---

## 7. Python environment on the login node

Magic Castle exposes the Alliance/Compute Canada software stack over CVMFS.
Python comes from the module system, not conda.

```bash
echo "source /cvmfs/soft.computecanada.ca/config/profile/bash.sh" >> ~/.bashrc
source ~/.bashrc
module load StdEnv/2023
module load python/3.12.4
module load postgresql          # provides pg_config for psycopg2
```

> vec-inf does not support Python 3.9. If a virtualenv was created before loading
> the module, delete `.venv`, load `python/3.12.4`, and recreate it.

---

## 8. LLMHub setup

### 8.1 Clone the monorepo

LLMHub is a single repository containing both applications — `backend/`
(FastAPI) and `frontend/` (Next.js). Earlier deployments used two separate
repos, `llm-serving-backend` and `llm-serving-frontend`; those are superseded, so
clone once:

```bash
cd /project/def-sponsor00/centos
git clone https://github.com/Center-for-AI-Innovation/LLMHub.git
cd LLMHub
```

Everything below assumes `/project/def-sponsor00/centos/LLMHub` as the checkout
path — it is also what the `magic-castle-radiant` config and the systemd units in
§9 expect. Cloning elsewhere means updating both.

The `devops/` directory is part of the same checkout, so the Apptainer build
script (§8.5) and this guide live on the cluster right next to the code.

### 8.2 Configure the environment

Both applications need a reachable PostgreSQL database and their own env file.
The checked-in examples are the source of truth for the full variable list:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Values that matter on this cluster:

| File | Variable | Value |
|------|----------|-------|
| `backend/.env` | `DATABASE_URL` | PostgreSQL URL for the backend schema |
| `backend/.env` | `VEC_INF_ACCOUNT` / `SLURM_ACCOUNT` | `def-sponsor00` |
| `backend/.env` | `VEC_INF_WORK_DIR` | `/project/def-sponsor00/centos` |
| `backend/.env` | `BACKEND_CORS_ORIGINS` | the public frontend URL |
| `frontend/.env.local` | `POSTGRES_URL` | PostgreSQL URL for the frontend schema |
| `frontend/.env.local` | `BACKEND_API_URL` | `http://localhost:8001` — see the port note below |
| `frontend/.env.local` | `BETTER_AUTH_URL` | the public cluster URL served by Caddy |

Keep `.env` and `.env.local` off version control and readable only by the
service account (`chmod 600`).

### 8.3 Backend

```bash
cd /project/def-sponsor00/centos/LLMHub/backend
export INFRASTRUCTURE=magic-castle-radiant
./scripts/start.sh 8001
```

`scripts/start.sh` creates `.venv`, installs the package (including the custom
vec-inf build), and starts uvicorn on the port you pass.

> Port 8000 is already in use on the Magic Castle login node, so the backend runs
> on **8001**. Check with `ss -tlnp | grep 8000`. `BACKEND_API_URL` in the
> frontend defaults to `http://localhost:8000`, so it must be set explicitly or
> the UI will talk to the wrong service.

`INFRASTRUCTURE=magic-castle-radiant` selects
[`backend/config/infrastructures/magic-castle-radiant/environment.yaml`](../../backend/config/infrastructures/magic-castle-radiant/environment.yaml),
which holds the cluster-specific settings: the `node` partition, the
`def-sponsor00` account, GPU/CPU/memory defaults, log and model directories, the
Apptainer module load command, and the SIF image path. Auto-detection also
matches on the `llmhub`/`magic-castle` hostname patterns, but setting the
variable explicitly avoids surprises. Launch defaults shown in the UI come from
this file via `/api/models/launch-defaults` — edit the YAML, not the frontend.

### 8.4 Frontend

Install Node 22 and pnpm on the login node, then build:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
nvm install 22
nvm alias default 22
wget -qO- https://get.pnpm.io/install.sh | sh -

cd /project/def-sponsor00/centos/LLMHub/frontend
pnpm install
pnpm db:migrate                 # apply the Drizzle schema
pnpm build                      # also runs migrations
pnpm start                      # serves on port 3000, behind the Caddy proxy
```

By default the frontend is only reachable on the login node itself — open an SSH
tunnel (`ssh -L 3000:localhost:3000 centos@<LOGIN_PUBLIC_IP>`) and browse to
<http://localhost:3000>. To serve it publicly over HTTPS instead, enable the
Caddy reverse proxy as described in
[§3](#optional-exposing-llmhub-over-the-network).

### 8.5 Build the vLLM Apptainer image

vec-inf runs inference inside a `vllm.sif` Apptainer image. Build it **on the
cluster** — copying a `.sif` from another machine fails on path, Python, or CUDA
driver mismatches.

The build script and full instructions are in
[`devops/apptainers/`](../apptainers):

```bash
cd /project/def-sponsor00/centos/LLMHub/devops/apptainers
sbatch build_vllm_sif.sbatch
squeue -u $USER
tail -f build_vllm_sif.err      # Apptainer progress
```

The build takes roughly 20–40 minutes. Notes specific to this cluster:

- NFS does not support the extended attributes a direct SIF build needs, so the
  script builds a sandbox under `/dev/shm` first and converts it to SIF
  afterwards.
- Confirm the resulting path matches `paths.image_path` and
  `paths.vllm_image_path` in the `magic-castle-radiant` environment config.

### 8.6 Create the bind-mount directories

The infra config bind-mounts Hugging Face and torch caches into the container.
Create them before launching a model, or the job fails to start:

```bash
mkdir -p /project/def-sponsor00/centos/.cache/huggingface
mkdir -p /project/def-sponsor00/centos/.cache/torch_inductor
mkdir -p /project/def-sponsor00/centos/models
```

### 8.7 Install `nc` on the compute nodes

vec-inf uses `nc` (netcat) to poll whether the inference server is up. It is not
installed on Magic Castle compute nodes by default, and without it jobs hang or
fail silently while waiting for readiness.

```bash
ssh node1 'sudo dnf install -y nmap-ncat && which nc'
ssh node2 'sudo dnf install -y nmap-ncat && which nc'
```

### 8.8 Debugging vec-inf jobs

Job logs land in `~/.vec-inf-logs/<model-family>/<model-name>.<job-id>/` (the
`log_dir` from the infra config).

```bash
tail -f ~/.vec-inf-logs/<family>/<model>.<job-id>/*.out
scontrol show job <job-id>       # StdOut/StdErr paths
ps aux | grep vllm               # run on the compute node
```

Empty log files usually mean the model is still loading — vLLM can take several
minutes on first launch while weights download.

---

## 9. Running LLMHub under systemd

Once both services run by hand, install them as units so they survive reboots.
Adjust `User`, paths, and the Node version in `PATH` to match your deployment.

### Backend

```bash
sudo tee /etc/systemd/system/llmhub-backend.service << 'EOF'
[Unit]
Description=LLMHub Backend
After=network.target

[Service]
Type=simple
User=centos
WorkingDirectory=/project/def-sponsor00/centos/LLMHub/backend
ExecStart=/project/def-sponsor00/centos/LLMHub/backend/scripts/start.sh 8001
Restart=always
RestartSec=10
Environment=HOME=/centos
Environment=INFRASTRUCTURE=magic-castle-radiant
Environment=PATH=/opt/software/slurm/bin:/centos/.local/share/pnpm:/centos/.nvm/versions/node/v22/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin

[Install]
WantedBy=multi-user.target
EOF
```

### Frontend

```bash
sudo tee /etc/systemd/system/llmhub-frontend.service << 'EOF'
[Unit]
Description=LLMHub Next.js Frontend
After=network.target

[Service]
Type=simple
User=centos
WorkingDirectory=/project/def-sponsor00/centos/LLMHub/frontend
ExecStart=/centos/.local/share/pnpm/pnpm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOME=/centos
Environment=PATH=/centos/.local/share/pnpm:/centos/.nvm/versions/node/v22/bin:/usr/local/bin:/usr/bin:/usr/sbin

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now llmhub-backend llmhub-frontend
sudo journalctl -fu llmhub-backend
```

> Keep secrets (database URLs, API keys) in the backend `.env` file with
> restrictive permissions rather than in `Environment=` lines — unit files are
> world-readable.

---

## 10. Troubleshooting

| Problem | Fix |
|---------|-----|
| _Your query returned more than one subnet_ | Set `subnet_id` in `main.tf` to the internal subnet ID |
| `Permission denied (publickey)` on mgmt1 | Use the login node as a jump host: `ssh -J centos@<LOGIN_PUBLIC_IP> centos@mgmt1` |
| `admin@mgmt1: Permission denied` | Don't use `admin` as `sudoer_username` — it conflicts with a system user on Rocky |
| `srun: Invalid account or account/partition` | `sudo sacctmgr add user centos account=def-sponsor00` (§6) |
| Nodes not ready / node failure | Nodes are `POWERED_DOWN`; `scontrol update nodename=nodeX state=resume` |
| vec-inf refuses Python 3.9 | Delete `.venv`, `module load python/3.12.4`, recreate |
| Port 8000 already in use | Find the owner with `ss -tlnp \| grep 8000`; run the backend on 8001 |
| `pg_config not found` building psycopg2 | `module load postgresql`, or `sudo dnf install -y postgresql-devel` |
| `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` | `ssh-keygen -R <LOGIN_PUBLIC_IP>` |
| `cd: def-sponsor00/: Permission denied` | `sudo chmod 755 /project/def-sponsor00` |
| vec-inf log files empty | Model is still loading — `tail -f` the `.out` file and wait |
| Apptainer build fails on xattr | Build a sandbox in `/dev/shm` first, then convert to SIF (§8.5) |

---

## 11. Command reference

### Slurm

```bash
sinfo                                    # cluster overview
sinfo -o "%P %a %l %G %N %c %m"          # with GPU / resource detail
scontrol show nodes                      # full node details
squeue                                   # running jobs
srun --gres=gpu:1 -p node --pty bash     # interactive GPU shell
sbatch myjob.sh                          # submit a batch job
sudo /opt/software/slurm/bin/sacctmgr show users withassoc
```

### SSH

```bash
ssh -i ~/.ssh/id_ed25519 centos@<LOGIN_PUBLIC_IP>     # login1
ssh -J centos@<LOGIN_PUBLIC_IP> centos@mgmt1          # mgmt1 via jump host
ssh node1                                             # from login1
```

### Puppet

```bash
journalctl -u puppet | tail -50
journalctl -u puppet -f
```

### Terraform

```bash
terraform output public_ip
terraform output accounts
terraform destroy -refresh=false
```

### Services

```bash
sudo journalctl -fu llmhub-backend
sudo journalctl -fu llmhub-frontend
sudo systemctl restart llmhub-backend
```

---

## 12. Quality-of-life tweak

Prefix-aware history search makes the long paths above much less painful. Create
`~/.inputrc`:

```
# keep the default bindings
$include /etc/inputrc

## arrow up
"\e[A":history-search-backward
## arrow down
"\e[B":history-search-forward
```

Type a prefix and press ↑ to cycle through matching commands.
