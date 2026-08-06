# The ephemeral "Arch Linux instance" pod image. Kept deliberately small: no
# build toolchain, no language runtimes, no SSH server - terminal access is
# purely through the Kubernetes exec API (backend -> kubelet -> this
# container), never a direct network connection to the pod.
FROM archlinux:base

RUN pacman -Sy --noconfirm --needed \
      ca-certificates \
      curl \
      git \
      less \
      nano \
    && pacman -Scc --noconfirm

# No foreground process needs to do anything - kubectl-exec-style access
# attaches /bin/bash on demand regardless of what PID 1 is doing. This just
# keeps the pod alive so there's something to exec into.
CMD ["sleep", "infinity"]
