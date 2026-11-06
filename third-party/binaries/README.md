# External binary provenance — publication HOLD

No executable is committed. These observations describe the local development tools, not a cleared public binary release.

## libmpv

- Package: mpv-dev-x86_64-20261101-git-48fca90e8c.7z
- Upstream: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/mpv-dev-x86_64-20261101-git-48fca90e8c.7z/download
- Archive SHA-256: 30d3f9fa121ce24638610a9ae52f8957743f9dea416dd37dc4ff7e43589ef843
- libmpv-2.dll SHA-256: f40293dc5f4012f3f7bcc79de2b9bfb66309b87dbd33a47ee49ebff716eb8154
- Builder: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261101
- Builder commit: bda10a2816ce9908d419b3f4b564227330457e76
- The standard build includes GPL dependencies. The original archive matched the installed DLL but contains headers/import library/DLL, not complete corresponding source.
- Expired build artifacts and incomplete logs do not establish all exact static dependency revisions.

## FFmpeg / FFprobe

- Version: Gyan 8.1.1 full_build; configuration enables --enable-gpl and --enable-version3.
- Upstream release: https://github.com/GyanD/codexffmpeg/releases/tag/8.1.1
- FFmpeg revision stated upstream: 239f2c733d.
- The copied upstream LICENSE and README are retained below. The release metadata and README do not establish the complete exact sources and patches of all linked third-party libraries.

## Required resolution

Obtain complete sources, patches, build/configuration scripts and appropriate copyright/license notices for these exact binaries, or rebuild all components from pinned, retained sources with documented reproducible inputs. Provide compliant corresponding source alongside the portable release and review the final package. Until then distributionStatus remains held-corresponding-source-unverified and distributable is false. GPL licensing of our application source does not by itself satisfy binary redistribution obligations.
