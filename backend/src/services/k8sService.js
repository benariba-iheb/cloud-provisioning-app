const NAMESPACE = process.env.K8S_NAMESPACE || 'cloud-platform';
const INSTANCE_IMAGE = process.env.INSTANCE_IMAGE || 'cloud-platform/instance:dev';

// @kubernetes/client-node is ESM-only; this backend is CommonJS, so it's
// loaded via a memoized dynamic import rather than require().
let k8sModulePromise;
function loadK8s() {
  if (!k8sModulePromise) k8sModulePromise = import('@kubernetes/client-node');
  return k8sModulePromise;
}

let kubeConfigPromise;
async function getKubeConfig() {
  if (!kubeConfigPromise) {
    kubeConfigPromise = loadK8s().then((k8s) => {
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      return kc;
    });
  }
  return kubeConfigPromise;
}

async function getCoreApi() {
  const k8s = await loadK8s();
  const kc = await getKubeConfig();
  return kc.makeApiClient(k8s.CoreV1Api);
}

async function getNetworkingApi() {
  const k8s = await loadK8s();
  const kc = await getKubeConfig();
  return kc.makeApiClient(k8s.NetworkingV1Api);
}

function buildPodManifest({ instanceId, userId, podName }) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: {
        app: 'instance',
        'user-id': userId,
        'instance-id': instanceId,
      },
    },
    spec: {
      restartPolicy: 'Never',
      terminationGracePeriodSeconds: 5,
      automountServiceAccountToken: false,
      // No image registry - the instance image is built and imported
      // straight into containerd on the "debian" node, so instance pods
      // must land there too (same reasoning as the backend/frontend
      // Deployments' nodeSelector).
      nodeSelector: {
        'kubernetes.io/hostname': 'debian',
      },
      containers: [
        {
          name: 'sandbox',
          image: INSTANCE_IMAGE,
          imagePullPolicy: 'IfNotPresent',
          command: ['sleep', 'infinity'],
          resources: {
            requests: { cpu: '50m', memory: '64Mi' },
            limits: { cpu: '250m', memory: '256Mi' },
          },
        },
      ],
    },
  };
}

async function createInstancePod({ instanceId, userId, podName }) {
  const coreApi = await getCoreApi();
  await coreApi.createNamespacedPod({
    namespace: NAMESPACE,
    body: buildPodManifest({ instanceId, userId, podName }),
  });
}

function userIsolationPolicyName(userId) {
  return `instance-isolation-${userId}`;
}

// A user's instances should be able to reach each other but not another
// user's - vanilla NetworkPolicy can't express "same label value as me" in
// one static rule, so this is one policy per user, keyed on the same
// user-id label buildPodManifest() already puts on every instance pod.
// Ingress/egress to DNS+internet for all instance pods is handled
// separately by the static k8s/manifests/05-network/01-instance-egress-netpol.yaml
// policy - NetworkPolicies for the same pod are additive (OR'd), so this
// only needs to add the same-user peer traffic on top of that.
//
// NOTE: this cluster's CNI is Flannel, which does not enforce the
// NetworkPolicy API at all - this applies cleanly and is semantically
// correct, but is inert until a NetworkPolicy-capable CNI (Calico/Cilium)
// is in front of it. See k8s/manifests/05-network/01-instance-egress-netpol.yaml
// for the same caveat on the existing policy.
function buildUserIsolationNetworkPolicy(userId) {
  const peerSelector = { matchLabels: { app: 'instance', 'user-id': userId } };
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: userIsolationPolicyName(userId),
      namespace: NAMESPACE,
    },
    spec: {
      podSelector: peerSelector,
      policyTypes: ['Ingress', 'Egress'],
      // The client-node model for an ingress rule's peer list is keyed as
      // `_from`, not `from` - the generated TS class renames it internally
      // (avoiding a collision with the `from` keyword used elsewhere in
      // generated ESM code) while still serializing to the wire as "from".
      // Confirmed live: a plain `from` key here gets silently dropped by
      // the serializer, producing an empty {} ingress rule that means
      // "allow from anywhere" - the opposite of intended. Egress's `to`
      // key has no such collision and needs no special handling.
      ingress: [{ _from: [{ podSelector: peerSelector }] }],
      egress: [{ to: [{ podSelector: peerSelector }] }],
    },
  };
}

// Idempotent - called before every instance create, not just the user's
// first, since it's cheap and avoids tracking "has this user's policy
// already been created" as separate state.
async function ensureUserNetworkPolicy(userId) {
  const networkingApi = await getNetworkingApi();
  try {
    await networkingApi.createNamespacedNetworkPolicy({
      namespace: NAMESPACE,
      body: buildUserIsolationNetworkPolicy(userId),
    });
  } catch (err) {
    if (err?.code !== 409) throw err;
  }
}

async function deletePod(podName) {
  const coreApi = await getCoreApi();
  try {
    await coreApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE, gracePeriodSeconds: 5 });
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

// Returns a k8s pod phase (Pending/Running/Succeeded/Failed/Unknown), or the
// sentinel 'NotFound' (not a real k8s phase) when the pod no longer exists.
async function getPodPhase(podName) {
  const coreApi = await getCoreApi();
  try {
    const pod = await coreApi.readNamespacedPod({ name: podName, namespace: NAMESPACE });
    return pod.status?.phase || 'Unknown';
  } catch (err) {
    if (err?.code === 404) return 'NotFound';
    throw err;
  }
}

async function execIntoPod(podName, { stdout, stderr, stdin, command = ['/bin/bash'], containerName = 'sandbox', statusCallback } = {}) {
  const k8s = await loadK8s();
  const kc = await getKubeConfig();
  const exec = new k8s.Exec(kc);
  return exec.exec(NAMESPACE, podName, containerName, command, stdout, stderr, stdin, true, statusCallback);
}

module.exports = { createInstancePod, deletePod, getPodPhase, execIntoPod, ensureUserNetworkPolicy };
