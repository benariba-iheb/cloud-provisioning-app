# The ephemeral "openSUSE instance" pod image. Kept deliberately small: no
# build toolchain, no language runtimes, no SSH server - terminal access is
# purely through the Kubernetes exec API (backend -> kubelet -> this
# container), never a direct network connection to the pod.
FROM opensuse/leap:15.6

RUN zypper --non-interactive install --no-recommends \
      ca-certificates \
      curl \
      git \
      less \
      nano \
    && zypper clean --all

# No foreground process needs to do anything - kubectl-exec-style access
# attaches /bin/bash on demand regardless of what PID 1 is doing. This just
# keeps the pod alive so there's something to exec into.
CMD ["sleep", "infinity"]
