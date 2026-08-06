#!/usr/bin/env bash
#
# Bring up (or redeploy) the cloud-platform stack on this node's Kubernetes
# cluster: checks prerequisites, builds the backend/frontend/instance images,
# imports them straight into containerd (no image registry in this setup),
# applies every manifest under k8s/manifests/, and waits for rollout.
#
# Safe to re-run: rebuilds images and forces a rollout restart of
# backend/frontend so a fresh `:dev` image tag actually gets picked up
# (imagePullPolicy is IfNotPresent, so kubectl apply alone wouldn't notice
# a same-tag image changed underneath it).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFESTS_DIR="$SCRIPT_DIR/manifests"
NAMESPACE="cloud-platform"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisite checks. This script never installs anything for you -
#    if a tool or the cluster itself is missing, it tells you what to
#    install/fix and stops.
# ---------------------------------------------------------------------------
missing=()
command -v kubectl >/dev/null 2>&1 || missing+=("kubectl")
command -v docker  >/dev/null 2>&1 || missing+=("docker")
command -v ctr     >/dev/null 2>&1 || missing+=("ctr (containerd CLI)")
command -v sudo    >/dev/null 2>&1 || missing+=("sudo")
docker buildx version >/dev/null 2>&1 || missing+=("docker buildx plugin")

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "Missing required tools:"
  printf '  - %s\n' "${missing[@]}"
  cat <<'EOF'

Install what's missing, then re-run this script:
  - kubectl:        https://kubernetes.io/docs/tasks/tools/#kubectl
  - Docker Engine + the buildx plugin: https://docs.docker.com/engine/install/
  - containerd (provides 'ctr'): usually already present on any kubeadm
    node - https://containerd.io/ if it's genuinely missing
  - A running cluster this user can reach (kubeadm init/join, or your
    distro's equivalent), with KUBECONFIG pointing at it
EOF
  exit 1
fi

log "Checking cluster connectivity"
kubectl cluster-info >/dev/null 2>&1 || die "kubectl cannot reach a cluster. Is the cluster up and is KUBECONFIG set? (e.g. export KUBECONFIG=/etc/kubernetes/admin.conf)"

# Images are built locally and imported straight into containerd on THIS
# host, with no registry involved - so workloads are only schedulable on
# whichever node this script actually runs on. Read the expected node
# straight out of the manifests rather than hardcoding it, so this stays
# correct if the topology ever changes.
BUILD_NODE="$(grep 'kubernetes.io/hostname' "$MANIFESTS_DIR/03-backend/04-deployment.yaml" | awk -F': ' '{print $2}' | tr -d ' \r')"
CURRENT_HOST="$(hostname)"

if [ -n "$BUILD_NODE" ] && [ "$CURRENT_HOST" != "$BUILD_NODE" ]; then
  warn "k8s/manifests pins workloads to node '$BUILD_NODE' (nodeSelector), but this host is '$CURRENT_HOST'. Images built here won't be visible there. Run this script on '$BUILD_NODE' instead, or update the nodeSelector in k8s/manifests/03-backend and 04-frontend if your topology changed."
  read -rp "Continue anyway? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || exit 1
fi

NODE_READY="$(kubectl get node "$CURRENT_HOST" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
[ "$NODE_READY" = "True" ] || die "Node '$CURRENT_HOST' is not Ready (kubectl get nodes). Fix the node before deploying to it."

# ---------------------------------------------------------------------------
# 2. Build images and import them into containerd.
#
# Plain `docker build` (and `docker buildx build --load`) go through the
# classic Docker daemon's container-layer creation to run each RUN step,
# which is broken on this host (vfs storage driver can't create a
# read-write layer). BuildKit's own OCI exporter writes a portable tarball
# straight to disk instead - no classic daemon container ever gets
# created - then `ctr images import` loads that tarball directly into the
# containerd namespace Kubernetes reads from.
# ---------------------------------------------------------------------------
build_and_import() {
  local name="$1" context="$2"
  local tag="cloud-platform/${name}:dev"
  local tar="$TMP_DIR/${name}.tar"

  log "Building ${tag}"
  docker buildx build --output "type=oci,dest=${tar}" -t "$tag" "$context"

  log "Importing ${tag} into containerd (sudo)"
  sudo ctr -n k8s.io images import "$tar"
}

build_and_import backend  "$REPO_ROOT/backend"
build_and_import frontend "$REPO_ROOT/frontend"
# One image per instance distro option offered in the UI - each is its own
# build context under k8s/images/instance/<distro>, tagged
# cloud-platform/instance-<distro>:dev to match backend/src/services/k8sService.js's
# DISTRO_IMAGES map.
build_and_import instance-ubuntu   "$REPO_ROOT/k8s/images/instance/ubuntu"
build_and_import instance-arch     "$REPO_ROOT/k8s/images/instance/arch"
build_and_import instance-opensuse "$REPO_ROOT/k8s/images/instance/opensuse"

# ---------------------------------------------------------------------------
# 3. Apply manifests - namespace must exist before anything that's
#    namespaced under it.
# ---------------------------------------------------------------------------
log "Applying namespace"
kubectl apply -f "$MANIFESTS_DIR/00-namespace.yaml"

log "Applying remaining manifests"
kubectl apply -R -f "$MANIFESTS_DIR/"

# Force a rollout even when the manifest itself didn't change: the image
# tag is always ":dev" and imagePullPolicy is IfNotPresent, so re-running
# this script after a code change would otherwise leave the old pods
# running against the freshly-imported image sitting unused.
log "Restarting backend and frontend to pick up freshly-imported images"
kubectl rollout restart deployment/backend  -n "$NAMESPACE"
kubectl rollout restart deployment/frontend -n "$NAMESPACE"

# ---------------------------------------------------------------------------
# 4. Wait for everything to actually come up.
# ---------------------------------------------------------------------------
log "Waiting for postgres"
kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=180s

log "Waiting for backend"
kubectl rollout status deployment/backend -n "$NAMESPACE" --timeout=180s

log "Waiting for frontend"
kubectl rollout status deployment/frontend -n "$NAMESPACE" --timeout=180s

# ---------------------------------------------------------------------------
# 5. Done.
# ---------------------------------------------------------------------------
NODE_IP="$(kubectl get node "$CURRENT_HOST" -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')"
NODE_PORT="$(kubectl get svc frontend -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].nodePort}')"

log "cloud-platform is up"
echo "Open: http://${NODE_IP}:${NODE_PORT}"
