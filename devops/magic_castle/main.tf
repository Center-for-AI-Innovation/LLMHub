terraform {
  required_version = ">= 1.5.7"
}

variable "pool" {
  description = "Slurm pool of compute nodes"
  default     = []
}

module "openstack" {
  source         = "./openstack"
  config_git_url = "https://github.com/ComputeCanada/puppet-magic_castle.git"
  config_version = "15.3.1"
  subnet_id      = "<SUBNET_ID>"

  cluster_name = "llmhub"
  domain       = "<DOMAIN>"
  image        = "Rocky 9 latest"

  instances = {
   mgmt  = { type = "gp.xlarge", tags = ["puppet", "mgmt", "nfs"], count = 1 },
   login = { type = "gp.xlarge", tags = ["login", "public", "proxy"], count = 1 },
   node  = { type = "g1.a100.80gb.x1", tags = ["node"], count = 2 }
  }

  # var.pool is managed by Slurm through Terraform REST API.
  # To let Slurm manage a type of nodes, add "pool" to its tag list.
  # When using Terraform CLI, this parameter is ignored.
  # Refer to Magic Castle Documentation - Enable Magic Castle Autoscaling
  pool = var.pool

  volumes = {
    nfs = {
      home    = { size = 150 }
      project = { size = 750, enable_resize = true }
      scratch = { size = 200 }
    }
  }

  public_keys = [file("~/.ssh/id_ed25519.pub")]
  nb_users = 10
  # Shared password for the guest accounts. Set this locally and keep it out of
  # version control, or leave it blank to have Magic Castle generate one.
  guest_passwd = ""

  # Caddy reverse proxy configuration.
  #
  # Only needed to expose LLMHub over the network. The cluster deploys fine
  # without it, and LLMHub can still be reached through an SSH tunnel:
  #   ssh -L 3000:localhost:3000 centos@<login_public_ip>
  #
  # Uncomment to publish the frontend at https://<cluster_name>.<domain>.
  # "app" points at the Next.js frontend on port 3000, and main2sub_redir sends
  # the cluster root there. Keep the ipa/mokey entries — they are the Magic
  # Castle defaults and overriding hieradata replaces the whole subdomain map.
  #
  # hieradata = <<-EOT
  #   profile::reverse_proxy::main2sub_redir: "app"
  #   profile::reverse_proxy::subdomains:
  #     ipa: "ipa.%%{lookup('profile::freeipa::base::ipa_domain')}"
  #     mokey: "%%{lookup('terraform.tag_ip.mgmt.0')}:%%{lookup('profile::freeipa::mokey::port')}"
  #     app: "http://localhost:3000"
  #     metrix: "http://%%{lookup('terraform.tag_ip.mgmt.0')}:9000"
  # EOT
}


output "accounts" {
  value = module.openstack.accounts
}

output "public_ip" {
  value = module.openstack.public_ip
}

## Uncomment to register your domain name with CloudFlare
# module "dns" {
#   source           = "./dns/cloudflare"
#   name             = module.openstack.cluster_name
#   domain           = module.openstack.domain
#   public_instances = module.openstack.public_instances
# }

## Uncomment to register your domain name with Google Cloud
# module "dns" {
#   source           = "./dns/gcloud"
#   project          = "your-project-id"
#   zone_name        = "you-zone-name"
#   name             = module.openstack.cluster_name
#   domain           = module.openstack.domain
#   public_instances = module.openstack.public_instances
# }

# output "hostnames" {
#   value = module.dns.hostnames
# }
