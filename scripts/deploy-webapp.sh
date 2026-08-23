#!/usr/bin/env bash
# push + deploy version ใหม่ให้โปรเจกต์หน้าตั้งค่า บน "deployment เดิม" (URL ไม่เปลี่ยน)
# ใช้: scripts/deploy-webapp.sh "คำอธิบาย version"
set -euo pipefail

DEPLOYMENT_ID="AKfycbxAjzU09oMjcQtT3RXpqNTh_rt9RDCzdrH_SGysycgYUNb0CEs7wcrztpmizPPe6rO2TQ"
DESCRIPTION="${1:-update}"

"$(dirname "$0")"/push-webapp.sh
cd "$(dirname "$0")"/../apps/webapp
clasp deploy --deploymentId "$DEPLOYMENT_ID" -d "$DESCRIPTION"
