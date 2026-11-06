# Third-party notices

NVideo Studio source is GPL-3.0-or-later. Third-party components retain their own copyrights and licenses; the project license does not relicense those components.

Preserved upstream license, copyright, and notice files are in [third-party/licenses](third-party/licenses), indexed by package and locked version in [notice-inventory.json](third-party/notice-inventory.json). The inventory includes build dependencies and platform alternatives; it does not assert that every listed package is present in the application executable. License expressions are metadata declarations. For dual-licensed MIT OR Apache-2.0 crates this project may use the MIT option; original texts are preserved.

The direct dependency table and Windows Cargo resolution are in [docs/legal](docs/legal/THIRD_PARTY_DEPENDENCIES.md). Exact npm and Cargo lockfiles are committed. A package with an empty noticeFiles array requires upstream verification before a binary containing it is distributed. This source repository distributes no third-party executable binaries.

## External media binaries: distribution held

libmpv and standalone FFmpeg/FFprobe are used by video playback and thumbnail extraction respectively. The locally inspected builds enable GPL code; they are not an LGPL-only basis for MIT distribution of this integrated application. Their complete corresponding dependency source, patches and build inputs have not been established. No binary redistribution clearance is claimed.

See [binary provenance and hold](third-party/binaries/README.md). Do not publish a portable package until these obligations are satisfied. Copying a GPL license text alone does not resolve the missing corresponding sources.
