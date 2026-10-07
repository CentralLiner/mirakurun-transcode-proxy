# Third-party software

The proxy's original code and documentation are licensed under MIT; see
`LICENSE`. Upstream software keeps its own licenses. This source repository
ships local patches and upstream license notices, not encoder binaries.

- [rigaya/tsreplace](https://github.com/rigaya/tsreplace), MIT License, pinned to
  commit `98d6739180c858927a52c0d70ab20a45b4a9e39e`. The patches in `patches/`
  modify `app/tsreplace.cpp` and `app/rgy_tsdemux.cpp` from that commit.
  Their original copyright and MIT permission notice are preserved in
  [third_party/tsreplace-license.txt](third_party/tsreplace-license.txt).
- [rigaya/QSVEnc](https://github.com/rigaya/QSVEnc), version 8.26. Its core is
  MIT-licensed; included libraries have additional terms. The upstream
  [license notice](third_party/qsvenc-license.txt) is retained in full.
- [Node.js](https://nodejs.org/), version 24 LTS. The Docker build takes the
  runtime and its license notice from the official Node.js image.
- Ubuntu packages retain their respective licenses and copyright notices.

The QSVEncC Debian package is downloaded from its official GitHub release and
verified against SHA-256
`3b8c9ea9801e6563a8efc62acea2ab86404cf01503d134b6cf013a186f4f1b7a`.
This matches the `digest` of `qsvencc_8.26_amd64.deb` in the
[official release metadata](https://api.github.com/repos/rigaya/QSVEnc/releases/tags/8.26),
checked on 2026-10-07. Docker verifies the downloaded bytes before installation.

Ubuntu libraries, including FFmpeg and the Intel media driver, keep their
package copyright files under `/usr/share/doc/` in the resulting container.
Publishing a container or other bundled binaries requires reviewing the terms
and source-distribution obligations of those components separately from the
MIT license on this proxy. This project's initial public release distributes
source code only.
