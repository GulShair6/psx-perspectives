# Optional local runtime: security review pending

Reviewed on 2026-10-16. This is a record of unresolved release work, not a declaration that the full model environment is safe or validated. The Node application and optional Python installation are separate dependency boundaries; a clean `npm audit` covers only the former.

## Fixed tokenizer dependency

SentencePiece 0.2.0 is affected by [GHSA-38vq-g6vr-w8wf](https://github.com/advisories/GHSA-38vq-g6vr-w8wf), a heap overflow involving crafted model files. The installer now pins 0.2.1, the first patched version. Recreate or update any older Python environment before using it. A small synthetic tokenizer test is not an IndicTrans2 model-quality assessment.

## Remaining stack

PyTorch 2.6.0+cpu and Transformers 4.51.3 still match upstream advisory records. The release review must cover their complete resolved dependency graph, not just direct pins. Do not suppress those findings merely because inference is optional.

A metadata-only resolution on 2026-10-16 selected 57 packages for Python 3.11 on x86_64 Linux (manylinux 2.28), using the declared CPU index and pins. The [OSV package/version API](https://google.github.io/osv.dev/post-v1-querybatch/) returned advisory matches for PyTorch and Transformers, with no matches for the other 55 selected versions. PyTorch was queried both as `2.6.0+cpu` and as upstream `2.6.0` because version matching can differ. Duplicate advisory aliases are not separate vulnerabilities. This is a dated dependency snapshot, not a committed lock, installed-environment audit or proof of safety. No packages or weights were installed by that resolution; compatibility and advisory reachability remain unresolved.

Relevant high-severity Transformers reports include:

- [GHSA-29pf-2h5f-8g72](https://github.com/advisories/GHSA-29pf-2h5f-8g72): attacker-controlled attention configuration during model loading; fixed in 5.3.0. The wrapper uses pinned local files and explicitly selects eager attention, but that constraint does not replace a compatible patched stack.
- [GHSA-fgcw-684q-jj6r](https://github.com/advisories/GHSA-fgcw-684q-jj6r): the LightGlue loading path; fixed in 5.5.0. This application loads sequence-to-sequence translation models, not LightGlue.
- [GHSA-x9r9-c232-4q39](https://github.com/advisories/GHSA-x9r9-c232-4q39): downloading custom generation code before trust consent. The application disables runtime networking and supplies fixed generation options. The affected upstream API still needs review against the selected replacement version.
- [GHSA-xrqw-3rrv-vx5w](https://github.com/advisories/GHSA-xrqw-3rrv-vx5w): writes through chat-template names in `save_pretrained`; fixed in 5.10.0. The runtime does not call `save_pretrained`.

These observations describe the wrapper's current calls. They do not establish that every transitive or pinned-model-code path is unreachable. Older PyTorch reports also require triage. A major Transformers update must be tested with all three exact model revisions; changing a version number and passing model-free tests is insufficient.

The runtime refuses to start when an installed direct dependency differs from its declared pin. Readiness, current translation caches and quality/capacity reports include the model revisions, declared dependency pins and processing version. An already running process cannot claim a subsequently changed setup. This identifies the declared direct dependencies, not a lock or security audit of the full transitive environment.

## Evidence required to close this review

1. Audit a resolved Python 3.11 CPU environment, record applicable advisories and choose compatible patched dependencies. Document any remaining finding with a specific reachability argument and next review date.
2. Run the exact pinned models with external networking disabled, check interrupted jobs and the original mapping/number safeguards, then repeat quality and capacity trials for the changed environment.
3. Obtain the independent audio-linked translation reviews and evidence labels. Preserve existing reviews and caches, but do not use old validation to certify changed model processing.

Revisit by 2026-10-23 or before publishing/enabling the model runtime, whichever comes first. Live model testing remains deferred pending access approval and sufficient disk space. No model weights were downloaded for this review.
