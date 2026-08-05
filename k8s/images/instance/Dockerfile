# The ephemeral "Ubuntu instance" pod image. Kept deliberately small: no
# build toolchain, no language runtimes, no SSH server - terminal access is
# purely through the Kubernetes exec API (backend -> kubelet -> this
# container), never a direct network connection to the pod.
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      less \
      nano \
    && rm -rf /var/lib/apt/lists/*

# No foreground process needs to do anything - kubectl-exec-style access
# attaches /bin/bash on demand regardless of what PID 1 is doing. This just
# keeps the pod alive so there's something to exec into.
CMD ["sleep", "infinity"]
