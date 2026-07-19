###############################################################################
# Sentry Alert Rules — Qoro (achado C1)
#
# Fecha o item literal do go-live #2: "salvar a Alert Rule com env=production +
# garantir o canal de notificação".
#
# POR QUE isto é Terraform e não um print de dashboard: uma regra que vive só no
# painel não é revisável em PR, não sobrevive a uma conta recriada, e não tem
# histórico de por que o threshold é o que é.
#
# APLICAR:
#   export SENTRY_AUTH_TOKEN=...      # token com escopo de projeto
#   terraform init && terraform apply
#
# O `environment` vem de `process.env.NODE_ENV` (sentry.server.config.ts) — na
# Vercel, produção resolve para "production". Preview/dev NÃO devem alertar:
# ruído de preview foi o que treinou o operador a ignorar notificação.
###############################################################################

terraform {
  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "~> 0.14"
    }
  }
}

provider "sentry" {
  # token via SENTRY_AUTH_TOKEN — NUNCA commitado.
}

variable "organization" {
  type        = string
  description = "Slug da org no Sentry."
  default     = "qoro-1v" # confere com next.config.ts (withSentryConfig)
}

variable "project" {
  type        = string
  description = "Slug do projeto no Sentry."
  default     = "qoro"
}

variable "notify_target" {
  type        = string
  description = <<-EOT
    Destino da notificação. Deixado como VARIÁVEL, sem default, de propósito:
    é o canal pessoal do operador (e-mail/Slack/pager) e não deve ser versionado.
    Passe via -var ou TF_VAR_notify_target.
  EOT
}

###############################################################################
# Regra 1 — nova issue em produção.
#
# Rate-limit de 1 notificação/30min POR ISSUE: sem isso, um erro em loop num
# cron de 1 minuto vira 60 notificações/hora e o operador silencia o canal — que
# é o modo de falha real de alerting, não o alerta que não dispara.
###############################################################################
resource "sentry_issue_alert" "new_issue_production" {
  organization = var.organization
  project      = var.project
  name         = "Qoro · nova issue (production)"
  action_match = "all"
  frequency    = 30 # minutos

  conditions = [
    {
      id = "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"
    }
  ]

  filters = [
    {
      id        = "sentry.rules.filters.event_attribute.EventAttributeFilter"
      attribute = "environment"
      match     = "eq"
      value     = "production"
    }
  ]

  actions = [
    {
      id             = "sentry.mail.actions.NotifyEmailAction"
      targetType     = "Member"
      targetIdentifier = var.notify_target
    }
  ]
}

###############################################################################
# Regra 2 — surto de erros.
#
# Complementa a Regra 1: uma issue JÁ conhecida que dispara 50×/min não é "nova"
# e não dispararia acima — mas é exatamente o formato de um incidente.
#
# Threshold conservador (20/5min). A auditoria (INFO-1) avisa que os números não
# têm histórico: recalibrar depois de ~4 semanas de tráfego real. Um threshold
# nunca revisitado vira ruído ou cegueira.
###############################################################################
resource "sentry_metric_alert" "error_surge_production" {
  organization      = var.organization
  project           = var.project
  name              = "Qoro · surto de erros (production)"
  dataset           = "events"
  query             = "environment:production"
  aggregate         = "count()"
  time_window       = 5
  threshold_type    = 0 # above
  resolve_threshold = 0

  trigger {
    label            = "critical"
    threshold_type   = 0
    alert_threshold  = 20
    action {
      type              = "email"
      target_type       = "user"
      target_identifier = var.notify_target
    }
  }

  trigger {
    label           = "warning"
    threshold_type  = 0
    alert_threshold = 5
  }
}

###############################################################################
# NÃO existe regra para `*.degraded` aqui — e é decisão, não esquecimento.
#
# `cron.audit_partitions.degraded` e `auth.ratelimit.degraded` vivem no pipeline
# stdout → Better Stack (ADR-029 mantém LOG fora do Sentry; ADR-043 §4 é
# explícito para o de partição). Duplicá-los aqui criaria uma 2ª fonte da
# verdade — dois alertas para o mesmo fato, que divergem no primeiro ajuste de
# threshold. Ver betterstack-monitors.md.
###############################################################################
