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

module.exports = { createInstancePod, deletePod, getPodPhase, execIntoPod };
