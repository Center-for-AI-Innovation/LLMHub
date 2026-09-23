# Magic Castle deployment for LLMHub

This folder holds the [Magic Castle](https://github.com/ComputeCanada/magic_castle)
configuration used to stand up the Slurm cluster that LLMHub runs on at NCSA
(OpenStack / Radiant), plus a guide describing the full deployment.

Magic Castle provisions a small self-contained HPC cluster — Slurm controller,
FreeIPA, NFS, a login node with a Caddy reverse proxy, and GPU compute nodes —
which gives LLMHub the Slurm + Apptainer environment it expects on a real HPC
system.

## Contents

| File | Purpose |
|------|---------|
| [`main.tf`](main.tf) | Terraform configuration for the `llmhub` cluster: instance flavors, volumes, users, and an optional (commented-out) Caddy reverse-proxy block that publishes the LLMHub frontend |
| [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) | End-to-end guide: provisioning the cluster, then installing and running LLMHub on it |

## Important: `main.tf` is not standalone

`main.tf` references `./openstack` (and optionally `./dns/cloudflare`,
`./dns/gcloud`), which are modules that live in the upstream Magic Castle
repository — they are **not** vendored here. Clone that repo and copy this
`main.tf` into its root:

```bash
git clone https://github.com/ComputeCanada/magic_castle.git
cd magic_castle
git checkout 15.3.1   # match config_version in main.tf
cp /path/to/LLMHub/devops/magic_castle/main.tf .
```

Checking out the tag that matches `config_version` in `main.tf` keeps the
Terraform modules and the `puppet-magic_castle` release in sync; upstream `main`
may expect parameters this configuration does not set.

Run Terraform from the cloned repo, not from this folder. Keep the Terraform
state (`terraform.tfstate`) out of both repos.

## TL;DR

1. Download your project's OpenStack RC file (Identity API v3) from Horizon
   (_Project → API Access_) and source it: `source <project>-openrc.sh`.
2. Clone [ComputeCanada/magic_castle](https://github.com/ComputeCanada/magic_castle)
   and check out the `15.3.1` tag.
3. Copy this folder's `main.tf` into the root of that clone.
4. Adjust `main.tf` for your project — `subnet_id`, `image`, instance flavors,
   `cluster_name`, `domain`, `public_keys`, and `guest_passwd`. Look the
   OpenStack values up with
   [§2](DEPLOYMENT_GUIDE.md#2-openstack-environment-details) and work through the
   [Before you apply](DEPLOYMENT_GUIDE.md#before-you-apply) checklist.
5. `terraform init` → `terraform plan -out tfplan` → `terraform apply tfplan`.
6. Wait ~15 minutes for cloud-init and Puppet to finish, then follow
   [§5 onward](DEPLOYMENT_GUIDE.md#5-post-deployment-verification) to verify the
   cluster and install LLMHub on the login node.

Tear down with `terraform destroy`.

## Exposing LLMHub publicly

`main.tf` ships with the Caddy reverse-proxy `hieradata` block commented out.
It is only needed to publish LLMHub on the public internet — the cluster comes up
fine without it, and the app is usable over an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 centos@<login_public_ip>
```

Uncomment the block to serve the frontend at `https://<cluster_name>.<domain>`
with TLS. See
[§3 of the deployment guide](DEPLOYMENT_GUIDE.md#optional-exposing-llmhub-over-the-network)
for the caveats.

## Related directories

- [`devops/apptainers/`](../apptainers) — builds the `vllm.sif` image that
  inference jobs run inside.
- [`backend/config/infrastructures/magic-castle-radiant/`](../../backend/config/infrastructures/magic-castle-radiant) —
  the LLMHub backend config for this cluster (partition, account, bind mounts,
  image paths). Select it with `INFRASTRUCTURE=magic-castle-radiant`.

## Secrets

Do not commit real credentials here. `guest_passwd` in `main.tf` is a
placeholder; set a real value locally (or leave it blank so Magic Castle
generates one) and keep it out of version control. The same applies to
`terraform.tfstate`, which records generated account passwords in cleartext.
For a full reference of the parameters used here, see the
[Magic Castle documentation](https://github.com/ComputeCanada/magic_castle/tree/main/docs).
